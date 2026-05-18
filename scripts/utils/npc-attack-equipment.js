import { MODULE_ID } from "../constants.js";

export const NPC_ATTACK_UNEQUIPPED_FLAG = "npcAttackUnequipped";

const DISARM_EXCLUDED_NAME_PATTERNS = [
  /\bunarmed\b/i,
  /\bimprovised\b/i,
  /\bdesarmad[oa]s?\b/i,
  /\bsin\s+armas?\b/i,
  /\bimprovisad[oa]s?\b/i
];

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function hasWeaponQuality(item, qualityType) {
  const qualities = item?.system?.qualities?.value;
  if (!Array.isArray(qualities)) return false;
  return qualities.some((quality) => String(quality?.type ?? "") === qualityType);
}

export function isNpcAttackUnequipped(item) {
  if (!item || item.type !== "npcattack") return false;

  try {
    if (item.getFlag?.(MODULE_ID, NPC_ATTACK_UNEQUIPPED_FLAG) === true) return true;
  } catch (_e) {
    // Fall back to raw source flags below.
  }

  return foundry.utils.getProperty(item, `flags.${MODULE_ID}.${NPC_ATTACK_UNEQUIPPED_FLAG}`) === true;
}

export function isPhysicalNpcAttack(item) {
  if (item?.type !== "npcattack") return false;
  const attackType = String(item.system?.attackType ?? "").trim().toLowerCase();
  return attackType === "melee" || attackType === "ranged";
}

export function isEquippedNpcAttack(item) {
  return isPhysicalNpcAttack(item) && !isNpcAttackUnequipped(item);
}

export async function setNpcAttackUnequipped(item, unequipped) {
  if (!isPhysicalNpcAttack(item)) return false;

  if (unequipped === true) {
    await item.setFlag(MODULE_ID, NPC_ATTACK_UNEQUIPPED_FLAG, true);
    return true;
  }

  if (typeof item.unsetFlag === "function") {
    await item.unsetFlag(MODULE_ID, NPC_ATTACK_UNEQUIPPED_FLAG);
  } else {
    await item.update({ [`flags.${MODULE_ID}.${NPC_ATTACK_UNEQUIPPED_FLAG}`]: null });
  }

  return true;
}

export function isDisarmExcludedItem(item) {
  if (!["weapon", "npcattack"].includes(item?.type)) return false;
  if (hasWeaponQuality(item, "improvised")) return true;

  const name = normalizeName(item.name);
  return DISARM_EXCLUDED_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

export function isDisarmExcludedWeapon(item) {
  return item?.type === "weapon" && isDisarmExcludedItem(item);
}

export function isDisarmableWeapon(item) {
  if (item?.type !== "weapon") return false;
  if (item.system?.equipped !== true) return false;
  if (item.system?.broken === true) return false;
  return !isDisarmExcludedItem(item);
}

export function isDisarmableNpcAttack(item) {
  return isEquippedNpcAttack(item) && !isDisarmExcludedItem(item);
}

export function isDisarmableItem(item) {
  return isDisarmableWeapon(item) || isDisarmableNpcAttack(item);
}
