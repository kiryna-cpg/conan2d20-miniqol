import { MODULE_ID, SETTING_KEYS } from "../constants.js";

/**
 * Conan 2d20 adapter layer.
 * Keep all system-specific heuristics here so the core workflow stays stable.
 */

export function debugEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, SETTING_KEYS.DEBUG);
  } catch (_e) {
    return false;
  }
}

export function getSceneScopeId() {
  // "Once per scene" scope: prefer Combat, fallback to Scene.
  return game.combat?.id ?? canvas?.scene?.id ?? "unknown-scope";
}

export function getHitLocationEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.HIT_LOCATION_ENABLED);
}

/**
 * Hit Location mapping (core rules).
 * Use Conan system canonical location ids so downstream armor coverage and soak
 * resolution match item.system.coverage.value and actor.system.armor.* paths.
 *
 * Canonical ids:
 * - head
 * - torso
 * - larm
 * - rarm
 * - lleg
 * - rleg
 */
export function hitLocationFromD20(d20) {
  const r = Number(d20 ?? 0);
  if (r >= 1 && r <= 2) return { key: "head", label: "Head" };
  if (r >= 3 && r <= 5) return { key: "rarm", label: "Right arm" };
  if (r >= 6 && r <= 8) return { key: "larm", label: "Left arm" };
  if (r >= 9 && r <= 14) return { key: "torso", label: "Torso" };
  if (r >= 15 && r <= 17) return { key: "rleg", label: "Right leg" };
  if (r >= 18 && r <= 20) return { key: "lleg", label: "Left leg" };
  return { key: "torso", label: "Torso" };
}

/**
 * Damage spec resolver.
 * We try to find a "damage dice" value on the item. If missing, return null.
 * Supported strings:
 * - "4", "4§", "4cd", "4cd+2", "4§+2", "4 + 2"
 */
export function resolveDamageSpec(_attackerActor, item) {
  // Conan2d20 schema (confirmed):
  // item.system.damage = { dice: <number>, type: "physical" | "mental" | ... }
  const dice = Number(item?.system?.damage?.dice ?? 0);
  if (!Number.isFinite(dice) || dice <= 0) return null;

  const type = String(item?.system?.damage?.type ?? "physical");
  return { dice, static: 0, type };
}

/**
 * Roll "combat dice" as d6 with mapping:
 * 1=>1, 2=>2, 3-4=>0, 5-6=>1 (+Effect)
 * Returns { faces: number[], total: number, effects: number }
 */
export async function rollCombatDice(diceCount) {
  const n = Math.max(0, Number(diceCount ?? 0) || 0);
  if (!n) return { faces: [], total: 0, effects: 0 };

  const roll = await (new Roll(`${n}d6`)).evaluate();

  const faces = roll.dice?.[0]?.results?.map(r => Number(r.result)) ?? [];
  let total = 0;
  let effects = 0;

  for (const f of faces) {
    if (f === 1) total += 1;
    else if (f === 2) total += 2;
    else if (f === 5 || f === 6) {
      total += 1;
      effects += 1;
    }
  }

  return { faces, total, effects, rawRoll: roll };
}

export function resolveStressPaths(_actor, damageType = "physical") {
  // Conan2d20 schema:
  // Vigor: system.health.physical.value
  // Resolve: system.health.mental.value
  // Wounds: system.health.physical.wounds.value
  // Traumas: system.health.mental.traumas.value
  if (damageType === "mental") {
    return {
      stressPath: "system.health.mental.value",
      harmPath: "system.health.mental.traumas.value"
    };
  }

  return {
    stressPath: "system.health.physical.value",
    harmPath: "system.health.physical.wounds.value"
  };
}

/**
 * Character sheets represent Wounds/Traumas as a dot track (dots.N.status/icon),
 * and the numeric .value may be derived from that track. When dots are present,
 * keep both in sync so automated damage correctly reflects on PC sheets.
 *
 * @param {Actor} actor
 * @param {object} params
 * @param {string} params.trackBasePath  E.g. "system.health.physical.wounds" (without ".value")
 * @param {number} params.afterValue     New numeric value for the track
 * @param {"wound"|"trauma"} [params.kind]
 * @returns {{patches: Array<{path:string,before:any,after:any}>, update: Record<string, any>}}
 */
