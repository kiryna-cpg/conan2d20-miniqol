import { MODULE_ID } from "../constants.js";
import { queuePendingRollIntent } from "../state/pending-roll-store.js";
import { debugEnabled } from "./conan2d20.js";

/**
 * Source of truth:
 * - token-action-hud-conan2d20 exposes exact PC defense skill routes: par / acr / res / dis
 * - token-action-hud-conan2d20 exposes exact NPC broad skill routes: cmb / frt / knw / mov / scl / sns
 * - TAH opens native skill rolls with actor._rollSkillCheck(skillKey, null, bonusDice)
 *
 * MiniQoL must mirror that behavior and must not invent attribute injection here.
 */

const CHARACTER_DEFENSE_ROUTES = {
  melee: "par",
  ranged: "acr",
  threaten: "dis"
};

const NPC_DEFENSE_ROUTES = {
  melee: "cmb",
  ranged: "mov",
  threaten: "scl"
};

const CHARACTER_SKILL_KEYS = ["par", "acr", "res", "dis"];
const NPC_SKILL_KEYS = ["cmb", "frt", "knw", "mov", "scl", "sns"];

function queueIntent(
  actor,
  {
    type = "skill-roll",
    itemId = null,
    skillKey = null,
    metadata = {}
  } = {}
) {
  if (!actor?.id) return null;

  return queuePendingRollIntent({
    actorId: actor.id,
    itemId,
    skillKey,
    userId: game.user?.id ?? null,
    type,
    metadata
  });
}

function getActorSkillsObject(actor) {
  const skills = actor?.system?.skills;
  return skills && typeof skills === "object" ? skills : {};
}

function actorHasSkillKey(actor, skillKey) {
  const skills = getActorSkillsObject(actor);
  if (!skillKey || !skills) return false;
  return Object.hasOwn(skills, skillKey);
}

function actorMatchesSkillFamily(actor, keys = []) {
  return keys.some((key) => actorHasSkillKey(actor, key));
}

function resolveActorSkillFamily(actor) {
  if (actorMatchesSkillFamily(actor, CHARACTER_SKILL_KEYS)) return "character";
  if (actorMatchesSkillFamily(actor, NPC_SKILL_KEYS)) return "npc";
  return null;
}

function clampDifficulty(value) {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  return Math.max(0, Math.min(5, n));
}

function resolveNpcAttackAttribute(item = null, fallback = null) {
  const attackType = String(item?.system?.attackType ?? "").toLowerCase();
  if (attackType === "melee") return "agi";
  if (attackType === "ranged") return "coo";
  if (attackType === "threaten") return "per";
  return fallback;
}

function buildSkillRollerOptions(
  actor,
  skillKey,
  {
    bonusDice = 0,
    difficulty = null,
    item = null
  } = {}
) {
  const family = resolveActorSkillFamily(actor);
  if (!family) return null;

  const safeBonusDice = Math.max(0, Number(bonusDice ?? 0) || 0);
  const safeDifficulty = clampDifficulty(difficulty);

  if (family === "npc") {
    const attribute = resolveNpcAttackAttribute(
      item,
      CONFIG?.CONAN?.expertiseAttributeMap?.[skillKey] ?? null
    );
    if (!attribute) return null;

    return {
      attribute,
      bonusDice: safeBonusDice,
      expertise: skillKey,
      item: item ?? null,
      ...(safeDifficulty != null ? { difficulty: safeDifficulty } : {})
    };
  }

  const attribute = CONFIG?.CONAN?.skillAttributeMap?.[skillKey] ?? null;
  if (!attribute) return null;

  return {
    attribute,
    bonusDice: safeBonusDice,
    skill: skillKey,
    item: item ?? null,
    ...(safeDifficulty != null ? { difficulty: safeDifficulty } : {})
  };
}

export function resolveActorDefenseRoute(
  actor,
  {
    attackType = null,
    skillKeyOverride = null
  } = {}
) {
  if (skillKeyOverride) {
    return {
      family: resolveActorSkillFamily(actor),
      skillKey: skillKeyOverride
    };
  }

  if (!actor || !attackType) return null;

  const family = resolveActorSkillFamily(actor);
  if (!family) return null;

  const table = family === "npc" ? NPC_DEFENSE_ROUTES : CHARACTER_DEFENSE_ROUTES;
  const skillKey = table[String(attackType ?? "").toLowerCase()] ?? null;

  if (!skillKey) return null;
  if (!actorHasSkillKey(actor, skillKey)) return null;

  return { family, skillKey };
}

