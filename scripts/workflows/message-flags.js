import {
  MODULE_ID,
  SETTING_KEYS,
  ATTACK_TYPES,
  REACTION_PHASES
} from "../constants.js";
import {
  collectCurrentUserTargets,
  getStoredTargetsForUser
} from "../state/user-target-store.js";

function pickNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function safeTokenKey(tokenUuid) {
  const raw = String(tokenUuid ?? "");
  return encodeURIComponent(raw).replaceAll(".", "%2E");
}

function normalizeDamageType(rawType) {
  return String(rawType ?? "").trim().toLowerCase() === "mental" ? "mental" : "physical";
}

export function isStandaloneDamageCardMessage(message) {
  const data = message?.flags?.data ?? {};
  if (String(data?.type ?? "").trim().toLowerCase() !== "damage") return false;

  const numDice = pickNumber(
    data?.rollData?.numDice,
    data?.rollData?.base?.numDice,
    Array.isArray(data?.results?.rolls) ? data.results.rolls.length : null
  );
  const total = pickNumber(
    data?.results?.total,
    data?.results?.improvisedTotal
  );

  return Number.isFinite(numDice) && numDice > 0 && total != null;
}

export function isDamageCapableRoll(message) {
  if (isStandaloneDamageCardMessage(message)) return true;

  const dice = Number(message?.flags?.data?.item?.system?.damage?.dice ?? 0);
  return Number.isFinite(dice) && dice > 0;
}

export function isSuccessfulRoll(message) {
  return message?.flags?.data?.results?.result === "success";
}

export function collectCurrentTargets() {
  return collectCurrentUserTargets();
}

function getMessageAuthorUser(message) {
  const authorId = message?.author?.id ?? message?.user ?? null;
  return authorId ? game.users?.get(authorId) ?? null : null;
}

function resolveTargetsForMessage(message, explicitTargets = null) {
  if (Array.isArray(explicitTargets)) return explicitTargets;

  const sceneId = message?.speaker?.scene ?? canvas?.scene?.id ?? null;
  const authorUser = getMessageAuthorUser(message);

  if (authorUser) {
    const storedTargets = getStoredTargetsForUser(authorUser, { sceneId });
    if (storedTargets.length) return storedTargets;

    // If the current client is also the author, falling back to live targets is safe.
    if (authorUser.id === game.user?.id) {
      const liveTargets = collectCurrentUserTargets();
      if (liveTargets.length) return liveTargets;
    }

    // Explicit empty snapshot is still authoritative.
    const rawSnapshot = authorUser.getFlag(MODULE_ID, "userTargetSnapshot");
    if (rawSnapshot && Array.isArray(rawSnapshot.targets)) return [];
  }

  // Last-resort fallback only when we have no author information at all.
  return collectCurrentUserTargets();
}

function hitLocationKeyFromLabel(label) {
  const raw = String(label ?? "").trim().toLowerCase();

  if (!raw) return "torso";
  if (raw === "head" || raw === "cabeza") return "head";
  if (raw === "torso") return "torso";
  if (raw === "right arm" || raw === "brazo derecho") return "rarm";
  if (raw === "left arm" || raw === "brazo izquierdo") return "larm";
  if (raw === "right leg" || raw === "pierna derecha") return "rleg";
  if (raw === "left leg" || raw === "pierna izquierda") return "lleg";

  return "torso";
}

function itemHasQuality(item, qualityType) {
  return Array.isArray(item?.system?.qualities?.value)
    && item.system.qualities.value.some((quality) => quality?.type === qualityType);
}

