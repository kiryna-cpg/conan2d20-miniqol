import {
  MODULE_ID,
  SETTING_KEYS,
  HOOK_NAMES,
  LEGACY_REACH_STATUS_MODULE_ID,
  REACH_STATUS
} from "../constants.js";
import { readItemReach, debugEnabled } from "../adapter/conan2d20.js";
import { isNpcAttackUnequipped } from "../utils/npc-attack-equipment.js";

const {
  MAX_REACH,
  NO_REACH_ID,
  REACH_IDS,
  ALL_STATUS_IDS,
  FLAG_MANUAL_STATUS,
  FLAG_MANUAL_MARKER
} = REACH_STATUS;

let _reachStatusHooksRegistered = false;
let _enforcingExclusivity = false;
const _debouncers = new Map();

function isLegacyReachStatusActive() {
  return game.modules?.get(LEGACY_REACH_STATUS_MODULE_ID)?.active === true;
}

function isReachStatusEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, SETTING_KEYS.REACH_STATUS_ENABLED);
  } catch (_e) {
    return true;
  }
}

function showReach1Status() {
  try {
    return !!game.settings.get(MODULE_ID, SETTING_KEYS.SHOW_REACH_1_STATUS);
  } catch (_e) {
    return true;
  }
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function isAuthoritativeForActor(actor) {
  if (game.user?.isGM) return true;

  const anyActiveGM = game.users?.some((user) => user.active && user.isGM) === true;
  if (anyActiveGM) return false;

  return actor?.isOwner === true;
}

function rerenderTokenHUD() {
  try {
    const hud = canvas?.hud?.token;
    if (hud?.rendered) hud.render();
  } catch (_e) {
    // Ignore HUD refresh failures.
  }
}

function buildStatusEffectData({ id, name, tooltip, img }) {
  return {
    id,
    name,
    label: name,
    tooltip,
    img,
    hud: true,
    statuses: [id],
    flags: {
      conan2d20: {
        trigger: "endRound",
        value: null
      }
    }
  };
}

function buildStatusEffects() {
  const reachStatuses = REACH_IDS.map((id, index) => {
    const reach = index + 1;
    return buildStatusEffectData({
      id,
      name: `C2MQ.ReachStatus.Name.Reach${reach}`,
      tooltip: `C2MQ.ReachStatus.Tooltip.Reach${reach}`,
      img: `modules/${MODULE_ID}/icons/reach-status/reach-${reach}.webp`
    });
  });

  return [
    ...reachStatuses,
    buildStatusEffectData({
      id: NO_REACH_ID,
      name: "C2MQ.ReachStatus.Name.NoReach",
      tooltip: "C2MQ.ReachStatus.Tooltip.NoReach",
      img: `modules/${MODULE_ID}/icons/reach-status/no-reach.webp`
    })
  ];
}

function normalizeStatusEffect(effect, template) {
  if (!effect) return template;

  effect.name ??= template.name;
  effect.label ??= template.label;
  effect.tooltip ??= template.tooltip;
  effect.img ??= template.img;
  effect.hud = template.hud;

  const statuses = effect.statuses instanceof Set
    ? Array.from(effect.statuses)
    : Array.isArray(effect.statuses)
      ? [...effect.statuses]
      : [];

  if (!statuses.includes(template.id)) statuses.push(template.id);
  effect.statuses = statuses;

  effect.flags ??= {};
  effect.flags.conan2d20 ??= {};
  effect.flags.conan2d20.trigger ??= "endRound";
  if (effect.flags.conan2d20.value === undefined) effect.flags.conan2d20.value = null;

  return effect;
}

function registerStatusEffects() {
  const targets = [CONFIG.statusEffects, CONFIG.CONAN?.statusEffects].filter(Array.isArray);
  if (!targets.length) return;

  const templates = buildStatusEffects();

  for (const collection of targets) {
    for (const template of templates) {
      const existing = collection.find((effect) => effect?.id === template.id);
      if (existing) {
        normalizeStatusEffect(existing, template);
        continue;
      }

      collection.push(foundry.utils.duplicate(template));
    }
  }
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

function actorHasStatus(actor, statusId) {
  return actor?.effects?.some((effect) => !effect.disabled && effectHasStatus(effect, statusId)) === true;
}

function getReachStatusIdFromEffect(effect) {
  return ALL_STATUS_IDS.find((id) => effectHasStatus(effect, id)) ?? null;
}

function getReachStatusIdFromSource(source) {
  const statuses = source?.statuses ?? source?._source?.statuses ?? null;
  return ALL_STATUS_IDS.find((id) => setHasStatus(statuses, id)) ?? null;
}

function hasConanConditionValueFlag(doc) {
  return doc?.flags?.conan2d20?.value !== undefined;
}

function buildConanConditionFlagUpdate(doc) {
  return {
    "flags.conan2d20.trigger": doc?.flags?.conan2d20?.trigger ?? "endRound",
    "flags.conan2d20.value": doc?.flags?.conan2d20?.value ?? null
  };
}

async function normalizeReachActiveEffect(effect, { context = "normalizeActiveEffect" } = {}) {
  if (!effect || !getReachStatusIdFromEffect(effect)) return false;
  if (hasConanConditionValueFlag(effect)) return false;

  try {
    await effect.update(buildConanConditionFlagUpdate(effect));
    return true;
  } catch (error) {
    const actor = effect.parent?.documentName === "Actor" ? effect.parent : null;
    logReachStatusError(context, actor, error);
    return false;
  }
}

async function normalizeActorReachActiveEffects(actor) {
  if (!actor || actor.documentName !== "Actor") return;
  if (!isActorReachStatusWritable(actor) || !isAuthoritativeForActor(actor)) return;

  for (const effect of actor.effects ?? []) {
    await normalizeReachActiveEffect(effect, { context: "normalizeActorReachActiveEffects" });
  }
}

async function normalizeAllReachActiveEffects() {
  const actors = [];

  for (const actor of game.actors ?? []) {
    if (actor) actors.push(actor);
  }

  for (const scene of game.scenes ?? []) {
    for (const tokenDoc of scene.tokens ?? []) {
      const actor = tokenDoc?.actor ?? null;
      if (actor) actors.push(actor);
    }
  }

  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.actor) actors.push(token.actor);
  }

  const seen = new Set();
  for (const actor of actors) {
    const key = actor.uuid ?? actor.id ?? actor._id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await normalizeActorReachActiveEffects(actor);
  }
}

