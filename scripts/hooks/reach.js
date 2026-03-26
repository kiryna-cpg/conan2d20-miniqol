import { MODULE_ID, SETTING_KEYS, HOOK_NAMES } from "../constants.js";
import { computeActorReach, readItemReach, debugEnabled } from "../adapter/conan2d20.js";

let _reachHooksRegistered = false;

function clampDifficulty(d) {
  const n = Number(d);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function getActiveDifficulty(root) {
  const active = root.querySelector?.(".skill-roller.difficulty.button.active");
  const v = active?.dataset?.difficulty;
  return clampDifficulty(v);
}

function setDifficulty(root, d) {
  const n = clampDifficulty(d);
  const btn = root.querySelector?.(`.skill-roller.difficulty.button[data-difficulty="${n}"]`);
  if (btn && !btn.classList.contains("active")) btn.click();
}

function collectTargets() {
  return Array.from(game.user?.targets ?? []).map((t) => t.actor).filter(Boolean);
}

function ensureNote(root) {
  let el = root.querySelector?.(".c2mq-reach-note");
  if (el) return el;

  el = document.createElement("div");
  el.className = "c2mq-reach-note";

  const details = root.querySelector?.(".test-details");
  if (details?.parentElement) details.parentElement.insertBefore(el, details.nextSibling);
  else root.appendChild(el);

  return el;
}

function isEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, SETTING_KEYS.AUTO_REACH_DIFFICULTY);
  } catch (_e) {
    return false;
  }
}

function isMeleeLikeByReach(item, root) {
  if (readItemReach(item) != null) return true;
  const detailsText = root.querySelector?.(".test-details")?.textContent ?? "";
  return /\bReach\s*\d+\b/i.test(detailsText);
}

function computeReachAdjustment({ attackerItemReach, targetActor }) {
  const hasGuardBroken = targetActor?.effects?.some((e) => {
    const statuses = e?.statuses ?? e?._source?.statuses;
    if (!statuses) return false;
    if (statuses instanceof Set) return statuses.has("guardBroken");
    if (Array.isArray(statuses)) return statuses.includes("guardBroken");
    return false;
  }) === true;

  const isProne = targetActor?.effects?.some((e) => {
    const statuses = e?.statuses ?? e?._source?.statuses;
    if (!statuses) return false;
    if (statuses instanceof Set) return statuses.has("prone");
    if (Array.isArray(statuses)) return statuses.includes("prone");
    return false;
  }) === true;

  const guardBroken = hasGuardBroken || isProne;

  const defenderReach = computeActorReach(targetActor);
  const attackerReach = attackerItemReach ?? 1;

  const delta = guardBroken ? 0 : Math.max(0, defenderReach - attackerReach);
  return {
    delta,
    attackerReach,
    defenderReach,
    hasNoGuard: guardBroken,
    hasGuardBroken: guardBroken
  };
}

function bindReachRecompute(root, getItemFn) {
  const rollBtn = root.querySelector?.("button.roll-skill-check");
  if (!rollBtn) return;

  if (rollBtn.dataset.c2mqReachBound === "1") return;
  rollBtn.dataset.c2mqReachBound = "1";

  rollBtn.addEventListener("click", () => {
    try {
      if (!isEnabled()) return;

      const item = getItemFn();
      if (!isMeleeLikeByReach(item, root)) return;

      const targets = collectTargets();
      const note = ensureNote(root);

      if (targets.length !== 1) {
        note.textContent = game.i18n.localize("C2MQ.Reach.NoteMultiTarget");
        return;
      }

      const itemReach = readItemReach(item);
      const { delta, attackerReach, defenderReach, hasNoGuard } =
        computeReachAdjustment({ attackerItemReach: itemReach, targetActor: targets[0] });

      if (hasNoGuard) {
        note.textContent = game.i18n.format("C2MQ.Reach.NoteNoGuard", { attackerReach, defenderReach });
        return;
      }

      if (!delta) {
        note.textContent = game.i18n.format("C2MQ.Reach.NoteNoChange", { attackerReach, defenderReach });
        return;
      }

      const base = getActiveDifficulty(root);
      const next = clampDifficulty(base + delta);
      setDifficulty(root, next);

      note.textContent = game.i18n.format("C2MQ.Reach.NoteApplied", {
        delta,
        attackerReach,
        defenderReach,
        base,
        next
      });

      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] reach auto difficulty`, {
          base,
          next,
          delta,
          attackerReach,
          defenderReach
        });
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] reach handler error`, e);
    }
  }, { capture: true });
}

export function registerReachHooks() {
  if (_reachHooksRegistered) return;
  _reachHooksRegistered = true;

  Hooks.on(HOOK_NAMES.SKILL_ROLLER_CONTEXT, (context) => {
    try {
      if (!isEnabled()) return;

      const root = context?.root;
      if (!root) return;

      const getItem = () => context?.app?._c2mqBridgeContext?.item ?? context?.item ?? null;
      const item = getItem();

      if (!isMeleeLikeByReach(item, root)) return;

      const targets = collectTargets();
      const note = ensureNote(root);

      if (!targets.length) {
        note.textContent = game.i18n.localize("C2MQ.Reach.NoteNoTarget");
      } else if (targets.length !== 1) {
        note.textContent = game.i18n.localize("C2MQ.Reach.NoteMultiTarget");
      } else {
        const itemReach = readItemReach(item);
        const { delta, attackerReach, defenderReach, hasNoGuard } =
          computeReachAdjustment({ attackerItemReach: itemReach, targetActor: targets[0] });

        if (hasNoGuard) {
          note.textContent = game.i18n.format("C2MQ.Reach.NoteNoGuard", {
            attackerReach,
            defenderReach
          });
          return;
        }

        if (delta) {
          const base = getActiveDifficulty(root);
          const next = clampDifficulty(base + delta);
          note.textContent = game.i18n.format("C2MQ.Reach.NotePreview", {
            delta,
            attackerReach,
            defenderReach,
            base,
            next
          });
        } else {
          note.textContent = game.i18n.format("C2MQ.Reach.NoteNoChange", {
            attackerReach,
            defenderReach
          });
        }
      }

      bindReachRecompute(root, getItem);
    } catch (e) {
      console.error(`[${MODULE_ID}] skillRollerContext reach error`, e);
    }
  });
}