function buildDamageQualityMeta(item, { damageType = "physical", effects = 0 } = {}) {
  const qualities = Array.isArray(item?.system?.qualities?.value)
    ? item.system.qualities.value
    : [];

  const findValue = (type) => {
    const entry = qualities.find((quality) => quality?.type === type);
    const value = Number(entry?.value ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  const fx = Math.max(0, Number(effects ?? 0) || 0);
  let bonusDamage = 0;

  const vicious = findValue("viciousx");
  if (vicious > 0) bonusDamage += vicious * fx;

  if (damageType === "physical") {
    const cavalry = findValue("cavalryx");
    if (cavalry > 0) bonusDamage += cavalry * fx;
  } else if (damageType === "mental") {
    const fearsome = findValue("fearsomex");
    if (fearsome > 0) bonusDamage += fearsome * fx;
  }

  return {
    intense: qualities.some((quality) => quality?.type === "intense"),
    nonlethal: qualities.some((quality) => quality?.type === "nonlethal"),
    ignoreSoak: Math.max(0, findValue("piercingx") * fx),
    bonusDamage
  };
}

function buildRolledDamagePayloadFromCard(message) {
  const data = message?.flags?.data ?? {};
  const rollData = data?.rollData ?? {};
  const results = data?.results ?? {};
  const item = data?.item ?? null;

  const faces = Array.isArray(results?.rolls)
    ? results.rolls.map((roll) => Number(roll?.result ?? 0) || 0)
    : [];

  const damageType = normalizeDamageType(
    rollData?.damage?.type ?? item?.system?.damage?.type ?? "physical"
  );
  const effects = Math.max(0, Number(pickNumber(results?.effects, 0) ?? 0) || 0);
  const qualityMeta = buildDamageQualityMeta(item, { damageType, effects });

  const displayedTotal = rollData?.improvised === true
    ? (pickNumber(results?.improvisedTotal, results?.total, 0) ?? 0)
    : (pickNumber(results?.total, results?.improvisedTotal, 0) ?? 0);

  return {
    rolled: true,
    total: displayedTotal,
    dice: pickNumber(rollData?.numDice, faces.length, 0) ?? 0,
    baseDice: pickNumber(rollData?.base?.numDice, faces.length, 0) ?? 0,
    static:
      (pickNumber(rollData?.spends?.momentum, 0) ?? 0) +
      (pickNumber(rollData?.spends?.doom, 0) ?? 0),
    effects,
    faces,
    type: damageType,
    ignoreSoak: qualityMeta.ignoreSoak,
    intense: qualityMeta.intense,
    nonlethal: qualityMeta.nonlethal,
    qualityBonusDamage: qualityMeta.bonusDamage,
    attackType: classifyAttackType(message),
    bonus: {
      other: pickNumber(rollData?.bonus?.other, 0) ?? 0,
      talent: pickNumber(rollData?.bonus?.talent, 0) ?? 0
    },
    spends: {
      momentum: pickNumber(rollData?.spends?.momentum, 0) ?? 0,
      doom: pickNumber(rollData?.spends?.doom, 0) ?? 0
    }
  };
}

function buildDamageCardHitLocationPayload(message, targets = []) {
  const enabled = !!game.settings.get(MODULE_ID, SETTING_KEYS.HIT_LOCATION_ENABLED);
  if (!enabled) {
    return {
      enabled: false,
      mode: "perTarget",
      seed: null,
      byTarget: {}
    };
  }

  const data = message?.flags?.data ?? {};
  const damageType = normalizeDamageType(
    data?.rollData?.damage?.type ?? data?.item?.system?.damage?.type ?? "physical"
  );
  const label = String(data?.results?.location ?? "").trim();

  if (damageType !== "physical" || !label) {
    return {
      enabled: false,
      mode: "perTarget",
      seed: null,
      byTarget: {}
    };
  }

  const seed = {
    d20: null,
    key: hitLocationKeyFromLabel(label),
    label
  };

  const byTarget = {};
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!target?.tokenUuid) continue;
    byTarget[safeTokenKey(target.tokenUuid)] = foundry.utils.duplicate(seed);
  }

  return {
    enabled: true,
    mode: "perTarget",
    seed,
    byTarget
  };
}

export function getRollDifficulty(message, fallback = 1) {
  const data = message?.flags?.data ?? {};
  return pickNumber(
    data?.difficulty?.value,
    data?.difficulty,
    data?.results?.difficulty,
    data?.rollData?.difficulty,
    fallback
  ) ?? fallback;
}

export function getRollSuccessCount(message) {
  const data = message?.flags?.data ?? {};
  const direct = pickNumber(
    data?.results?.successes,
    data?.results?.totalSuccesses,
    data?.results?.successCount,
    data?.results?.total
  );
  if (direct != null) return direct;

  const momentum = pickNumber(data?.results?.momentum, 0);
  const difficulty = getRollDifficulty(message, 1);
  if (isSuccessfulRoll(message)) return Math.max(difficulty, difficulty + momentum);

  return 0;
}