function isMissingEmbeddedDocumentError(error) {
  return String(error?.message ?? error).includes("does not exist in the EmbeddedCollection");
}

function isActorReachStatusWritable(actor) {
  if (!actor || actor._deleted === true) return false;

  if (actor.isToken) {
    const tokenDoc = actor.token?.document ?? actor.token ?? null;
    const scene = tokenDoc?.parent ?? tokenDoc?.scene ?? null;
    if (!tokenDoc?.id || !scene?.tokens?.has?.(tokenDoc.id)) return false;
  }

  return true;
}

function logReachStatusError(context, actor, error) {
  if (isMissingEmbeddedDocumentError(error)) {
    if (debugEnabled()) {
      console.warn(`[${MODULE_ID}] Reach Status skipped stale token actor during ${context}`, {
        actor: actor?.name,
        actorUuid: actor?.uuid,
        error
      });
    }
    return;
  }

  console.error(`[${MODULE_ID}] Reach Status ${context} error`, error);
}

async function applyExclusiveStatus(actor, activeId) {
  if (!isActorReachStatusWritable(actor)) return;

  await normalizeActorReachActiveEffects(actor);

  _enforcingExclusivity = true;
  try {
    for (const id of ALL_STATUS_IDS) {
      const active = id === activeId;
      if (actorHasStatus(actor, id) === active) continue;

      try {
        await actor.toggleStatusEffect(id, { active });
      } catch (error) {
        if (!isMissingEmbeddedDocumentError(error)) throw error;
        logReachStatusError("toggleStatusEffect", actor, error);
        return;
      }
    }
  } finally {
    _enforcingExclusivity = false;
  }

  rerenderTokenHUD();
}

function getFlagDocument(actor) {
  if (actor?.isToken) return actor.token?.document ?? actor.token ?? actor;
  return actor;
}

