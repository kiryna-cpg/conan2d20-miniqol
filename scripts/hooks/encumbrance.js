import { MODULE_ID, SETTING_KEYS, HOOK_NAMES } from "../constants.js";
import { debugEnabled } from "../adapter/conan2d20.js";

const LEGACY_VIGOR_ZERO_STATUS_ID = "conan-incapacitated";
const ENCUMBRANCE_FATIGUE_FLAG = "encumbranceFatigue";
const SYNC_DEBOUNCE_MS = 100;

let _hooksRegistered = false;
let _vigorClampPatched = false;

const _debouncers = new Map();

function isEncumbranceFatigueEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, SETTING_KEYS.ENCUMBRANCE_FATIGUE_ENABLED);
  } catch (_e) {
    return true;
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNonNegativeInteger(value) {
  return Math.max(0, Math.floor(toNumber(value, 0)));
}

function getActorKey(actor) {
  return actor?.uuid ?? actor?.id ?? actor?._id ?? null;
}

function isMissingEmbeddedDocumentError(error) {
  return String(error?.message ?? error).includes("does not exist in the EmbeddedCollection");
}

function isActorWritable(actor) {
  if (!actor || actor._deleted === true) return false;

  if (actor.isToken) {
    const tokenDoc = actor.token?.document ?? actor.token ?? null;
    const scene = tokenDoc?.parent ?? tokenDoc?.scene ?? null;
    if (!tokenDoc?.id || !scene?.tokens?.has?.(tokenDoc.id)) return false;
  }

  return true;
}

function isAuthoritativeForActor(actor) {
  if (game.user?.isGM) return true;

  const anyActiveGM = game.users?.some((user) => user.active && user.isGM) === true;
  if (anyActiveGM) return false;

  return actor?.isOwner === true;
}

function logError(context, actor, error) {
  if (isMissingEmbeddedDocumentError(error)) {
    if (debugEnabled()) {
      console.warn(`[${MODULE_ID}] Encumbrance skipped stale token actor during ${context}`, {
        actor: actor?.name,
        actorUuid: actor?.uuid,
        error
      });
    }
    return;
  }

  console.error(`[${MODULE_ID}] Encumbrance ${context} error`, error);
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

function removeLegacyVigorZeroStatusFromConfig() {
  for (const collection of [CONFIG.statusEffects, CONFIG.CONAN?.statusEffects].filter(Array.isArray)) {
    for (let i = collection.length - 1; i >= 0; i -= 1) {
      const effect = collection[i];
      if (effect?.id === LEGACY_VIGOR_ZERO_STATUS_ID || setHasStatus(effect?.statuses, LEGACY_VIGOR_ZERO_STATUS_ID)) {
        collection.splice(i, 1);
      }
    }
  }
}

async function removeLegacyVigorZeroEffects(actor, { reason = "legacyCleanup" } = {}) {
  if (!actor || !isActorWritable(actor) || !isAuthoritativeForActor(actor)) return;

  const effectIds = (Array.from(actor.effects ?? []))
    .filter((effect) => effectHasStatus(effect, LEGACY_VIGOR_ZERO_STATUS_ID))
    .map((effect) => effect.id)
    .filter(Boolean);

  if (!effectIds.length) return;

  try {
    await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);
  } catch (error) {
    logError(reason, actor, error);
  }
}

function actorSupportsEncumbranceFatigue(actor) {
  return actor?.documentName === "Actor" && actor.type === "character" && !!actor.system?.health?.physical;
}

function isItemEquipped(item) {
  return item?.system?.equipped === true || item?.system?.isEquipped === true || item?.isEquipped === true;
}

function isItemStowed(item) {
  const stowedIn = item?.system?.stowedIn;
  return stowedIn !== undefined && stowedIn !== null && String(stowedIn).trim() !== "";
}

function calculateItemEncumbrance(item) {
  if (!item?.system) return 0;
  if (item.type === "consumable" || item.type === "transportation") return 0;
  if (isItemStowed(item)) return 0;

  const encumbrance = Math.max(0, toNumber(item.system.encumbrance, 0));
  const quantity = Math.max(1, toNumber(item.system.quantity, 1));
  if (encumbrance <= 0 || quantity <= 0) return 0;

  // Mirror the Conan system sheet calculation: worn armor does not count,
  // except for additional copies in a stack.
  if (item.type === "armor" && isItemEquipped(item)) {
    return encumbrance * Math.max(0, quantity - 1);
  }

  return encumbrance * quantity;
}

function calculateCarriedEncumbrance(actor) {
  let total = 0;

  for (const item of actor?.items ?? []) {
    total += calculateItemEncumbrance(item);
  }

  return clampNonNegativeInteger(total);
}

function readEncumbranceFatigueFlag(actor) {
  try {
    const flag = actor?.getFlag?.(MODULE_ID, ENCUMBRANCE_FATIGUE_FLAG);
    return flag && typeof flag === "object" ? flag : {};
  } catch (_e) {
    return {};
  }
}

function getPhysicalHealth(actor) {
  return actor?.system?.health?.physical ?? {};
}

function calculatePhysicalMax(actor, fatigue) {
  const system = actor?.system ?? {};
  const brawn = toNumber(system.attributes?.bra?.value, 0);
  const resistance = toNumber(system.skills?.res?.expertise?.value, 0);
  const bonus = toNumber(system.health?.physical?.bonus, 0);
  return Math.max(0, brawn + resistance - clampNonNegativeInteger(fatigue) + bonus);
}

function calculateDesiredEncumbranceFatigueUpdate(actor) {
  if (!actorSupportsEncumbranceFatigue(actor)) return null;

  const physical = getPhysicalHealth(actor);
  const currentFatigue = clampNonNegativeInteger(physical.fatigue);
  const currentValue = clampNonNegativeInteger(physical.value);
  const flag = readEncumbranceFatigueFlag(actor);
  const previousApplied = clampNonNegativeInteger(flag.applied);
  const manualFatigue = Math.max(0, currentFatigue - previousApplied);

  if (!isEncumbranceFatigueEnabled()) {
    if (previousApplied <= 0 && !flag.enabled) return null;

    const nextFatigue = manualFatigue;
    const nextMax = calculatePhysicalMax(actor, nextFatigue);
    const nextValue = Math.min(currentValue, nextMax);

    const updateData = {
      "system.health.physical.fatigue": nextFatigue,
      "system.health.physical.max": nextMax,
      [`flags.${MODULE_ID}.${ENCUMBRANCE_FATIGUE_FLAG}`]: null
    };

    if (currentValue !== nextValue) updateData["system.health.physical.value"] = nextValue;
    return updateData;
  }

  const applied = calculateCarriedEncumbrance(actor);
  const nextFatigue = manualFatigue + applied;
  const nextMax = calculatePhysicalMax(actor, nextFatigue);
  const nextValue = Math.min(currentValue, nextMax);

  const updateData = {};
  if (currentFatigue !== nextFatigue) updateData["system.health.physical.fatigue"] = nextFatigue;
  if (toNumber(physical.max, 0) !== nextMax) updateData["system.health.physical.max"] = nextMax;
  if (currentValue !== nextValue) updateData["system.health.physical.value"] = nextValue;

  const nextFlag = {
    enabled: true,
    applied,
    manual: manualFatigue,
    total: nextFatigue
  };

  const flagChanged =
    flag.enabled !== nextFlag.enabled ||
    clampNonNegativeInteger(flag.applied) !== nextFlag.applied ||
    clampNonNegativeInteger(flag.manual) !== nextFlag.manual ||
    clampNonNegativeInteger(flag.total) !== nextFlag.total;

  if (flagChanged) updateData[`flags.${MODULE_ID}.${ENCUMBRANCE_FATIGUE_FLAG}`] = nextFlag;

  return Object.keys(updateData).length ? updateData : null;
}

async function syncActor(actor, { reason = "syncActor" } = {}) {
  if (!actor || !isActorWritable(actor) || !isAuthoritativeForActor(actor)) return;

  try {
    await removeLegacyVigorZeroEffects(actor, { reason: `${reason}:legacyCleanup` });

    const encumbranceUpdate = calculateDesiredEncumbranceFatigueUpdate(actor);
    if (encumbranceUpdate) await actor.update(encumbranceUpdate);

    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] encumbrance sync`, {
        actor: actor.name,
        actorUuid: actor.uuid,
        reason,
        encumbranceUpdate
      });
    }
  } catch (error) {
    logError(reason, actor, error);
  }
}

function runActorSync(actor, options = {}) {
  void syncActor(actor, options);
}

function scheduleActorSync(actor, { immediate = false, reason = "scheduleActorSync" } = {}) {
  if (!actor || !isActorWritable(actor)) return;

  const key = getActorKey(actor);
  if (!key) return;

  if (immediate) {
    runActorSync(actor, { reason });
    return;
  }

  if (!_debouncers.has(key)) {
    _debouncers.set(key, foundry.utils.debounce(() => runActorSync(actor, { reason }), SYNC_DEBOUNCE_MS));
  }

  _debouncers.get(key)();
}

function collectActorsForSync() {
  const actors = [];

  for (const actor of game.actors ?? []) {
    if (actor) actors.push(actor);
  }

  for (const scene of game.scenes ?? []) {
    for (const tokenDoc of scene.tokens ?? []) {
      if (tokenDoc?.actor) actors.push(tokenDoc.actor);
    }
  }

  for (const token of canvas?.tokens?.placeables ?? []) {
    if (token.actor) actors.push(token.actor);
  }

  const seen = new Set();
  return actors.filter((actor) => {
    const key = getActorKey(actor);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scheduleAllActors({ immediate = false, reason = "scheduleAllActors" } = {}) {
  for (const actor of collectActorsForSync()) {
    scheduleActorSync(actor, { immediate, reason });
  }
}

function isEncumbranceRelevantItem(item) {
  return !!item?.parent && item.parent.documentName === "Actor";
}

function itemUpdateAffectsEncumbrance(changes = {}) {
  const system = changes?.system ?? {};
  return (
    changes.type !== undefined ||
    system.encumbrance !== undefined ||
    system.quantity !== undefined ||
    system.equipped !== undefined ||
    system.isEquipped !== undefined ||
    system.stowedIn !== undefined
  );
}

function patchCharacterVigorClamp() {
  const proto = CONFIG.Actor?.documentClass?.prototype ?? game.actors?.documentClass?.prototype ?? null;
  if (!proto || _vigorClampPatched || proto.__c2mqVigorClampPatched === true) return false;

  if (typeof proto.getMaxVigor === "function") {
    const originalGetMaxVigor = proto.getMaxVigor;
    proto.getMaxVigor = function c2mqClampedGetMaxVigor(...args) {
      return Math.max(0, toNumber(originalGetMaxVigor.apply(this, args), 0));
    };
  }

  if (typeof proto._prepareCharacterData === "function") {
    const originalPrepareCharacterData = proto._prepareCharacterData;
    proto._prepareCharacterData = function c2mqClampedPrepareCharacterData(actorData, ...args) {
      const result = originalPrepareCharacterData.call(this, actorData, ...args);
      const physical = actorData?.health?.physical ?? null;
      if (physical) {
        physical.max = Math.max(0, toNumber(physical.max, 0));
        if (physical.value === null || physical.value === undefined) physical.value = physical.max;
        physical.value = Math.max(0, Math.min(toNumber(physical.value, 0), physical.max));
      }
      return result;
    };
  }

  Object.defineProperty(proto, "__c2mqVigorClampPatched", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  _vigorClampPatched = true;
  return true;
}

export function registerEncumbranceHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  removeLegacyVigorZeroStatusFromConfig();

  Hooks.once("setup", () => {
    removeLegacyVigorZeroStatusFromConfig();
  });

  Hooks.once("ready", () => {
    removeLegacyVigorZeroStatusFromConfig();
    patchCharacterVigorClamp();
    scheduleAllActors({ immediate: true, reason: "ready" });
  });

  Hooks.on(HOOK_NAMES.ENCUMBRANCE_FATIGUE_SETTING_CHANGED, () => {
    scheduleAllActors({ immediate: true, reason: "settingChanged" });
  });

  Hooks.on("canvasReady", () => {
    removeLegacyVigorZeroStatusFromConfig();
    scheduleAllActors({ reason: "canvasReady" });
  });

  Hooks.on("createActor", (actor) => {
    scheduleActorSync(actor, { reason: "createActor" });
  });

  Hooks.on("updateActor", (actor, changes) => {
    if (
      changes?.system?.health?.physical !== undefined ||
      changes?.system?.attributes?.bra !== undefined ||
      changes?.system?.skills?.res !== undefined ||
      changes?.flags?.[MODULE_ID]?.[ENCUMBRANCE_FATIGUE_FLAG] !== undefined
    ) {
      scheduleActorSync(actor, { reason: "updateActor" });
    }
  });

  Hooks.on("createItem", (item) => {
    if (isEncumbranceRelevantItem(item)) scheduleActorSync(item.parent, { reason: "createItem" });
  });

  Hooks.on("updateItem", (item, changes) => {
    if (isEncumbranceRelevantItem(item) && itemUpdateAffectsEncumbrance(changes)) {
      scheduleActorSync(item.parent, { reason: "updateItem" });
    }
  });

  Hooks.on("deleteItem", (item) => {
    if (isEncumbranceRelevantItem(item)) scheduleActorSync(item.parent, { reason: "deleteItem" });
  });
}
