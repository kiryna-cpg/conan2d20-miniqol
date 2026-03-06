import { MODULE_ID, SETTING_KEYS } from "../constants.js";
import {
  requestRollDamage,
  requestApplyDamage,
  requestUndoDamage,
  requestApplyAll,
  requestSetTargets
} from "../socket.js";
import { execRollDamage, execApplyDamage, execUndoDamage } from "../workflows/damage-workflow.js";

let _hooksRegistered = false;
let _delegatedBound = false;

function hasActiveGM() {
  return game.users?.some(u => u.active && u.isGM);
}

function allowPlayerRequests() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.ALLOW_PLAYERS_REQUEST_APPLY);
}

function autoRollEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.AUTO_ROLL_DAMAGE);
}

function autoApplyEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.AUTO_APPLY_DAMAGE);
}

function getRootEl(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

/**
 * IMPORTANT:
 * Never use raw tokenUuid as an object key inside flags, because "." gets expanded into nested objects.
 * We display and check state using a safe key (no dots) and also support legacy nested formats.
 */
function safeTokenKey(tokenUuid) {
  const raw = String(tokenUuid ?? "");
  // encodeURIComponent does NOT encode ".", so replace it
  return encodeURIComponent(raw).replaceAll(".", "%2E");
}

function parseSceneTokenFromUuid(tokenUuid) {
  const parts = String(tokenUuid ?? "").split(".");
  if (parts.length >= 4 && parts[0] === "Scene" && parts[2] === "Token") {
    return { sceneId: parts[1], tokenId: parts[3] };
  }
  return null;
}

function getLegacyNestedEntry(map, tokenUuid) {
  const ids = parseSceneTokenFromUuid(tokenUuid);
  if (!ids) return null;
  return map?.Scene?.[ids.sceneId]?.Token?.[ids.tokenId] ?? null;
}

function getTokenKeyedEntry(map, tokenUuid) {
  if (!map) return null;
  const safe = safeTokenKey(tokenUuid);
  return map?.[safe] ?? map?.[tokenUuid] ?? getLegacyNestedEntry(map, tokenUuid) ?? null;
}

function isAppliedForToken(appliedMap, tokenUuid) {
  return !!getTokenKeyedEntry(appliedMap, tokenUuid);
}

function isDamageCapableRoll(message) {
  const dice = Number(message?.flags?.data?.item?.system?.damage?.dice ?? 0);
  return Number.isFinite(dice) && dice > 0;
}

function isSuccessfulRoll(message) {
  return message?.flags?.data?.results?.result === "success";
}

function collectCurrentTargets() {
  return Array.from(game.user?.targets ?? []).map(t => ({
    tokenUuid: t.document.uuid,
    actorUuid: t.actor?.uuid ?? null,
    name: t.name
  }));
}

async function bootstrapMinQolFlagsFromMessage(message) {
  if (!message) return false;
  if (message.flags?.[MODULE_ID]) return true;
  if (game.system?.id !== "conan2d20") return false;

  // Only bootstrap if the message includes item damage data (deterministic)
  if (!isDamageCapableRoll(message)) return false;

  const data = message.flags?.data ?? {};
  const actorUuid = data?.actor?._id ? `Actor.${data.actor._id}` : null;

  const sceneId = message?.speaker?.scene ?? null;
  const tokenId = message?.speaker?.token ?? null;
  const attackerTokenUuid = tokenId && sceneId ? `Scene.${sceneId}.Token.${tokenId}` : null;

  const itemId = data?.rollData?.item?._id ?? data?.item?._id ?? null;
  const itemUuid = (actorUuid && itemId) ? `${actorUuid}.Item.${itemId}` : null;

  const targets = collectCurrentTargets();

  const payload = {
    schema: 1,
    context: {
      attackerActorUuid: actorUuid,
      attackerTokenUuid,
      itemUuid,
      itemId,
      itemName: data?.item?.name ?? null
    },
    targets,
    damage: {
      rolled: false,
      total: null,
      dice: null,
      static: 0,
      effects: 0,
      faces: [],
      type: String(data?.item?.system?.damage?.type ?? "physical")
    },
    hitLocation: {
      enabled: !!game.settings.get(MODULE_ID, SETTING_KEYS.HIT_LOCATION_ENABLED),
      mode: "perTarget",
      byTarget: {}
    },
    applied: {}
  };

  await message.update({ [`flags.${MODULE_ID}`]: payload });
  return true;
}

async function injectMinQolBlock(message, root) {
  if (!message || !root) return;
  if (game.system?.id !== "conan2d20") return;

  // Deterministic: only show for success + damage-capable
  if (!isSuccessfulRoll(message)) return;
  if (!isDamageCapableRoll(message)) return;

  if (root.querySelector?.(".c2d20-miniqol")) return;

  // Persist flags so it survives reload
  if (!message.flags?.[MODULE_ID]) {
    const canWrite = game.user?.isGM === true || message?.author?.id === game.user?.id;
    if (canWrite) await bootstrapMinQolFlagsFromMessage(message);
  }

  const flags = message.flags?.[MODULE_ID] ?? {
    targets: [],
    applied: {},
    hitLocation: { byTarget: {} },
    damage: { rolled: false, total: null }
  };

  const canOperate = allowPlayerRequests() ? true : (game.user?.isGM === true);

  const targets = flags.targets ?? [];
  const applied = flags.applied ?? {};
  const hitByTarget = flags.hitLocation?.byTarget ?? {};

  const targetRows = targets.map(t => {
    const isApplied = isAppliedForToken(applied, t.tokenUuid);
    const hit = getTokenKeyedEntry(hitByTarget, t.tokenUuid);
    return {
      tokenUuid: t.tokenUuid,
      name: t.name,
      statusLabel: isApplied ? game.i18n.localize("C2MQ.Status.Applied") : game.i18n.localize("C2MQ.Status.Pending"),
      statusClass: isApplied ? "applied" : "pending",
      hitLocationLabel: hit?.label ? `${game.i18n.localize("C2MQ.Label.HitLocation")}: ${hit.label}` : "",
      canApply: canOperate && flags.damage?.rolled && !isApplied,
      canUndo: canOperate && isApplied
    };
  });

  const showApplyAll =
    !!game.settings.get(MODULE_ID, SETTING_KEYS.SHOW_APPLY_ALL) &&
    flags.damage?.rolled &&
    targets.length > 1;

  const data = {
    messageId: message.id,
    canRollDamage: true,
    damage: flags.damage ?? { rolled: false },
    targetRows,
    hasTargets: targetRows.length > 0,
    showApplyAll,
    canSetTargets: canOperate,
    isFallback: !message.flags?.[MODULE_ID]
  };

  const templatePath = `modules/${MODULE_ID}/templates/chat/miniqol-controls.hbs`;
  const blockHtml = await renderTemplate(templatePath, data);

  const contentEl = root.querySelector(".message-content") ?? root;
  contentEl.insertAdjacentHTML("beforeend", blockHtml);
}

function bindDelegatedClicksOnce() {
  if (_delegatedBound) return;
  _delegatedBound = true;

  document.addEventListener("click", async (ev) => {
    const btn = ev.target?.closest?.(".c2d20-miniqol button[data-action]");
    if (!btn) return;

    const container = btn.closest(".c2d20-miniqol");
    const messageId = container?.dataset?.messageId;
    if (!messageId) return;

    const message = game.messages?.get(messageId);
    if (!message) return;

    const action = btn.dataset.action;
    const targetTokenUuid = btn.dataset.targetUuid ?? null;

    console.log(`[${MODULE_ID}] click`, { action, messageId, targetTokenUuid });

    const useSocket = hasActiveGM() ? !game.user.isGM : false;

    if (action === "roll-damage") {
      ev.preventDefault();
      ev.stopPropagation();

      if (useSocket) return requestRollDamage(messageId);

      const canWrite = game.user?.isGM === true || message?.author?.id === game.user?.id;
      if (!message.flags?.[MODULE_ID] && canWrite) await bootstrapMinQolFlagsFromMessage(message);

      const fresh = game.messages?.get(messageId) ?? message;
      await execRollDamage(fresh);
      try { ui.chat?.render?.(true); } catch (_e) {}
      return;
    }

    const canOperate = allowPlayerRequests() ? true : (game.user?.isGM === true);
    if (!canOperate) return;

    if (action === "apply") {
      ev.preventDefault();
      ev.stopPropagation();
      if (!targetTokenUuid) return;

      if (useSocket) requestApplyDamage(messageId, targetTokenUuid);
      else await execApplyDamage(game.messages?.get(messageId) ?? message, targetTokenUuid);
      return;
    }

    if (action === "undo") {
      ev.preventDefault();
      ev.stopPropagation();
      if (!targetTokenUuid) return;

      if (useSocket) requestUndoDamage(messageId, targetTokenUuid);
      else await execUndoDamage(game.messages?.get(messageId) ?? message, targetTokenUuid);
      return;
    }

    if (action === "apply-all") {
      ev.preventDefault();
      ev.stopPropagation();

      if (useSocket) requestApplyAll(messageId);
      else await execApplyDamage(game.messages?.get(messageId) ?? message, null, { applyAll: true });
      return;
    }

    if (action === "set-targets") {
      ev.preventDefault();
      ev.stopPropagation();

      const targets = collectCurrentTargets();
      if (useSocket) requestSetTargets(messageId, targets);
      else {
        const flags = message.flags?.[MODULE_ID];
        if (!flags) return;

        const next = foundry.utils.duplicate(flags);
        next.targets = targets;
        next.applied = {};
        await message.update({ [`flags.${MODULE_ID}`]: next });
        try { ui.chat?.render?.(true); } catch (_e) {}
      }
    }
  });
}

export function registerChatHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  bindDelegatedClicksOnce();

  Hooks.on("createChatMessage", async (message) => {
    try {
      if (game.system?.id !== "conan2d20") return;
      if (!isSuccessfulRoll(message)) return;
      if (!isDamageCapableRoll(message)) return;

      if (game.user?.isGM) {
        await bootstrapMinQolFlagsFromMessage(message);

        const autoRoll = autoRollEnabled();
        const autoApply = autoApplyEnabled();

        if (autoRoll) {
          const fresh = game.messages?.get(message.id) ?? message;
          await execRollDamage(fresh);
        }

        if (autoRoll && autoApply) {
          const fresh = game.messages?.get(message.id) ?? message;
          const flags = fresh.flags?.[MODULE_ID];
          const only = flags?.targets?.length === 1 ? flags.targets[0] : null;
          if (only?.tokenUuid) await execApplyDamage(fresh, only.tokenUuid);
        }
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] createChatMessage error`, e);
    }
  });

  Hooks.on("renderChatMessage", async (message, html) => {
    try {
      const root = getRootEl(html);
      if (!root) return;
      await injectMinQolBlock(message, root);
    } catch (e) {
      console.error(`[${MODULE_ID}] renderChatMessage error`, e);
    }
  });

  Hooks.on("renderChatLog", async (_app, html) => {
    try {
      const root = getRootEl(html);
      if (!root) return;

      const nodes = root.querySelectorAll?.("li.chat-message[data-message-id]") ?? [];
      for (const li of nodes) {
        if (li.querySelector?.(".c2d20-miniqol")) continue;

        const messageId = li.dataset.messageId;
        const message = game.messages?.get(messageId);
        if (!message) continue;

        await injectMinQolBlock(message, li);
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] renderChatLog inject error`, e);
    }
  });
}