function readDocumentFlag(doc, namespace, key) {
  try {
    return doc?.getFlag?.(namespace, key);
  } catch (_e) {
    return undefined;
  }
}

function getManualFlags(actor) {
  const doc = getFlagDocument(actor);
  const manualId =
    readDocumentFlag(doc, MODULE_ID, FLAG_MANUAL_STATUS) ??
    readDocumentFlag(doc, LEGACY_REACH_STATUS_MODULE_ID, FLAG_MANUAL_STATUS);

  const marker =
    readDocumentFlag(doc, MODULE_ID, FLAG_MANUAL_MARKER) === true ||
    readDocumentFlag(doc, LEGACY_REACH_STATUS_MODULE_ID, FLAG_MANUAL_MARKER) === true;

  return { manualId, marker };
}

async function setManualFlags(actor, manualId) {
  const doc = getFlagDocument(actor);
  if (!doc?.update) return;

  await doc.update({
    [`flags.${MODULE_ID}.${FLAG_MANUAL_STATUS}`]: manualId,
    [`flags.${MODULE_ID}.${FLAG_MANUAL_MARKER}`]: true
  });
}

async function clearManualFlags(actor) {
  const doc = getFlagDocument(actor);
  if (!doc?.update) return;

  await doc.update({
    [`flags.${MODULE_ID}.${FLAG_MANUAL_STATUS}`]: null,
    [`flags.${MODULE_ID}.${FLAG_MANUAL_MARKER}`]: null,
    [`flags.${LEGACY_REACH_STATUS_MODULE_ID}.${FLAG_MANUAL_STATUS}`]: null,
    [`flags.${LEGACY_REACH_STATUS_MODULE_ID}.${FLAG_MANUAL_MARKER}`]: null
  });
}

function isEquippedWeapon(item) {
  if (item?.type !== "weapon") return false;
  const equipped =
    item.system?.equipped ??
    item.system?.isEquipped ??
    item.system?.equippedWeapon;
  return equipped === true;
}

function getPcReach(actor) {
  const weapons = Array.from(actor?.items ?? []).filter(isEquippedWeapon);
  const reaches = weapons
    .map(readItemReach)
    .filter((reach) => Number.isFinite(reach) && reach > 0);
  return reaches.length ? Math.max(...reaches) : 0;
}

function getNpcReach(actor) {
  const allowedTypes = new Set(["npcattack", "weapon"]);
  const candidates = Array.from(actor?.items ?? []).filter((item) => {
    if (!allowedTypes.has(item.type)) return false;
    return item.type !== "npcattack" || !isNpcAttackUnequipped(item);
  });
  const reaches = candidates
    .map(readItemReach)
    .filter((reach) => Number.isFinite(reach) && reach > 0);
  return reaches.length ? Math.max(...reaches) : 0;
}

async function redrawActorTokenEffects(actor) {
  if (!isActorReachStatusWritable(actor)) return;
  if (!canvas?.ready || typeof actor?.getActiveTokens !== "function") return;

  for (const token of actor.getActiveTokens()) {
    try {
      await token.drawEffects?.();
    } catch (error) {
      logReachStatusError("drawEffects", actor, error);
    }
  }
}

async function reconcileManualOverride(actor) {
  if (actor?.type !== "npc") return;

  const { manualId, marker } = getManualFlags(actor);
  if (marker !== true || !manualId) return;

  if (!ALL_STATUS_IDS.includes(manualId) || !actorHasStatus(actor, manualId)) {
    await clearManualFlags(actor);
  }
}

function statusIdForReach(reach) {
  const safeReach = clampNumber(reach, 0, MAX_REACH);
  if (safeReach === 1 && showReach1Status()) return "conan-reach-1";
  if (safeReach >= 2) return `conan-reach-${safeReach}`;
  return null;
}