export function classifyAttackType(message) {
  if (!isDamageCapableRoll(message)) return null;

  const item = message?.flags?.data?.item ?? {};
  const weaponType = String(item?.system?.weaponType ?? "").trim().toLowerCase();
  const damageType = String(item?.system?.damage?.type ?? "").trim().toLowerCase();
  const itemName = String(item?.name ?? "").trim().toLowerCase();

  if (damageType === "mental") return ATTACK_TYPES.THREATEN;
  if (itemName === "steely glare") return ATTACK_TYPES.THREATEN;

  if (weaponType === ATTACK_TYPES.RANGED) return ATTACK_TYPES.RANGED;
  if (weaponType === ATTACK_TYPES.MELEE) return ATTACK_TYPES.MELEE;

  // Source-of-truth behavior mirrored from token-action-hud-conan2d20:
  // NPC attacks often do not store weaponType. If the roll is damage-capable,
  // not mental, and not explicitly ranged, treat it as melee.
  return ATTACK_TYPES.MELEE;
}

export function isAttackMessage(message) {
  return isDamageCapableRoll(message) && classifyAttackType(message) != null;
}

export function buildMessageFlagsPayload(message, { targets = null } = {}) {
  const data = message?.flags?.data ?? {};
  const actorId = data?.actor?._id ?? data?.rollData?.actorId ?? null;
  const actorUuid = actorId ? `Actor.${actorId}` : null;

  const sceneId = message?.speaker?.scene ?? null;
  const tokenId = message?.speaker?.token ?? null;
  const attackerTokenUuid = tokenId && sceneId ? `Scene.${sceneId}.Token.${tokenId}` : null;

  const itemId = data?.rollData?.item?._id ?? data?.item?._id ?? null;
  const itemUuid = actorUuid && itemId ? `${actorUuid}.Item.${itemId}` : null;

  const resolvedTargets = resolveTargetsForMessage(message, targets);
  const standaloneDamageCard = isStandaloneDamageCardMessage(message);

  return {
    schema: 1,
    context: {
      attackerActorUuid: actorUuid,
      attackerTokenUuid,
      itemUuid,
      itemId,
      itemName: data?.item?.name ?? null,
      authorUserId: message?.author?.id ?? null
    },
    targets: resolvedTargets,
    damage: standaloneDamageCard
      ? buildRolledDamagePayloadFromCard(message)
      : {
          rolled: false,
          total: null,
          dice: null,
          static: 0,
          effects: 0,
          faces: [],
          type: String(data?.item?.system?.damage?.type ?? "physical")
        },
    hitLocation: standaloneDamageCard
      ? buildDamageCardHitLocationPayload(message, resolvedTargets)
      : {
          enabled: !!game.settings.get(MODULE_ID, SETTING_KEYS.HIT_LOCATION_ENABLED),
          mode: "perTarget",
          seed: null,
          byTarget: {}
        },
    reaction: {
      kind: null,
      phase: REACTION_PHASES.NONE,
      attackType: classifyAttackType(message),
      blockedDamage: false,
      outcome: null,
      reactionId: null,
      attackerSuccesses: null,
      defenseSuccesses: null,
      defenseSkillKey: null,
      defenderActorUuid: null,
      defenderTokenUuid: null,
      defenderCombatantUuid: null,
      defenderName: null,
      originalTargetActorUuid: null,
      originalTargetTokenUuid: null,
      originalTargetName: null,
      protectTriedActorIds: [],
      reactionDifficulty: null,
      cost: 0,
      costApplied: false,
      resolvedByMessageId: null
    },
    applied: {}
  };
}

export async function ensureMessageFlags(message, { targets = null } = {}) {
  if (!message) return false;
  if (message.flags?.[MODULE_ID]) return true;
  if (game.system?.id !== "conan2d20") return false;
  if (!isDamageCapableRoll(message) && !isStandaloneDamageCardMessage(message)) return false;

  const payload = buildMessageFlagsPayload(message, { targets });
  await message.update({ [`flags.${MODULE_ID}`]: payload });
  return true;
}