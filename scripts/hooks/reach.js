import { MODULE_ID, SETTING_KEYS } from "../constants.js";
import { computeActorReach, readItemReach, debugEnabled } from "../adapter/conan2d20.js";

let _reachHooksRegistered = false;

function getRootEl(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

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

function inferItemFromApp(app, data) {
  // Try the most likely places for system apps.
  const actorId = data?.rollData?.actorId ?? data?.actorId ?? app?.actor?.id ?? app?.object?.actor?.id ?? null;
  const itemId = data?.rollData?.item?._id ?? data?.item?._id ?? data?.itemId ?? app?.item?.id ?? null;

  const actor = actorId ? (game.actors?.get(actorId) ?? null) : (app?.actor ?? null);
  const item = (actor && itemId) ? (actor.items?.get(itemId) ?? null) : (app?.item ?? null);

  if (item) return item;

  // Fallback: parse Reach X from the "test-details" text.
  const details = data?.difficulty?.display ?? rootText(app) ?? "";
  const mm = String(details).match(/\bReach\s*(\d+)\b/i);
  if (mm?.[1]) {
    return { system: { range: Number(mm[1]) } };
  }

  return null;
}

function rootText(app) {
  try {
    const el = app?.element?.[0] ?? app?.element;
    if (!el) return "";
    return el.textContent ?? "";
  } catch (_e) {
    return "";
  }
}

function collectTargets() {
  return Array.from(game.user?.targets ?? []).map(t => t.actor).filter(Boolean);
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
  // Some dialogs may not expose item; fallback to presence of "Reach" in details.
  const detailsText = root.querySelector?.(".test-details")?.textContent ?? "";
  return /\bReach\s*\d+\b/i.test(detailsText);
}

function computeReachAdjustment({ attackerItemReach, targetActor }) {
  // RAW (core): if target's Reach is longer than the attacker's weapon, difficulty increases
  // by 1 step per point of difference (Guard-dependent).
  // MiniQoL: treat Guard as present unless the target has the "No Guard" status.
  const hasNoGuard = targetActor?.effects?.some(e => {
    const statuses = e?.statuses ?? e?._source?.statuses;
    if (!statuses) return false;
    if (statuses instanceof Set) return statuses.has("c2mq-no-guard");
    if (Array.isArray(statuses)) return statuses.includes("c2mq-no-guard");
    return false;
  }) === true;

  const defenderReach = computeActorReach(targetActor);
  const attackerReach = attackerItemReach ?? 1;

  const delta = hasNoGuard ? 0 : Math.max(0, defenderReach - attackerReach);
  return { delta, attackerReach, defenderReach, hasNoGuard };
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
      const { delta, attackerReach, defenderReach, hasNoGuard } = computeReachAdjustment({ attackerItemReach: itemReach, targetActor: targets[0] });

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

      note.textContent = game.i18n.format("C2MQ.Reach.NoteApplied", { delta, attackerReach, defenderReach, base, next });

      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] reach auto difficulty`, { base, next, delta, attackerReach, defenderReach });
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] reach handler error`, e);
    }
  }, { capture: true });
}

export function registerReachHooks() {
  if (_reachHooksRegistered) return;
  _reachHooksRegistered = true;

  Hooks.on("renderSkillRoller", (app, html, data) => {
    try {
      if (!isEnabled()) return;

      const root = getRootEl(html);
      if (!root) return;

      const getItem = () => inferItemFromApp(app, data);
      const item = getItem();

      if (!isMeleeLikeByReach(item, root)) return;

      // Provide a hint immediately (doesn't change difficulty until user clicks Roll Dice).
      const targets = collectTargets();
      const note = ensureNote(root);

      if (!targets.length) {
        note.textContent = game.i18n.localize("C2MQ.Reach.NoteNoTarget");
      } else if (targets.length !== 1) {
        note.textContent = game.i18n.localize("C2MQ.Reach.NoteMultiTarget");
      } else {
        const itemReach = readItemReach(item);
        const { delta, attackerReach, defenderReach, hasNoGuard } = computeReachAdjustment({ attackerItemReach: itemReach, targetActor: targets[0] });

        if (hasNoGuard) {
          note.textContent = game.i18n.format("C2MQ.Reach.NoteNoGuard", { attackerReach, defenderReach });
          return;
        }

        if (delta) {
          const base = getActiveDifficulty(root);
          const next = clampDifficulty(base + delta);
          note.textContent = game.i18n.format("C2MQ.Reach.NotePreview", { delta, attackerReach, defenderReach, base, next });
        } else {
          note.textContent = game.i18n.format("C2MQ.Reach.NoteNoChange", { attackerReach, defenderReach });
        }
      }

      bindReachRecompute(root, getItem);
    } catch (e) {
      console.error(`[${MODULE_ID}] renderSkillRoller reach error`, e);
    }
  });
}
