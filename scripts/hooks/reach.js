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
  if (!btn || btn.classList.contains("active")) return false;

  btn.click();
  return true;
}

function collectTargets() {
  return Array.from(game.user?.targets ?? []).filter(Boolean);
}

function ensureNote(root) {
  let el = root.querySelector?.(".c2mq-reach-note");
  if (el) return el;

  el = document.createElement("div");
  el.className = "c2mq-reach-note";

  const warning = root.querySelector?.(".difficulty-increased");
  const details = root.querySelector?.(".test-details");
  const anchor = warning ?? details;

  if (anchor?.parentElement) anchor.parentElement.insertBefore(el, anchor.nextSibling);
  else root.appendChild(el);

  return el;
}

function setReachMessage(root, text = "", { warning = false, bonus = false } = {}) {
  const el = ensureNote(root);
  el.textContent = text;
  el.classList.toggle("is-warning", !!warning);
  el.classList.toggle("is-bonus", !!bonus);
  el.style.display = text ? "" : "none";
  return el;
}

function autoFitSkillRoller(app) {
  if (!app?.setPosition) return;

  queueMicrotask(() => {
    requestAnimationFrame(() => {
      try {
        app.setPosition({ height: "auto" });
      } catch (_e) {
        // Ignore auto-fit failures.
      }
    });
  });
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

function setHasStatus(statuses, statusId) {
  if (!statuses) return false;
  if (statuses instanceof Set) return statuses.has(statusId);
  if (Array.isArray(statuses)) return statuses.includes(statusId);
  return false;
}

function effectHasStatus(effect, statusId) {
  const statuses = effect?.statuses ?? effect?._source?.statuses ?? null;
  return setHasStatus(statuses, statusId);
}

function targetHasNoGuardState(targetToken) {
  const actor = targetToken?.actor ?? null;
  const tokenDoc = targetToken?.document ?? null;

  const actorStatuses = actor?.statuses ?? null;
  const tokenStatuses = tokenDoc?.statuses ?? null;

  const guardBrokenFromStatuses =
    setHasStatus(actorStatuses, "guardBroken") ||
    setHasStatus(tokenStatuses, "guardBroken");

  const proneFromStatuses =
    setHasStatus(actorStatuses, "prone") ||
    setHasStatus(tokenStatuses, "prone");

  const guardBrokenFromEffects = actor?.effects?.some((e) =>
    !e.disabled && effectHasStatus(e, "guardBroken")
  ) === true;

  const proneFromEffects = actor?.effects?.some((e) =>
    !e.disabled && effectHasStatus(e, "prone")
  ) === true;

  return guardBrokenFromStatuses || proneFromStatuses || guardBrokenFromEffects || proneFromEffects;
}

function computeReachAdjustment({ attackerItemReach, targetToken }) {
  const defenderActor = targetToken?.actor ?? null;
  const defenderReach = computeActorReach(defenderActor);
  const attackerReach = attackerItemReach ?? 1;
  const defenderHasNoGuard = targetHasNoGuardState(targetToken);

  const reachGap = Math.max(0, defenderReach - attackerReach);

  return {
    attackerReach,
    defenderReach,
    defenderHasNoGuard,
    difficultyDelta: defenderHasNoGuard ? 0 : reachGap,
    bonusDiceDelta: defenderHasNoGuard ? reachGap : 0
  };
}

function getStoredBaseDifficulty(app, root) {
  const current = getActiveDifficulty(root);

  if (app && app._c2mqReachBaseDifficulty == null) {
    app._c2mqReachBaseDifficulty = current;
  }

  return app?._c2mqReachBaseDifficulty ?? current;
}

function resetAutoDifficultyIfSafe(root, app = null) {
  const base = getStoredBaseDifficulty(app, root);
  const current = getActiveDifficulty(root);
  const lastAuto = app?._c2mqReachLastAutoDifficulty ?? null;

  const untouched = lastAuto != null && current === lastAuto;
  if (untouched && current !== base) {
    setDifficulty(root, base);
  }

  if (app) app._c2mqReachLastAutoDifficulty = null;
}

function getCurrentAutoBonusDice(app) {
  return Math.max(0, Number(app?._c2mqReachLastAutoBonusDice ?? 0) || 0);
}

function getCurrentManualBonusDice(app) {
  const totalBonusDice = Math.max(0, Number(app?.rollData?.bonus?.dice ?? 0) || 0);
  const autoBonusDice = getCurrentAutoBonusDice(app);
  return Math.max(0, totalBonusDice - autoBonusDice);
}

async function applyAutoBonusDice(app, nextAutoBonusDice = 0) {
  if (!app?.rollData) return;

  const currentAutoBonusDice = getCurrentAutoBonusDice(app);
  const currentBonusDice = Math.max(0, Number(app.rollData?.bonus?.dice ?? 0) || 0);
  const manualBonusDice = getCurrentManualBonusDice(app);
  const currentNumDice = Math.max(0, Number(app.rollData?.numDice ?? 0) || 0);
  const maxDice = Math.max(0, Number(app?.maxDice ?? 5) || 5);

  const numDiceWithoutCurrentAuto = Math.max(0, currentNumDice - currentAutoBonusDice);
  const remainingSlots = Math.max(0, maxDice - numDiceWithoutCurrentAuto);
  const safeAutoBonusDice = Math.max(
    0,
    Math.min(Number(nextAutoBonusDice ?? 0) || 0, remainingSlots)
  );

  const nextBonusDice = manualBonusDice + safeAutoBonusDice;
  const delta = nextBonusDice - currentBonusDice;

  app.rollData.bonus = app.rollData.bonus ?? {};
  app.rollData.bonus.dice = nextBonusDice;
  app.rollData.numDice = Math.max(0, currentNumDice + delta);
  app._c2mqReachLastAutoBonusDice = safeAutoBonusDice;

  if (typeof app._updateAllFormValues === "function") {
    app._updateAllFormValues();
  }

  if (typeof app._updateDiceIcons === "function") {
    await app._updateDiceIcons();
  }
}

async function clearReachAutoBonusDice(app) {
  await applyAutoBonusDice(app, 0);
}

async function syncReachModifiers({ root, app = null, item = null } = {}) {
  try {
    if (!isEnabled()) return;
    if (!root) return;

    if (!isMeleeLikeByReach(item, root)) {
      resetAutoDifficultyIfSafe(root, app);
      await clearReachAutoBonusDice(app);
      setReachMessage(root, "");
      autoFitSkillRoller(app);
      return;
    }

    const targets = collectTargets();

    if (targets.length !== 1) {
      resetAutoDifficultyIfSafe(root, app);
      await clearReachAutoBonusDice(app);
      setReachMessage(root, "");
      autoFitSkillRoller(app);
      return;
    }

    const itemReach = readItemReach(item);
    const {
      attackerReach,
      defenderReach,
      difficultyDelta,
      bonusDiceDelta
    } = computeReachAdjustment({
      attackerItemReach: itemReach,
      targetToken: targets[0]
    });

    const base = getStoredBaseDifficulty(app, root);
    const current = getActiveDifficulty(root);
    const lastAutoDifficulty = app?._c2mqReachLastAutoDifficulty ?? null;

    const untouchedByUser =
      lastAutoDifficulty == null
        ? current === base
        : current === lastAutoDifficulty;

    if (difficultyDelta > 0) {
      const desired = clampDifficulty(base + difficultyDelta);

      await clearReachAutoBonusDice(app);

      if (untouchedByUser && current !== desired) {
        setDifficulty(root, desired);
      }

      if (app) app._c2mqReachLastAutoDifficulty = desired;

      setReachMessage(
        root,
        game.i18n.format("C2MQ.Reach.NoteApplied", {
          delta: difficultyDelta,
          attackerReach,
          defenderReach
        }),
        { warning: true }
      );

      autoFitSkillRoller(app);

      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] reach sync`, {
          mode: "difficulty",
          base,
          current,
          desired,
          difficultyDelta,
          bonusDiceDelta,
          attackerReach,
          defenderReach,
          lastAutoDifficulty
        });
      }

      return;
    }

    resetAutoDifficultyIfSafe(root, app);

    if (bonusDiceDelta > 0) {
      await applyAutoBonusDice(app, bonusDiceDelta);

      setReachMessage(
        root,
        game.i18n.format("C2MQ.Reach.NoteBonusDice", {
          delta: bonusDiceDelta,
          attackerReach,
          defenderReach
        }),
        { bonus: true }
      );

      autoFitSkillRoller(app);

      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] reach sync`, {
          mode: "bonus-dice",
          base,
          current,
          difficultyDelta,
          bonusDiceDelta,
          attackerReach,
          defenderReach,
          lastAutoDifficulty
        });
      }

      return;
    }

    await clearReachAutoBonusDice(app);
    setReachMessage(root, "");
    autoFitSkillRoller(app);

    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] reach sync`, {
        mode: "none",
        base,
        current,
        difficultyDelta,
        bonusDiceDelta,
        attackerReach,
        defenderReach,
        lastAutoDifficulty
      });
    }
  } catch (e) {
    console.error(`[${MODULE_ID}] reach sync error`, e);
  }
}

function bindReachRecompute(root, getItemFn, app = null) {
  const rollBtn = root.querySelector?.("button.roll-skill-check");
  if (!rollBtn) return;

  if (rollBtn.dataset.c2mqReachBound === "1") return;
  rollBtn.dataset.c2mqReachBound = "1";

  rollBtn.addEventListener("click", () => {
    void syncReachModifiers({
      root,
      app,
      item: getItemFn()
    });
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

      bindReachRecompute(root, getItem, context?.app ?? null);

      queueMicrotask(() => {
        void syncReachModifiers({
          root,
          app: context?.app ?? null,
          item: getItem()
        });
      });
    } catch (e) {
      console.error(`[${MODULE_ID}] skillRollerContext reach error`, e);
    }
  });
}