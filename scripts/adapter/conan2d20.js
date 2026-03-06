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
 * Hit Location mapping (core rules):
 * 1–2 Head, 3–5 Right arm, 6–8 Left arm, 9–14 Torso, 15–17 Right leg, 18–20 Left leg
 */
export function hitLocationFromD20(d20) {
  const r = Number(d20 ?? 0);
  if (r >= 1 && r <= 2) return { key: "head", label: "Head" };
  if (r >= 3 && r <= 5) return { key: "rightArm", label: "Right arm" };
  if (r >= 6 && r <= 8) return { key: "leftArm", label: "Left arm" };
  if (r >= 9 && r <= 14) return { key: "torso", label: "Torso" };
  if (r >= 15 && r <= 17) return { key: "rightLeg", label: "Right leg" };
  if (r >= 18 && r <= 20) return { key: "leftLeg", label: "Left leg" };
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

export function resolvePersistentSoak(actor, { damageType = "physical", hitLocationKey = "torso" } = {}) {
  if (!actor) return 0;

  if (damageType === "mental") {
    return Number(foundry.utils.getProperty(actor, "system.health.courage") ?? 0) || 0;
  }

  // NPCs: system.armor is a number
  const flatNpc = foundry.utils.getProperty(actor, "system.armor");
  if (typeof flatNpc === "number") return flatNpc;

  // PCs: system.armor.<loc>.soak is a number
  const locMap = {
    head: "head",
    torso: "torso",
    leftArm: "l-arm",
    rightArm: "r-arm",
    leftLeg: "l-leg",
    rightLeg: "r-leg"
  };

  const key = locMap[hitLocationKey] ?? "torso";
  const soak = Number(foundry.utils.getProperty(actor, `system.armor.${key}.soak`));

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