export function buildDotTrackUpdate(actor, { trackBasePath, afterValue, kind = "wound" } = {}) {
  const patches = [];
  const update = {};
  if (!actor || !trackBasePath) return { patches, update };

  const dotsPath = `${trackBasePath}.dots`;
  const dots = foundry.utils.getProperty(actor, dotsPath);
  if (!dots || typeof dots !== "object") return { patches, update };

  const indices = Object.keys(dots)
    .map(k => Number(k))
    .filter(n => Number.isInteger(n) && n >= 0)
    .sort((a, b) => a - b);

  if (indices.length === 0) return { patches, update };

  const next = Math.max(0, Math.min(Number(afterValue ?? 0) || 0, indices.length));

  // "healed" is the canonical empty state in Conan2d20.
  const emptyStatus = "healed";

  // Filled states are system-internal strings. We default to common values used by the Conan2d20 sheets.
  const filledStatus = kind === "trauma" ? "trauma" : "wounded";

  const emptyIcon = "far fa-circle";
  const filledIcon = "fas fa-circle";

  for (const i of indices) {
    const shouldFill = i < next;

    const statusPath = `${trackBasePath}.dots.${i}.status`;
    const iconPath = `${trackBasePath}.dots.${i}.icon`;

    const beforeStatus = foundry.utils.getProperty(actor, statusPath);
    const beforeIcon = foundry.utils.getProperty(actor, iconPath);

    const afterStatus = shouldFill ? filledStatus : emptyStatus;
    const afterIcon = shouldFill ? filledIcon : emptyIcon;

    if (beforeStatus !== afterStatus) {
      patches.push({ path: statusPath, before: beforeStatus, after: afterStatus });
      update[statusPath] = afterStatus;
    }

    // Some documents may not store icon persistently; only patch it if it exists.
    if (beforeIcon != null && beforeIcon !== afterIcon) {
      patches.push({ path: iconPath, before: beforeIcon, after: afterIcon });
      update[iconPath] = afterIcon;
    }
  }

  return { patches, update };
}

export function resolvePersistentSoak(actor, { damageType = "physical", hitLocationKey = "torso" } = {}) {
  if (!actor) return 0;

  if (damageType === "mental") {
    return Number(foundry.utils.getProperty(actor, "system.health.courage") ?? 0) || 0;
  }

  // NPCs: system.armor is a number
  const flatNpc = foundry.utils.getProperty(actor, "system.armor");
  if (typeof flatNpc === "number") return flatNpc;

  // PCs: system.armor.<loc>.soak uses Conan canonical ids.
  const locMap = {
    head: "head",
    torso: "torso",
    larm: "larm",
    rarm: "rarm",
    lleg: "lleg",
    rleg: "rleg"
  };

  const key = locMap[hitLocationKey] ?? "torso";
  const soakValue = foundry.utils.getProperty(actor, `system.armor.${key}.soak`);
  const soak = Array.isArray(soakValue) ? Number(soakValue[0] ?? 0) : Number(soakValue ?? 0);

  return Number.isFinite(soak) ? soak : 0;
}

/**
 * Reach helpers
 *
 * Core rules: melee attacks have a Reach value and it interacts with Guard.
 * We don't model Guard state here (system-dependent), but we can at least
 * determine weapon Reach values deterministically.
 */

export function readItemReach(item) {
  const v = item?.system?.range;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function effectHasStatus(effect, statusId) {
  const statuses = effect?.statuses ?? effect?._source?.statuses;
  if (!statuses) return false;
  if (statuses instanceof Set) return statuses.has(statusId);
  if (Array.isArray(statuses)) return statuses.includes(statusId);
  return false;
}

export function readActorReachFromStatus(actor) {
  if (!actor?.effects?.length) return null;

  for (let n = 1; n <= 6; n += 1) {
    const id = `conan-reach-${n}`;
    if (actor.effects.some(e => !e.disabled && effectHasStatus(e, id))) return n;
  }
  if (actor.effects.some(e => !e.disabled && effectHasStatus(e, "conan-no-reach"))) return 0;
  return null;
}

export function computeActorReach(actor) {
  if (!actor) return 0;

  // Prefer explicit status effects if a Reach status module is installed.
  const statusReach = readActorReachFromStatus(actor);
  if (statusReach != null) return statusReach;

  // Fall back to item scan.
  const items = Array.from(actor.items ?? []);

  // PCs: use equipped weapons with numeric range
  if (actor.type === "character") {
    const reaches = items
      .filter(i => i.type === "weapon" && i.system?.equipped === true)
      .map(readItemReach)
      .filter(n => Number.isFinite(n) && n > 0);
    return reaches.length ? Math.max(...reaches) : 0;
  }

  // NPCs: consider npcattack and weapon items (many NPC attacks are stored as npcattack)
  const reaches = items
    .filter(i => i.type === "npcattack" || i.type === "weapon" || i.type === "display")
    .map(readItemReach)
    .filter(n => Number.isFinite(n) && n > 0);
  return reaches.length ? Math.max(...reaches) : 0;
}