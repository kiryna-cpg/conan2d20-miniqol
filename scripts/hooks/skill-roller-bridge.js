import { MODULE_ID, HOOK_NAMES } from "../constants.js";
import {
  consumeMatchingPendingRollIntent,
  pruneExpiredPendingRollIntents
} from "../state/pending-roll-store.js";
import { debugEnabled } from "../adapter/conan2d20.js";
import {
  maybeStartRetaliateWorkflow,
  maybeCancelPendingReactionFromSkillRollerContext
} from "../workflows/reaction-workflow.js";

let _bridgeRegistered = false;

function getRootEl(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function clampDifficulty(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  return Math.max(0, Math.min(5, n));
}

function applyDifficultyOverride(root, difficulty) {
  const next = clampDifficulty(difficulty);
  if (next == null) return;

  const current = root.querySelector?.(".skill-roller.difficulty.button.active");
  if (Number(current?.dataset?.difficulty) === next) return;

  const button = root.querySelector?.(`.skill-roller.difficulty.button[data-difficulty="${next}"]`);
  if (button && !button.classList.contains("active")) button.click();
}

function rootText(root, app) {
  try {
    if (root) return root.textContent ?? "";
    const el = app?.element?.[0] ?? app?.element;
    return el?.textContent ?? "";
  } catch (_e) {
    return "";
  }
}

function inferActor(app, data) {
  const actorId =
    data?.rollData?.actorId ??
    data?.actorId ??
    app?.actor?.id ??
    app?.object?.actor?.id ??
    null;

  if (actorId) return game.actors?.get(actorId) ?? app?.actor ?? app?.object?.actor ?? null;
  return app?.actor ?? app?.object?.actor ?? null;
}

function inferItem(actor, app, data, root) {
  const itemId =
    data?.rollData?.item?._id ??
    data?.item?._id ??
    data?.itemId ??
    app?.item?.id ??
    null;

  if (actor && itemId) return actor.items?.get(itemId) ?? null;
  if (app?.item) return app.item;

  const details = data?.difficulty?.display ?? rootText(root, app) ?? "";
  const mm = String(details).match(/\bReach\s*(\d+)\b/i);
  if (mm?.[1]) {
    return {
      id: null,
      type: "weapon",
      name: null,
      system: { range: Number(mm[1]) }
    };
  }

  return null;
}

function inferSkillKey(data, pendingIntent = null) {
  return (
    data?.rollData?.skill ??
    data?.rollData?.skillKey ??
    data?.skill ??
    data?.skillKey ??
    pendingIntent?.skillKey ??
    null
  );
}

function classifyRollContext({ item, skillKey, pendingIntent, root }) {
  if (pendingIntent?.type === "weapon-attack") return "weapon-attack";
  if (item?.type === "weapon" || item?.type === "npcattack") return "weapon-attack";
  if (pendingIntent?.type === "skill-roll") return "skill-roll";
  if (pendingIntent?.type === "defense-roll") return "defense-roll";
  if (skillKey) return "skill-roll";

  const details = root?.querySelector?.(".test-details")?.textContent ?? "";
  if (/\bReach\s*\d+\b/i.test(details)) return "weapon-attack";

  return "unknown";
}

function readExplicitDifficulty(pendingIntent = null) {
  const raw =
    pendingIntent?.metadata?.reactionDifficulty ??
    pendingIntent?.metadata?.difficulty ??
    pendingIntent?.metadata?.rollDifficulty ??
    null;

  return clampDifficulty(raw);
}

function bindRollSubmitMarker(app, root) {
  const button = root?.querySelector?.(".roll-skill-check");
  if (!button) return;
  if (button.dataset.c2mqSubmitBound === "1") return;

  button.dataset.c2mqSubmitBound = "1";
  button.addEventListener("click", () => {
    app._c2mqSubmitted = true;
  }, { once: true });
}

export function registerSkillRollerBridge() {
  if (_bridgeRegistered) return;
  _bridgeRegistered = true;

  Hooks.on("renderSkillRoller", (app, html, data) => {
    try {
      pruneExpiredPendingRollIntents();

      const root = getRootEl(html);
      if (!root) return;

      const actor = inferActor(app, data);
      const inferredItemId =
        data?.rollData?.item?._id ??
        data?.item?._id ??
        data?.itemId ??
        app?.item?.id ??
        null;

      const inferredSkillKey =
        data?.rollData?.skill ??
        data?.rollData?.skillKey ??
        data?.skill ??
        data?.skillKey ??
        null;

      const pendingIntent = app._c2mqPendingIntent ?? consumeMatchingPendingRollIntent({
        actorId: actor?.id ?? null,
        itemId: inferredItemId,
        skillKey: inferredSkillKey,
        userId: game.user?.id ?? null
      });

      if (pendingIntent) app._c2mqPendingIntent = pendingIntent;

      const item = inferItem(actor, app, data, root);
      const skillKey = inferSkillKey(data, pendingIntent);

      const context = {
        app,
        html,
        root,
        data,
        actor,
        item,
        itemId: item?.id ?? inferredItemId ?? pendingIntent?.itemId ?? null,
        skillKey,
        pendingIntent,
        kind: classifyRollContext({ item, skillKey, pendingIntent, root }),
        purpose: pendingIntent?.metadata?.rollPurpose ?? null
      };

      const reactionKind = String(pendingIntent?.metadata?.reactionKind ?? "").toLowerCase();
      const isDefensiveReaction =
        context.purpose === "defense" ||
        reactionKind === "defend" ||
        reactionKind === "protect";

      if (isDefensiveReaction && actor) {
        const bankType = String(actor.type ?? "").toLowerCase() === "npc"
          ? "doom"
          : "momentum";

        if (app?.rollData) app.rollData.bankType = bankType;
        if (data?.rollData) data.rollData.bankType = bankType;
        if (app?.object?.rollData) app.object.rollData.bankType = bankType;
        if (app?.options?.rollData) app.options.rollData.bankType = bankType;
      }

      const explicitDifficulty = readExplicitDifficulty(pendingIntent);
      if (explicitDifficulty != null) {
        queueMicrotask(() => applyDifficultyOverride(root, explicitDifficulty));
      }

      bindRollSubmitMarker(app, root);

      app._c2mqBridgeContext = context;

      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] skill roller bridge`, context);
      }

      Hooks.callAll(HOOK_NAMES.SKILL_ROLLER_CONTEXT, context);
      if (!isDefensiveReaction) {
        void maybeStartRetaliateWorkflow(context);
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] skill roller bridge error`, e);
    }
  });
    Hooks.on("closeSkillRoller", (app) => {
    try {
      if (!app || app._c2mqSubmitted === true) return;

      const context = app._c2mqBridgeContext ?? null;
      if (!context) return;

      void maybeCancelPendingReactionFromSkillRollerContext(context);
    } catch (e) {
      console.error(`[${MODULE_ID}] skill roller close bridge error`, e);
    }
  });
}