export function resolveNativeDefenseSkillKey(
  actor,
  {
    attackType = null,
    skillKeyOverride = null
  } = {}
) {
  return resolveActorDefenseRoute(actor, {
    attackType,
    skillKeyOverride
  })?.skillKey ?? null;
}

export async function openNativeSkillRoll(
  actor,
  skillKey,
  {
    bonusDice = 0,
    difficulty = null,
    pendingContext = {}
  } = {}
) {
  if (!actor || !skillKey) return false;

  const safeBonusDice = Math.max(0, Number(bonusDice ?? 0) || 0);
  const safeDifficulty = clampDifficulty(difficulty);
  const metadata = foundry.utils.deepClone(pendingContext ?? {});

  if (safeDifficulty != null && metadata.difficulty == null && metadata.reactionDifficulty == null) {
    metadata.difficulty = safeDifficulty;
  }

  queueIntent(actor, {
    type: "skill-roll",
    skillKey,
    metadata
  });

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] openNativeSkillRoll`, {
      actorId: actor.id,
      actorType: actor.type,
      skillKey,
      safeBonusDice,
      safeDifficulty,
      pendingContext: metadata
    });
  }

  if (safeDifficulty != null && globalThis.conan?.apps?.SkillRoller) {
    const options = buildSkillRollerOptions(actor, skillKey, {
      bonusDice: safeBonusDice,
      difficulty: safeDifficulty,
      item: metadata.item ?? null
    });

    if (options) {
      new conan.apps.SkillRoller(actor, options).render(true);
      return true;
    }
  }

  // Mirror TAH exactly when no difficulty pre-configuration is required.
  if (typeof actor._rollSkillCheck === "function") {
    await actor._rollSkillCheck(skillKey, null, safeBonusDice);
    return true;
  }

  const fn = actor?.rollSkill ?? actor?.rollSkillTest ?? null;
  if (typeof fn === "function") {
    await fn.call(actor, skillKey, { bonusDice: safeBonusDice });
    return true;
  }

  const macro = game?.conan2d20?.rollSkill ?? null;
  if (typeof macro === "function") {
    await macro(actor, skillKey, { bonusDice: safeBonusDice });
    return true;
  }

  actor.sheet?.render?.(true);
  return false;
}

export async function openNativeDefenseRoll(
  actor,
  {
    attackType = null,
    skillKey = null,
    bonusDice = 0,
    pendingContext = {}
  } = {}
) {
  if (!actor) return false;

  const resolvedSkillKey = resolveNativeDefenseSkillKey(actor, {
    attackType,
    skillKeyOverride: skillKey
  });

  if (!resolvedSkillKey) {
    ui.notifications?.warn(game.i18n.localize("C2MQ.Warn.DefenseSkillUnavailable"));
    return false;
  }

  const metadata = {
    ...pendingContext,
    rollPurpose: "defense",
    defenseAttackType: attackType ?? null
  };

  return openNativeSkillRoll(actor, resolvedSkillKey, {
    bonusDice,
    difficulty: metadata.reactionDifficulty ?? metadata.difficulty ?? null,
    pendingContext: metadata
  });
}

export async function openNativeWeaponAttack(
  actor,
  itemId,
  {
    pendingContext = {}
  } = {}
) {
  if (!actor || !itemId) return false;

  queueIntent(actor, {
    type: "weapon-attack",
    itemId,
    metadata: pendingContext
  });

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] openNativeWeaponAttack`, {
      actorId: actor.id,
      itemId,
      pendingContext
    });
  }

  if (typeof actor._executeAttack === "function") {
    await actor._executeAttack(itemId);
    return true;
  }

  const item = actor.items?.get(itemId) ?? null;
  if (!item) return false;

  if (typeof item.roll === "function") {
    await item.roll();
    return true;
  }

  const fn = actor?.rollWeapon ?? actor?.rollAttack ?? null;
  if (typeof fn === "function") {
    await fn.call(actor, item);
    return true;
  }

  item.sheet?.render?.(true);
  return false;
}