async function setReachStatus(actor) {
  if (!isActorReachStatusWritable(actor) || !isAuthoritativeForActor(actor)) return;

  await normalizeActorReachActiveEffects(actor);

  if (!isReachStatusEnabled()) {
    await applyExclusiveStatus(actor, null);
    await redrawActorTokenEffects(actor);
    return;
  }

  if (actor.type === "npc") await reconcileManualOverride(actor);

  if (actorHasStatus(actor, NO_REACH_ID)) {
    await applyExclusiveStatus(actor, NO_REACH_ID);
    await redrawActorTokenEffects(actor);
    return;
  }

  if (actor.type === "npc") {
    const { manualId, marker } = getManualFlags(actor);
    if (marker === true && manualId && ALL_STATUS_IDS.includes(manualId)) {
      await applyExclusiveStatus(actor, manualId);
      await redrawActorTokenEffects(actor);
      return;
    }
  }

  const reachValue = actor.type === "npc" ? getNpcReach(actor) : getPcReach(actor);
  const targetId = statusIdForReach(reachValue);

  await applyExclusiveStatus(actor, targetId);
  await redrawActorTokenEffects(actor);

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] reach status sync`, {
      actor: actor.name,
      actorUuid: actor.uuid,
      reachValue,
      targetId
    });
  }
}

function runReachStatus(actor) {
  void setReachStatus(actor).catch((error) => logReachStatusError("sync", actor, error));
}

function scheduleReachStatus(actor, { immediate = false } = {}) {
  if (!isActorReachStatusWritable(actor)) return;

  const key = actor.uuid ?? actor.id ?? actor._id;
  if (!key) return;

  if (immediate) {
    runReachStatus(actor);
    return;
  }

  if (!_debouncers.has(key)) {
    _debouncers.set(key, foundry.utils.debounce(() => runReachStatus(actor), 100));
  }

  _debouncers.get(key)();
}

function scheduleAllCanvasActors({ immediate = false } = {}) {
  if (!canvas?.ready) return;

  for (const token of canvas.tokens?.placeables ?? []) {
    if (token.actor) scheduleReachStatus(token.actor, { immediate });
  }
}

function shouldRecomputeForItem(item) {
  return item?.type === "weapon" || item?.type === "npcattack";
}

function getHtmlRoot(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.querySelector) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element?.[0] instanceof HTMLElement) return html.element[0];
  return null;
}

async function migrateLegacyShowReach1Setting() {
  const worldSettings = game.settings?.storage?.get?.("world");
  if (!worldSettings) return;

  const legacyKey = `${LEGACY_REACH_STATUS_MODULE_ID}.showReach1`;
  const newKey = `${MODULE_ID}.${SETTING_KEYS.SHOW_REACH_1_STATUS}`;

  if (!worldSettings.has?.(legacyKey) || worldSettings.has?.(newKey)) return;

  const legacyValue = worldSettings.get(legacyKey)?.value;
  if (typeof legacyValue !== "boolean") return;

  await game.settings.set(MODULE_ID, SETTING_KEYS.SHOW_REACH_1_STATUS, legacyValue);
}

export function registerReachStatusHooks() {
  if (_reachStatusHooksRegistered) return;
  _reachStatusHooksRegistered = true;

  if (isLegacyReachStatusActive()) {
    Hooks.once("ready", () => {
      ui.notifications?.warn(game.i18n.localize("C2MQ.Warn.LegacyReachStatusActive"));
      console.warn(`[${MODULE_ID}] ${LEGACY_REACH_STATUS_MODULE_ID} is active; MiniQoL Reach Status sync is disabled to avoid duplicate hooks.`);
    });
    return;
  }

  registerStatusEffects();

  Hooks.once("setup", () => {
    registerStatusEffects();
  });

  Hooks.once("ready", () => {
    registerStatusEffects();
    void migrateLegacyShowReach1Setting()
      .then(() => normalizeAllReachActiveEffects())
      .then(() => scheduleAllCanvasActors({ immediate: true }));
  });

  Hooks.on(HOOK_NAMES.REACH_STATUS_SETTING_CHANGED, () => {
    scheduleAllCanvasActors({ immediate: true });
  });

  Hooks.on("updateItem", (item) => {
    const actor = item.parent;
    if (actor && shouldRecomputeForItem(item)) scheduleReachStatus(actor);
  });

  Hooks.on("createItem", (item) => {
    const actor = item.parent;
    if (actor && shouldRecomputeForItem(item)) scheduleReachStatus(actor);
  });

  Hooks.on("deleteItem", (item) => {
    const actor = item.parent;
    if (actor && shouldRecomputeForItem(item)) scheduleReachStatus(actor);
  });

  Hooks.on("createToken", (tokenDoc) => {
    const actor = tokenDoc?.actor;
    if (actor) scheduleReachStatus(actor);
  });

  Hooks.on("updateToken", (tokenDoc) => {
    const actor = tokenDoc?.actor;
    if (actor) scheduleReachStatus(actor);
  });

  Hooks.on("renderTokenHUD", (hud, html) => {
    const actor = hud?.object?.actor;
    if (!actor) return;

    const root = getHtmlRoot(html);
    if (!root) return;

    if (!isReachStatusEnabled()) {
      for (const id of ALL_STATUS_IDS) {
        root.querySelectorAll(`[data-status-id="${id}"]`).forEach((el) => el.remove());
      }
      return;
    }

    const allowReachHud = game.user?.isGM === true && actor.type === "npc";

    if (!allowReachHud) {
      for (const id of REACH_IDS) {
        root.querySelectorAll(`[data-status-id="${id}"]`).forEach((el) => el.remove());
      }
      return;
    }

    root.querySelectorAll("[data-status-id]").forEach((el) => {
      const statusId = el.getAttribute("data-status-id");
      if (!ALL_STATUS_IDS.includes(statusId)) return;
      if (el.dataset.c2mqReachStatusBound === "1") return;

      el.dataset.c2mqReachStatusBound = "1";

      el.addEventListener("click", async (event) => {
        try {
          event.preventDefault();
          event.stopPropagation();

          if (_enforcingExclusivity) return;
          if (!isAuthoritativeForActor(actor)) return;

          const currentlyActive = actorHasStatus(actor, statusId);

          if (currentlyActive) {
            await applyExclusiveStatus(actor, null);
            await clearManualFlags(actor);
            await redrawActorTokenEffects(actor);
            scheduleReachStatus(actor);
            return;
          }

          await applyExclusiveStatus(actor, statusId);

          if (statusId !== NO_REACH_ID) await setManualFlags(actor, statusId);
          else await clearManualFlags(actor);

          await redrawActorTokenEffects(actor);
        } catch (error) {
          console.error(`[${MODULE_ID}] Reach Status HUD click handler error`, error);
        }
      }, { capture: true });
    });
  });

  Hooks.on("preCreateActiveEffect", (effect, data) => {
    const addedId = getReachStatusIdFromSource(data) ?? getReachStatusIdFromEffect(effect);
    if (!addedId) return;

    effect.updateSource?.(buildConanConditionFlagUpdate(effect));
  });

  Hooks.on("createActiveEffect", async (effect) => {
    if (_enforcingExclusivity || !isReachStatusEnabled()) return;

    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;
    if (!isActorReachStatusWritable(actor) || !isAuthoritativeForActor(actor)) return;

    const addedId = ALL_STATUS_IDS.find((id) => effectHasStatus(effect, id));
    if (!addedId) return;

    await normalizeReachActiveEffect(effect, { context: "createActiveEffect" });
    scheduleReachStatus(actor, { immediate: true });
  });

  Hooks.on("deleteActiveEffect", async (effect) => {
    if (_enforcingExclusivity || !isReachStatusEnabled()) return;

    const actor = effect.parent;
    if (!actor || actor.documentName !== "Actor") return;
    if (!isActorReachStatusWritable(actor) || !isAuthoritativeForActor(actor)) return;

    const removedId = ALL_STATUS_IDS.find((id) => effectHasStatus(effect, id));
    if (!removedId) return;

    if (actor.type === "npc") {
      const { manualId, marker } = getManualFlags(actor);
      if (marker === true && manualId === removedId) {
        await clearManualFlags(actor);
      }
    }

    scheduleReachStatus(actor, { immediate: true });
  });

  Hooks.on("canvasReady", () => {
    void normalizeAllReachActiveEffects().then(() => scheduleAllCanvasActors());
  });
}
