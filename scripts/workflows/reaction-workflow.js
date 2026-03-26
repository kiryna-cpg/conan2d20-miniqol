import {
  MODULE_ID,
  SOCKET_NAME,
  SOCKET_OPS,
  ATTACK_TYPES,
  REACTION_KINDS,
  REACTION_PHASES,
  REACTION_OUTCOMES,
  SETTING_KEYS
} from "../constants.js";
import {
  classifyAttackType,
  collectCurrentTargets,
  ensureMessageFlags,
  getRollSuccessCount,
  isAttackMessage,
  isSuccessfulRoll
} from "./message-flags.js";
import { openNativeDefenseRoll, openNativeWeaponAttack, resolveActorDefenseRoute } from "../adapter/system-rolls.js";
import { addDoom } from "../adapter/pool-tracker.js";
import {
  findCombatantForActor,
  getNextReactionCost,
  pushPendingReaction,
  consumePendingReaction,
  findPendingReaction,
  incrementReactionCount
} from "../state/combat-state-store.js";
import { debugEnabled, readItemReach } from "../adapter/conan2d20.js";
import { resolveWithinReach, isWithinReachKnown } from "../adapter/engagement.js";
import { execRollDamage, execApplyDamage } from "./damage-workflow.js";

function hasActiveGM() {
  return game.users?.some((user) => user.active && user.isGM);
}

function isGM() {
  return game.user?.isGM === true;
}

function isAuthoritativeForAttackMessage(message) {
  if (isGM()) return true;
  if (hasActiveGM()) return false;
  return message?.author?.id === game.user?.id;
}

function emitSocket(op, payload = {}) {
  game.socket.emit(SOCKET_NAME, { op, ...payload });
}

const activeReactionPrompts = new Set();
const finishedReactionPrompts = new Set();

function getReactionPromptKey(payload) {
  return `${payload?.attackMessageId ?? "unknown"}:${payload?.reactionId ?? "unknown"}:${payload?.kind ?? "unknown"}`;
}

function markReactionPromptActive(payload) {
  const key = getReactionPromptKey(payload);
  if (finishedReactionPrompts.has(key) || activeReactionPrompts.has(key)) return false;
  activeReactionPrompts.add(key);
  return true;
}

function clearReactionPromptActive(payload, { finished = false } = {}) {
  const key = getReactionPromptKey(payload);
  activeReactionPrompts.delete(key);
  if (finished) finishedReactionPrompts.add(key);
}

function refreshChatUI() {
  try {
    ui.chat?.render?.(true);
  } catch (_e) {
    // Ignore chat re-render failures.
  }
}

function autoRollEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.AUTO_ROLL_DAMAGE);
}

function autoApplyEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.AUTO_APPLY_DAMAGE);
}

function autoProtectEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.AUTO_PROTECT_REACTION);
}

async function continueAttackResolution(message) {
  if (!message || !isAuthoritativeForAttackMessage(message)) return false;

  const fresh = game.messages?.get(message.id) ?? message;
  const flags = fresh.flags?.[MODULE_ID] ?? null;
  if (!flags) return false;

  const reaction = flags.reaction ?? {};
  if (reaction.blockedDamage === true) return false;

  const autoRoll = autoRollEnabled();
  const autoApply = autoApplyEnabled();

  if (autoRoll && !flags?.damage?.rolled) {
    await execRollDamage(fresh);
  }

  if (autoRoll && autoApply) {
    const afterRoll = game.messages?.get(fresh.id) ?? fresh;
    const only = afterRoll.flags?.[MODULE_ID]?.targets?.length === 1
      ? afterRoll.flags[MODULE_ID].targets[0]
      : null;

    if (only?.tokenUuid) {
      await execApplyDamage(afterRoll, only.tokenUuid);
    }
  }

  return true;
}

function localizeAttackType(attackType) {
  if (attackType === ATTACK_TYPES.MELEE) return game.i18n.localize("C2MQ.DamageRoller.AttackType.Melee");
  if (attackType === ATTACK_TYPES.RANGED) return game.i18n.localize("C2MQ.DamageRoller.AttackType.Ranged");
  if (attackType === ATTACK_TYPES.THREATEN) return game.i18n.localize("C2MQ.DamageRoller.AttackType.Threaten");
  return attackType ?? "Unknown";
}

function buildDefendPromptContent(payload, defenderActor) {
  const attackTypeLabel = localizeAttackType(payload.attackType);
  return `<p>${game.i18n.format("C2MQ.Dialog.Defend.Content", {
    defender: payload.defenderName ?? defenderActor?.name ?? "",
    attackType: attackTypeLabel,
    cost: payload.cost ?? 1
  })}</p>`;
}

function buildProtectPromptContent(payload, defenderActor) {
  const attackTypeLabel = localizeAttackType(payload.attackType);
  return `<p>${game.i18n.format("C2MQ.Dialog.Protect.Content", {
    protector: payload.defenderName ?? defenderActor?.name ?? "",
    target: payload.originalTargetName ?? "",
    attackType: attackTypeLabel,
    cost: payload.cost ?? 1
  })}</p>`;
}

function buildRetaliatePromptContent(payload, defenderActor) {
  return `<p>${game.i18n.format("C2MQ.Dialog.Retaliate.Content", {
    retaliator: payload.defenderName ?? defenderActor?.name ?? "",
    target: payload.originalTargetName ?? "",
    weapon: payload.retaliateItemName ?? game.i18n.localize("C2MQ.Label.Damage"),
    cost: payload.cost ?? 1
  })}</p>`;
}

function buildReactionPendingContext(payload) {
  return {
    reactionKind: payload.kind ?? REACTION_KINDS.DEFEND,
    reactionId: payload.reactionId,
    attackMessageId: payload.attackMessageId,
    defenderCombatantUuid: payload.defenderCombatantUuid ?? null,
    defenderActorUuid: payload.defenderActorUuid ?? null,
    defenderActorId: payload.defenderActorId ?? null,
    defenderTokenUuid: payload.defenderTokenUuid ?? payload.targetTokenUuid ?? null,
    originalTargetActorUuid: payload.originalTargetActorUuid ?? null,
    originalTargetTokenUuid: payload.originalTargetTokenUuid ?? null,
    retaliateItemId: payload.retaliateItemId ?? null,
    retaliateItemName: payload.retaliateItemName ?? null,
    protectTriedActorIds: Array.isArray(payload.protectTriedActorIds)
      ? foundry.utils.deepClone(payload.protectTriedActorIds)
      : [],
    attackSuccesses: payload.attackSuccesses,
    defenseSkillKey: payload.defenseSkillKey,
    reactionCost: payload.cost,
    reactionDifficulty: payload.reactionDifficulty ?? null
  };
}

function resolveProtectOutcome(attackSuccesses, defenseSuccesses) {
  const atk = Math.max(0, Number(attackSuccesses ?? 0) || 0);
  const def = Math.max(0, Number(defenseSuccesses ?? 0) || 0);

  if (def <= 0) return REACTION_OUTCOMES.HIT;
  return def > atk ? REACTION_OUTCOMES.MISS : REACTION_OUTCOMES.HIT;
}

function getReactionDefinition(kind = REACTION_KINDS.DEFEND) {
  if (kind === REACTION_KINDS.DEFEND) {
    return {
      kind: REACTION_KINDS.DEFEND,
      blocksDamageWhenPrompted: true,
      blocksDamageWhileRolling: true,
      blocksDamageWhenResolved: false,
      promptTitleKey: "C2MQ.Dialog.Defend.Title",
      buildPromptContent: buildDefendPromptContent,
      resolveRoute: (actor, { attackType } = {}) =>
        resolveActorDefenseRoute(actor, { attackType }),
      launchRoll: (defenderActor, payload) =>
        openNativeDefenseRoll(defenderActor, {
          attackType: payload.attackType,
          skillKey: payload.defenseSkillKey,
          pendingContext: buildReactionPendingContext(payload)
        }),
      applyCost: (defenderActor, cost) => applyDefendCost(defenderActor, cost),
      resolveOutcome: (attackSuccesses, defenseSuccesses) =>
        resolveDefendOutcome(attackSuccesses, defenseSuccesses),
      trackerUnavailableWarningKey: "C2MQ.Warn.DoomTrackerUnavailable"
    };
  }

  if (kind === REACTION_KINDS.PROTECT) {
    return {
      kind: REACTION_KINDS.PROTECT,
      blocksDamageWhenPrompted: true,
      blocksDamageWhileRolling: true,
      blocksDamageWhenResolved: false,
      promptTitleKey: "C2MQ.Dialog.Protect.Title",
      buildPromptContent: buildProtectPromptContent,
      resolveRoute: (actor, { attackType } = {}) =>
        resolveActorDefenseRoute(actor, { attackType }),
      launchRoll: (defenderActor, payload) =>
        openNativeDefenseRoll(defenderActor, {
          attackType: payload.attackType,
          skillKey: payload.defenseSkillKey,
          pendingContext: buildReactionPendingContext({
            ...payload,
            reactionDifficulty: 2
          })
        }),
      applyCost: (defenderActor, cost) => applyDefendCost(defenderActor, cost),
      resolveOutcome: (attackSuccesses, defenseSuccesses) =>
        resolveProtectOutcome(attackSuccesses, defenseSuccesses),
      trackerUnavailableWarningKey: "C2MQ.Warn.DoomTrackerUnavailable"
    };
  }
  if (kind === REACTION_KINDS.RETALIATE) {
    return {
      kind: REACTION_KINDS.RETALIATE,
      blocksDamageWhenPrompted: false,
      blocksDamageWhileRolling: false,
      blocksDamageWhenResolved: false,
      promptTitleKey: "C2MQ.Dialog.Retaliate.Title",
      buildPromptContent: buildRetaliatePromptContent,
      resolveRoute: () => ({ family: null, skillKey: null }),
      launchRoll: (retaliatorActor, payload) =>
        openNativeWeaponAttack(retaliatorActor, payload.retaliateItemId, {
          pendingContext: buildReactionPendingContext(payload)
        }),
      applyCost: (retaliatorActor, cost) => applyDefendCost(retaliatorActor, cost),
      resolveOutcome: () => REACTION_OUTCOMES.HIT,
      trackerUnavailableWarningKey: "C2MQ.Warn.DoomTrackerUnavailable"
    };
  }
  return null;
}

function extractActorIdFromMessage(message) {
  return (
    message?.flags?.data?.actor?._id ??
    message?.flags?.data?.rollData?.actorId ??
    message?.speaker?.actor ??
    null
  );
}

async function resolveTokenDoc(tokenUuid) {
  try {
    return await fromUuid(tokenUuid);
  } catch (_e) {
    return null;
  }
}

async function resolveDefenderActorFromPayload(payload) {
  if (payload?.targetTokenUuid) {
    const tokenDoc = await resolveTokenDoc(payload.targetTokenUuid);
    if (tokenDoc?.actor) return tokenDoc.actor;
  }

  if (payload?.defenderActorUuid) {
    try {
      const actor = await fromUuid(payload.defenderActorUuid);
      if (actor) return actor;
    } catch (_e) {
      // Ignore and continue fallback chain.
    }
  }

  if (payload?.defenderActorId) {
    const actor = game.actors?.get(payload.defenderActorId) ?? null;
    if (actor) return actor;
  }

  return null;
}

async function applyDefendCost(defenderActor, cost) {
  const reactionCost = Math.max(0, Number(cost ?? 1) || 1);
  if (!reactionCost) return true;

  const actorType = String(defenderActor?.type ?? "").trim().toLowerCase();
  const isNpc = actorType === "npc";
  const actorName = defenderActor?.name ?? game.i18n.localize("C2MQ.UnknownActor");

  try {
    const trackerApi = globalThis.conan?.apps?.MomentumTrackerV2 ?? null;
    if (trackerApi?.changeCounter) {
      await trackerApi.changeCounter(isNpc ? -reactionCost : reactionCost, "doom");

      const titleKey = isNpc ? "CONAN.rollDoomSpent" : "CONAN.rollDoomPaid";
      const textKey = isNpc ? "CONAN.rollDoomSpentChatText" : "CONAN.rollDoomPaidChatText";

      const html = `<h2>${game.i18n.localize(titleKey)}</h2><div><p>${game.i18n.format(textKey, {
        character: `<b>${actorName}</b>`,
        spent: `<b>${reactionCost}</b>`
      })}</p></div>`;

      await ChatMessage.create({
        user: game.user?.id ?? null,
        content: html
      });

      return true;
    }
  } catch (err) {
    console.error(`[${MODULE_ID}] failed to apply Defend doom cost`, err);
  }

  // Final fallback only if the Conan tracker API is unavailable.
  const doomDelta = isNpc ? -reactionCost : reactionCost;
  return (await addDoom(doomDelta)) === true;
}

async function resolveActorFromMessage(message) {
  const directActorId = extractActorIdFromMessage(message);
  if (directActorId) {
    const directActor = game.actors?.get(directActorId) ?? null;
    if (directActor) return directActor;
  }

  const sceneId = message?.speaker?.scene ?? null;
  const tokenId = message?.speaker?.token ?? null;
  if (sceneId && tokenId) {
    const tokenDoc = await resolveTokenDoc(`Scene.${sceneId}.Token.${tokenId}`);
    if (tokenDoc?.actor) return getBaseActor(tokenDoc.actor, tokenDoc);
  }

  return null;
}

function collectOwnershipDocs(actor, tokenDoc = null) {
  const docs = [];
  const seen = new Set();

  const push = (doc) => {
    if (!doc) return;
    const key = doc.uuid ?? `${doc.documentName ?? "Doc"}:${doc.id ?? foundry.utils.randomID()}`;
    if (seen.has(key)) return;
    seen.add(key);
    docs.push(doc);
  };

  // IMPORTANT:
  // For linked actors, ownership usually lives on the base Actor.
  // For synthetic/unlinked token actors, ownership may live on the TokenDocument.
  push(tokenDoc);
  push(tokenDoc?.actor ?? null);
  push(actor);
  push(tokenDoc?.actorId ? game.actors?.get(tokenDoc.actorId) ?? null : null);
  push(actor?.id ? game.actors?.get(actor.id) ?? null : null);

  return docs;
}

function getBaseActor(actor, tokenDoc = null) {
  const baseActorId = tokenDoc?.actorId ?? actor?.id ?? null;
  return baseActorId ? game.actors?.get(baseActorId) ?? actor : actor;
}

function userOwnsAnyDoc(user, docs = []) {
  return docs.some((doc) => typeof doc?.testUserPermission === "function" && doc.testUserPermission(user, "OWNER"));
}

function resolveDefenseFamily(actor, { attackType = null, skillKey = null } = {}) {
  const family = resolveActorDefenseRoute(actor, {
    attackType,
    skillKeyOverride: skillKey
  })?.family ?? null;

  if (family) return family;

  const actorType = String(actor?.type ?? "").toLowerCase();
  if (actorType === "npc") return "npc";
  if (actorType) return "character";

  return null;
}

function matchesCharacterDefenderUser(user, docs, baseActor, payload, { allowPromptHint = false } = {}) {
  if (!user || user.isGM) return false;

  if (payload?.preferredCharacterActorId && user.character?.id === payload.preferredCharacterActorId) {
    return true;
  }

  if (user.character?.id === baseActor?.id) return true;
  if (userOwnsAnyDoc(user, docs)) return true;
  if (allowPromptHint && payload?.promptUserId === user.id) return true;

  return false;
}

function getPromptRouting(
  actor,
  tokenDoc = null,
  {
    attackType = null,
    defenseSkillKey = null
  } = {}
) {
  const docs = collectOwnershipDocs(actor, tokenDoc);
  const baseActor = getBaseActor(actor, tokenDoc);

  const activePlayers = game.users?.filter((user) => user.active && !user.isGM) ?? [];
  const activeGMs = game.users?.filter((user) => user.active && user.isGM) ?? [];
  const family = resolveDefenseFamily(actor, { attackType, skillKey: defenseSkillKey });

  const fallbackGM =
    activeGMs.find((user) => userOwnsAnyDoc(user, docs))
    ?? activeGMs[0]
    ?? null;

  if (family === "npc") {
    return {
      promptUserId: fallbackGM?.id ?? null,
      fallbackGmUserId: fallbackGM?.id ?? null
    };
  }

  const assignedPlayer =
    activePlayers.find((user) => user.character?.id === baseActor?.id) ?? null;

  const ownerPlayers =
    activePlayers.filter((user) => userOwnsAnyDoc(user, docs));

  const ownerPlayer =
    ownerPlayers.find((user) => user.character?.id === baseActor?.id)
    ?? ownerPlayers[0]
    ?? null;

  return {
    promptUserId: assignedPlayer?.id ?? ownerPlayer?.id ?? fallbackGM?.id ?? null,
    fallbackGmUserId: fallbackGM?.id ?? null
  };
}

function shouldCurrentUserHandlePrompt(actor, tokenDoc, payload) {
  const fallbackGmUserId = payload?.fallbackGmUserId ?? null;
  const docs = collectOwnershipDocs(actor, tokenDoc);
  const baseActor = getBaseActor(actor, tokenDoc);
  const family = resolveDefenseFamily(actor, {
    attackType: payload?.attackType ?? null,
    skillKey: payload?.defenseSkillKey ?? null
  });

  if (family === "npc") {
    if (!game.user?.isGM) return false;
    if (fallbackGmUserId) return game.user?.id === fallbackGmUserId;
    return true;
  }

  if (!game.user?.isGM) {
    return matchesCharacterDefenderUser(game.user, docs, baseActor, payload, {
      allowPromptHint: true
    });
  }

  const activePlayers = game.users?.filter((user) => user.active && !user.isGM) ?? [];
  const hasAnyPlayerCandidate = activePlayers.some((user) =>
    matchesCharacterDefenderUser(user, docs, baseActor, payload)
  );

  if (hasAnyPlayerCandidate) return false;
  if (fallbackGmUserId) return game.user?.id === fallbackGmUserId;
  return true;
}

async function setReactionState(message, patch = {}) {
  if (!message?.flags?.[MODULE_ID]) return null;

  const next = foundry.utils.duplicate(message.flags[MODULE_ID]);
  next.reaction = foundry.utils.mergeObject(next.reaction ?? {}, patch, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true
  });

  await message.update({ [`flags.${MODULE_ID}`]: next });
  return next.reaction;
}

function resolveDefendOutcome(attackSuccesses, defenseSuccesses) {
  const atk = Math.max(0, Number(attackSuccesses ?? 0) || 0);
  const def = Math.max(0, Number(defenseSuccesses ?? 0) || 0);
  return def > atk ? REACTION_OUTCOMES.MISS : REACTION_OUTCOMES.HIT;
}

function buildPendingReactionPayload({
  kind = REACTION_KINDS.DEFEND,
  message,
  defenderActor,
  defenderCombatant,
  target,
  attackType,
  defenseSkillKey,
  attackSuccesses,
  cost,
  baseDefenderActor = null
}) {
  const actorDoc = baseDefenderActor ?? defenderActor;
  const defenderTokenUuid = target?.tokenUuid ?? null;

  return {
    reactionId: foundry.utils.randomID(),
    kind,
    attackMessageId: message.id,
    attackType,
    attackSuccesses,
    defenseSkillKey,
    defenderActorUuid: actorDoc?.uuid ?? defenderActor?.uuid ?? null,
    defenderActorId: actorDoc?.id ?? defenderActor?.id ?? null,
    defenderTokenUuid,
    preferredCharacterActorId: null,
    promptUserId: null,
    defenderCombatantUuid: defenderCombatant?.uuid ?? null,
    defenderName: target?.name ?? actorDoc?.name ?? defenderActor?.name ?? null,
    targetTokenUuid: defenderTokenUuid,
    originalTargetActorUuid: null,
    originalTargetTokenUuid: null,
    originalTargetName: null,
    protectTriedActorIds: [],
    reactionDifficulty: kind === REACTION_KINDS.PROTECT ? 2 : null,
    cost
  };
}

async function promptReactionDecision(payload) {
  const kind = payload?.kind ?? REACTION_KINDS.DEFEND;
  const definition = getReactionDefinition(kind);
  if (!definition) return false;
  if (!payload?.defenderActorUuid && !payload?.defenderActorId && !payload?.targetTokenUuid) return false;

  if (!markReactionPromptActive(payload)) {
    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] reaction prompt deduped`, {
        kind,
        reactionId: payload?.reactionId ?? null,
        attackMessageId: payload?.attackMessageId ?? null
      });
    }
    return false;
  }

  const defenderActor = await resolveDefenderActorFromPayload(payload);

  if (!defenderActor) {
    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] reaction prompt aborted: defender actor not resolvable`, {
        kind,
        payload
      });
    }
    clearReactionPromptActive(payload, { finished: true });
    return false;
  }

  const ok = await Dialog.confirm({
    title: game.i18n.localize(definition.promptTitleKey),
    content: definition.buildPromptContent(payload, defenderActor),
    yes: () => true,
    no: () => false,
    defaultYes: true
  });

  if (!ok) {
    const attackMessage = game.messages?.get(payload.attackMessageId) ?? null;

    if (attackMessage && isAuthoritativeForAttackMessage(attackMessage)) {
      await cancelReaction(payload);
      clearReactionPromptActive(payload, { finished: true });
      return false;
    }

    emitSocket(SOCKET_OPS.CANCEL_REACTION, payload);
    clearReactionPromptActive(payload, { finished: true });
    return false;
  }

  const launched = await definition.launchRoll(defenderActor, payload);

  if (!launched) {
    const attackMessage = game.messages?.get(payload.attackMessageId) ?? null;

    if (attackMessage && isAuthoritativeForAttackMessage(attackMessage)) {
      await cancelReaction(payload);
      clearReactionPromptActive(payload, { finished: true });
      return false;
    }

    emitSocket(SOCKET_OPS.CANCEL_REACTION, payload);
    clearReactionPromptActive(payload, { finished: true });
    return false;
  }

  const attackMessage = game.messages?.get(payload.attackMessageId) ?? null;

  // Avoid depending on socket loopback when the current client is already
  // authoritative for the attack message.
  if (attackMessage && isAuthoritativeForAttackMessage(attackMessage)) {
    await beginReaction(payload);
    clearReactionPromptActive(payload, { finished: true });
    return true;
  }

  emitSocket(SOCKET_OPS.BEGIN_REACTION, payload);
  clearReactionPromptActive(payload, { finished: true });
  return true;
}

function buildPendingFromReactionState(attackMessage) {
  const reaction = attackMessage?.flags?.[MODULE_ID]?.reaction ?? null;
  if (!reaction) return null;

  const kind = reaction.kind ?? REACTION_KINDS.DEFEND;
  if (!getReactionDefinition(kind)) return null;

  const phase = reaction.phase ?? REACTION_PHASES.NONE;
  if (![REACTION_PHASES.PROMPTED, REACTION_PHASES.ROLLING].includes(phase)) return null;

  return {
    id: reaction.reactionId,
    kind,
    attackMessageId: attackMessage.id,
    attackType: reaction.attackType,
    attackSuccesses: reaction.attackerSuccesses,
    defenseSkillKey: reaction.defenseSkillKey,
    defenderActorUuid: reaction.defenderActorUuid,
    defenderActorId: reaction.defenderActorId ?? null,
    defenderTokenUuid: reaction.defenderTokenUuid ?? null,
    defenderCombatantUuid: reaction.defenderCombatantUuid,
    defenderName: reaction.defenderName,
    originalTargetActorUuid: reaction.originalTargetActorUuid ?? null,
    originalTargetTokenUuid: reaction.originalTargetTokenUuid ?? null,
    originalTargetName: reaction.originalTargetName ?? null,
    protectTriedActorIds: Array.isArray(reaction.protectTriedActorIds)
      ? foundry.utils.deepClone(reaction.protectTriedActorIds)
      : [],
    preferredCharacterActorId: reaction.preferredCharacterActorId ?? null,
    promptUserId: reaction.promptUserId ?? null,
    fallbackGmUserId: reaction.fallbackGmUserId ?? null,
    reactionDifficulty: reaction.reactionDifficulty ?? null,
    cost: Number(reaction.cost ?? 1) || 1,
    costApplied: reaction.costApplied === true,
    createdAt: Date.now()
  };
}

function isPendingReaction(reaction) {
  if (!reaction) return false;

  const kind = reaction.kind ?? REACTION_KINDS.DEFEND;
  if (!getReactionDefinition(kind)) return false;

  const phase = reaction.phase ?? REACTION_PHASES.NONE;
  return [REACTION_PHASES.PROMPTED, REACTION_PHASES.ROLLING].includes(phase);
}

function findRollingAttackMessageForDefender(actor) {
  if (!actor || !game.messages?.size) return null;

  const messages = Array.from(game.messages.values()).reverse();
  return (
    messages.find((candidate) => {
      const reaction = candidate?.flags?.[MODULE_ID]?.reaction ?? null;
            if (!isPendingReaction(reaction)) return false;

      return (
        reaction.defenderActorUuid === actor.uuid ||
        reaction.defenderActorId === actor.id ||
        (reaction.defenderActorUuid == null && reaction.defenderName && actor.name === reaction.defenderName)
      );
    }) ?? null
  );
}

function findRollingAttackMessageForDefenseMessage(message, actor = null) {
  if (!game.messages?.size) return null;

  const authorId = message?.author?.id ?? message?.user ?? null;
  const authorUser = authorId ? game.users?.get(authorId) ?? null : null;
  const messages = Array.from(game.messages.values()).reverse();

  return (
    messages.find((candidate) => {
      const reaction = candidate?.flags?.[MODULE_ID]?.reaction ?? null;
      if (!isPendingReaction(reaction)) return false;

      if (actor) {
        if (reaction.defenderActorUuid === actor.uuid) return true;
        if (reaction.defenderActorId === actor.id) return true;
      }

      if (authorId && reaction.promptUserId === authorId) return true;

      if (
        reaction.preferredCharacterActorId &&
        authorUser?.character?.id === reaction.preferredCharacterActorId
      ) {
        return true;
      }

      return false;
    }) ?? null
  );
}

function tokenDisposition(tokenDoc) {
  const value = Number(tokenDoc?.disposition);
  return Number.isFinite(value) ? value : null;
}

function getActorAttributeValue(actor, key) {
  return Number(foundry.utils.getProperty(actor, `system.attributes.${key}.value`) ?? 0) || 0;
}

function getActorSkillExpertiseValue(actor, key) {
  return Number(foundry.utils.getProperty(actor, `system.skills.${key}.expertise.value`) ?? 0) || 0;
}

function getProtectPriority(actor) {
  if (!actor) return 0;

  if (String(actor.type ?? "").toLowerCase() === "character") {
    return getActorAttributeValue(actor, "coo") + getActorSkillExpertiseValue(actor, "par");
  }

  return Number(foundry.utils.getProperty(actor, "system.skills.cmb.value") ?? 0) || 0;
}

function getRetaliatePriority(actor) {
  if (!actor) return 0;

  if (String(actor.type ?? "").toLowerCase() === "character") {
    return getActorAttributeValue(actor, "agi") + getActorSkillExpertiseValue(actor, "mel");
  }

  return Number(foundry.utils.getProperty(actor, "system.skills.cmb.value") ?? 0) || 0;
}

function isProtectAllyToken(candidateToken, originalTargetToken, attackerToken = null) {
  const friendly = CONST.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1;

  const candidateDisposition = tokenDisposition(candidateToken);
  const targetDisposition = tokenDisposition(originalTargetToken);
  const attackerDisposition = tokenDisposition(attackerToken);

  if (candidateDisposition == null || targetDisposition == null) return false;
  if (candidateDisposition !== friendly) return false;
  if (targetDisposition !== friendly) return false;
  if (attackerDisposition != null && candidateDisposition === attackerDisposition) return false;

  return true;
}

async function collectProtectCandidates(message, { excludeActorIds = [] } = {}) {
  const flags = message?.flags?.[MODULE_ID] ?? null;
  const targets = flags?.targets ?? [];
  if (targets.length !== 1) return [];

  const excluded = new Set(
    (Array.isArray(excludeActorIds) ? excludeActorIds : []).filter(Boolean).map(String)
  );

  const originalTarget = targets[0];
  const originalTargetToken = await resolveTokenDoc(originalTarget.tokenUuid);
  const originalTargetActor = originalTargetToken?.actor ?? null;
  if (!originalTargetToken?.parent || !originalTargetActor) return [];

  const attackerTokenUuid = flags?.context?.attackerTokenUuid ?? null;
  const attackerToken = attackerTokenUuid ? await resolveTokenDoc(attackerTokenUuid) : null;
  const attackerActor = attackerToken?.actor ?? null;

  const attackType = classifyAttackType(message);
  if (!attackType) return [];

  const candidates = [];

  for (const tokenDoc of originalTargetToken.parent.tokens.contents ?? []) {
    const protectorActor = tokenDoc?.actor ?? null;
    if (!protectorActor) continue;
    if (tokenDoc.id === originalTargetToken.id) continue;
    if (protectorActor.id === originalTargetActor.id) continue;
    if (excluded.has(String(protectorActor.id))) continue;
    if (attackerToken?.id && tokenDoc.id === attackerToken.id) continue;
    if (attackerActor?.id && protectorActor.id === attackerActor.id) continue;
    if (!isProtectAllyToken(tokenDoc, originalTargetToken, attackerToken)) continue;

    const reachResult = resolveWithinReach({
      actor: protectorActor,
      targetActor: originalTargetActor,
      token: tokenDoc,
      targetToken: originalTargetToken,
      purpose: REACTION_KINDS.PROTECT
    });

    if (!isWithinReachKnown(reachResult) || reachResult.withinReach !== true) continue;

    const defenseSkillKey = resolveActorDefenseRoute(protectorActor, { attackType })?.skillKey ?? null;
    if (!defenseSkillKey) continue;

    const routing = getPromptRouting(protectorActor, tokenDoc, {
      attackType,
      defenseSkillKey
    });
    if (!routing.promptUserId) continue;

    const baseDefenderActor = getBaseActor(protectorActor, tokenDoc);
    const actorDoc = baseDefenderActor ?? protectorActor;

    candidates.push({
      attackType,
      originalTarget,
      originalTargetToken,
      originalTargetActor,
      defenderActor: protectorActor,
      defenderActorId: actorDoc?.id ?? protectorActor.id ?? null,
      defenderTokenDoc: tokenDoc,
      defenderCombatant: findCombatantForActor(protectorActor),
      defenseSkillKey,
      baseDefenderActor,
      defenderName: tokenDoc.name ?? protectorActor.name ?? null,
      protectPriority: getProtectPriority(actorDoc ?? protectorActor),
      promptUserId: routing.promptUserId ?? null,
      fallbackGmUserId: routing.fallbackGmUserId ?? null
    });
  }

  candidates.sort((left, right) => {
    const priorityDiff = Number(right.protectPriority ?? 0) - Number(left.protectPriority ?? 0);
    if (priorityDiff !== 0) return priorityDiff;

    return String(left.defenderName ?? "").localeCompare(String(right.defenderName ?? ""));
  });

  return candidates;
}

function isRetaliateEnemyToken(candidateToken, actingToken) {
  const hostile = CONST.TOKEN_DISPOSITIONS?.HOSTILE ?? -1;
  const friendly = CONST.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1;

  const candidateDisposition = tokenDisposition(candidateToken);
  const actingDisposition = tokenDisposition(actingToken);

  if (candidateDisposition == null || actingDisposition == null) return false;

  return (
    (candidateDisposition === hostile && actingDisposition === friendly) ||
    (candidateDisposition === friendly && actingDisposition === hostile)
  );
}

function getActorTokenDoc(actor) {
  const direct = actor?.token?.document ?? actor?.token ?? null;
  if (direct) return direct;

  const placeable = actor?.getActiveTokens?.()?.[0] ?? null;
  return placeable?.document ?? placeable ?? null;
}

function isRetaliateMeleeItem(item, actorType = "") {
  if (!item) return false;

  const type = String(item.type ?? "").toLowerCase();
  const weaponType = String(item.system?.weaponType ?? item.system?.attackType ?? "").toLowerCase();

  if (type === "display") return false;
  if (weaponType === "ranged" || weaponType === "threaten") return false;

  if (type === "weapon") return weaponType === "melee";
  if (type === "npcattack") return weaponType !== "ranged";

  return false;
}

function getRetaliateItemPriority(item) {
  const reach = Number(readItemReach(item) ?? 0) || 0;
  const damageDice = Number(item?.system?.damage?.dice ?? 0) || 0;
  return (reach * 100) + damageDice;
}

function pickRetaliateAttackItem(actor) {
  if (!actor?.items?.size) return null;

  const actorType = String(actor.type ?? "").toLowerCase();
  const items = Array.from(actor.items ?? []);

  const candidates = items.filter((item) => {
    if (!isRetaliateMeleeItem(item, actorType)) return false;
    if (actorType === "character" && item.type === "weapon" && item.system?.equipped !== true) return false;
    return true;
  });

  candidates.sort((left, right) => {
    const diff = getRetaliateItemPriority(right) - getRetaliateItemPriority(left);
    if (diff !== 0) return diff;
    return String(left.name ?? "").localeCompare(String(right.name ?? ""));
  });

  return candidates[0] ?? null;
}

async function collectRetaliateCandidates(context) {
  const actingActor = context?.actor ?? null;
  const actingToken = getActorTokenDoc(actingActor);
  if (!actingActor || !actingToken?.parent) return [];

  const candidates = [];

  for (const tokenDoc of actingToken.parent.tokens.contents ?? []) {
    const retaliatorActor = tokenDoc?.actor ?? null;
    if (!retaliatorActor) continue;
    if (tokenDoc.id === actingToken.id) continue;
    if (!isRetaliateEnemyToken(tokenDoc, actingToken)) continue;

    const reachResult = resolveWithinReach({
      actor: retaliatorActor,
      targetActor: actingActor,
      token: tokenDoc,
      targetToken: actingToken,
      purpose: REACTION_KINDS.RETALIATE
    });

    if (!isWithinReachKnown(reachResult) || reachResult.withinReach !== true) continue;

    const retaliateItem = pickRetaliateAttackItem(retaliatorActor);
    if (!retaliateItem) continue;

    const routing = getPromptRouting(retaliatorActor, tokenDoc, {
      attackType: ATTACK_TYPES.MELEE,
      defenseSkillKey: null
    });

    if (!routing.promptUserId) continue;

    const baseDefenderActor = getBaseActor(retaliatorActor, tokenDoc);
    const actorDoc = baseDefenderActor ?? retaliatorActor;

    candidates.push({
      retaliatorActor,
      retaliatorTokenDoc: tokenDoc,
      retaliatorCombatant: findCombatantForActor(retaliatorActor),
      retaliateItem,
      retaliatePriority: getRetaliatePriority(actorDoc ?? retaliatorActor),
      retaliatorName: tokenDoc.name ?? retaliatorActor.name ?? null,
      originalTargetName: actingToken.name ?? actingActor.name ?? null,
      promptUserId: routing.promptUserId ?? null,
      fallbackGmUserId: routing.fallbackGmUserId ?? null,
      baseDefenderActor
    });
  }

  candidates.sort((left, right) => {
    const diff = Number(right.retaliatePriority ?? 0) - Number(left.retaliatePriority ?? 0);
    if (diff !== 0) return diff;
    return String(left.retaliatorName ?? "").localeCompare(String(right.retaliatorName ?? ""));
  });

  return candidates;
}

function isOffensiveRetaliateContext(context) {
  const itemType = String(context?.item?.type ?? "").toLowerCase();
  const attackType = String(
    context?.item?.system?.attackType ??
    context?.item?.system?.weaponType ??
    ""
  ).toLowerCase();

  const purpose = String(
    context?.purpose ??
    context?.pendingIntent?.metadata?.rollPurpose ??
    ""
  ).toLowerCase();

  const detailsText = String(
    context?.root?.textContent ??
    context?.data?.difficulty?.display ??
    ""
  ).toLowerCase();

  if (purpose === "attack" || purpose === "damage") return true;
  if (["weapon", "npcattack", "display"].includes(itemType)) return true;
  if (["melee", "ranged", "threaten"].includes(attackType)) return true;

  // Safety net for native display / threaten rollers that do not expose clean item metadata.
  if (detailsText.includes("display") || detailsText.includes("threaten")) return true;

  return false;
}

function isPendingDefenseReactionContext(context) {
  const attackMessage = findRollingAttackMessageForDefender(context?.actor ?? null);
  const pending = buildPendingFromReactionState(attackMessage);
  if (!pending) return false;

  return [REACTION_KINDS.DEFEND, REACTION_KINDS.PROTECT].includes(pending.kind);
}

function isRangedRetaliateContext(context) {
  if (context?.kind !== "weapon-attack") return false;

  const attackType = String(
    context?.item?.system?.attackType ??
    context?.item?.system?.weaponType ??
    ""
  ).toLowerCase();

  return attackType === ATTACK_TYPES.RANGED;
}

function isRetaliateContextEligible(context) {
  if (!game.combat?.started) return false;
  if (!context?.app || !context?.actor) return false;
  if (isPendingDefenseReactionContext(context)) return false;

  const reactionKind = String(context?.pendingIntent?.metadata?.reactionKind ?? "").toLowerCase();
  if (reactionKind) return false;

  if (context.kind === "skill-roll") {
    if (context.purpose === "defense") return false;
    if (context.pendingIntent?.type === "weapon-attack") return false;
    if (isOffensiveRetaliateContext(context)) return false;
    return true;
  }

  if (context.kind === "weapon-attack") {
    return isRangedRetaliateContext(context);
  }

  return false;
}

export async function maybeCancelPendingReactionFromSkillRollerContext(context) {
  const actor = context?.actor ?? null;
  if (!actor) return false;

  const attackMessage = findRollingAttackMessageForDefender(actor);
  if (!attackMessage) return false;

  const pending = buildPendingFromReactionState(attackMessage);
  if (!pending) return false;
  if (![REACTION_KINDS.DEFEND, REACTION_KINDS.PROTECT].includes(pending.kind)) return false;

  const payload = {
    kind: pending.kind,
    reactionId: pending.id,
    attackMessageId: pending.attackMessageId,
    protectTriedActorIds: Array.isArray(pending.protectTriedActorIds)
      ? foundry.utils.deepClone(pending.protectTriedActorIds)
      : []
  };

  if (isAuthoritativeForAttackMessage(attackMessage)) {
    return cancelReaction(payload);
  }

  emitSocket(SOCKET_OPS.CANCEL_REACTION, payload);
  return true;
}

export async function maybeStartRetaliateWorkflow(context) {
  if (!isRetaliateContextEligible(context)) return false;
  if (context.app._c2mqRetaliateHandled === true) return false;

  context.app._c2mqRetaliateHandled = true;

  const candidates = await collectRetaliateCandidates(context);
  if (!candidates.length) return false;

  let prompted = false;

  for (const candidate of candidates) {
    const cost = candidate.retaliatorCombatant ? getNextReactionCost(candidate.retaliatorCombatant) : 1;

    const payload = {
      reactionId: foundry.utils.randomID(),
      kind: REACTION_KINDS.RETALIATE,
      attackMessageId: context.app.id ?? foundry.utils.randomID(),
      attackType: ATTACK_TYPES.MELEE,
      attackSuccesses: 0,
      defenseSkillKey: null,
      defenderActorUuid: candidate.baseDefenderActor?.uuid ?? candidate.retaliatorActor?.uuid ?? null,
      defenderActorId: candidate.baseDefenderActor?.id ?? candidate.retaliatorActor?.id ?? null,
      defenderTokenUuid: candidate.retaliatorTokenDoc?.uuid ?? null,
      defenderCombatantUuid: candidate.retaliatorCombatant?.uuid ?? null,
      defenderName: candidate.retaliatorName,
      originalTargetActorUuid: context.actor?.uuid ?? null,
      originalTargetTokenUuid: getActorTokenDoc(context.actor)?.uuid ?? null,
      originalTargetName: candidate.originalTargetName,
      retaliateItemId: candidate.retaliateItem?.id ?? null,
      retaliateItemName: candidate.retaliateItem?.name ?? null,
      promptUserId: candidate.promptUserId ?? null,
      fallbackGmUserId: candidate.fallbackGmUserId ?? null,
      preferredCharacterActorId: candidate.baseDefenderActor?.id ?? candidate.retaliatorActor?.id ?? null,
      cost
    };

    const shouldHandleLocally = payload.promptUserId === game.user?.id;

    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] retaliate prompt`, {
        skillActorId: context.actor?.id ?? null,
        payload,
        candidateCount: candidates.length
      });
    }

    if (shouldHandleLocally) {
      await promptReactionDecision(payload);
      prompted = true;
      continue;
    }

    emitSocket(SOCKET_OPS.PROMPT_REACTION, payload);
    prompted = true;
  }

  return prompted;
}

export async function maybeStartProtectWorkflow(
  message,
  { excludeActorIds = null } = {}
) {
  if (!autoProtectEnabled()) return false;
  if (!isAuthoritativeForAttackMessage(message)) return false;
  if (!isAttackMessage(message)) return false;
  if (!isSuccessfulRoll(message)) return false;

  await ensureMessageFlags(message);

  const fresh = game.messages?.get(message.id) ?? message;
  const reaction = fresh.flags?.[MODULE_ID]?.reaction ?? {};
  const attemptedActorIds = Array.isArray(excludeActorIds)
    ? foundry.utils.deepClone(excludeActorIds)
    : (Array.isArray(reaction.protectTriedActorIds) ? foundry.utils.deepClone(reaction.protectTriedActorIds) : []);

  if (
    reaction.kind === REACTION_KINDS.PROTECT &&
    [REACTION_PHASES.PROMPTED, REACTION_PHASES.ROLLING].includes(reaction.phase)
  ) {
    return reaction.blockedDamage === true;
  }

  const candidates = await collectProtectCandidates(fresh, {
    excludeActorIds: attemptedActorIds
  });
  if (!candidates.length) return false;

  const candidate = candidates[0];
  const attackSuccesses = getRollSuccessCount(fresh);
  const cost = candidate.defenderCombatant ? getNextReactionCost(candidate.defenderCombatant) : 1;

  const payload = buildPendingReactionPayload({
    kind: REACTION_KINDS.PROTECT,
    message: fresh,
    defenderActor: candidate.defenderActor,
    defenderCombatant: candidate.defenderCombatant,
    target: {
      tokenUuid: candidate.defenderTokenDoc.uuid,
      name: candidate.defenderName
    },
    attackType: candidate.attackType,
    defenseSkillKey: candidate.defenseSkillKey,
    attackSuccesses,
    cost,
    baseDefenderActor: candidate.baseDefenderActor
  });

  payload.preferredCharacterActorId =
    candidate.baseDefenderActor?.id ?? candidate.defenderActor.id ?? null;
  payload.promptUserId = candidate.promptUserId ?? null;
  payload.fallbackGmUserId = candidate.fallbackGmUserId ?? null;
  payload.originalTargetActorUuid = candidate.originalTargetActor?.uuid ?? null;
  payload.originalTargetTokenUuid = candidate.originalTarget?.tokenUuid ?? null;
  payload.originalTargetName =
    candidate.originalTarget?.name ?? candidate.originalTargetActor?.name ?? null;
  payload.protectTriedActorIds = [...attemptedActorIds, candidate.defenderActorId];
  payload.reactionDifficulty = 2;

  await setReactionState(fresh, {
    kind: REACTION_KINDS.PROTECT,
    phase: REACTION_PHASES.PROMPTED,
    attackType: candidate.attackType,
    blockedDamage: true,
    outcome: null,
    reactionId: payload.reactionId,
    attackerSuccesses: attackSuccesses,
    defenseSkillKey: payload.defenseSkillKey,
    defenderActorUuid: payload.defenderActorUuid,
    defenderActorId: payload.defenderActorId ?? null,
    defenderTokenUuid: payload.defenderTokenUuid ?? payload.targetTokenUuid ?? null,
    defenderCombatantUuid: payload.defenderCombatantUuid,
    defenderName: payload.defenderName,
    originalTargetActorUuid: payload.originalTargetActorUuid ?? null,
    originalTargetTokenUuid: payload.originalTargetTokenUuid ?? null,
    originalTargetName: payload.originalTargetName ?? null,
    protectTriedActorIds: payload.protectTriedActorIds,
    preferredCharacterActorId: payload.preferredCharacterActorId ?? null,
    promptUserId: payload.promptUserId ?? null,
    fallbackGmUserId: payload.fallbackGmUserId ?? null,
    reactionDifficulty: 2,
    cost
  });

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] protect prompt`, {
      messageId: fresh.id,
      payload,
      candidateCount: candidates.length
    });
  }

  const shouldHandleLocally = payload.promptUserId === game.user?.id;

  if (shouldHandleLocally) {
    await promptReactionDecision(payload);
    return true;
  }

  emitSocket(SOCKET_OPS.PROMPT_REACTION, payload);
  return true;
}

export async function maybeStartReactionWorkflow(
  message,
  { kind = REACTION_KINDS.DEFEND } = {}
) {
  const definition = getReactionDefinition(kind);
  if (!definition) return false;
  if (!isAuthoritativeForAttackMessage(message)) return false;
  if (!isAttackMessage(message)) return false;
  if (!isSuccessfulRoll(message)) return false;

  await ensureMessageFlags(message);

  const fresh = game.messages?.get(message.id) ?? message;
  const flags = fresh.flags?.[MODULE_ID];
  const reaction = flags?.reaction ?? {};
  if (reaction.phase && reaction.phase !== REACTION_PHASES.NONE) {
    return reaction.blockedDamage === true;
  }

  let targets = flags?.targets ?? [];
  if (targets.length !== 1 && fresh.author?.id === game.user?.id) {
    const liveTargets = collectCurrentTargets();
    if (liveTargets.length === 1) {
      const next = foundry.utils.duplicate(flags);
      next.targets = liveTargets;
      next.applied = {};
      await fresh.update({ [`flags.${MODULE_ID}`]: next });

      const refreshed = game.messages?.get(fresh.id) ?? fresh;
      targets = refreshed.flags?.[MODULE_ID]?.targets ?? liveTargets;
    }
  }

  if (targets.length !== 1) {
    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] reaction skipped: expected exactly 1 target`, {
        kind,
        messageId: fresh.id,
        authorUserId: fresh.author?.id ?? null,
        targets
      });
    }
    return false;
  }

  const target = targets[0];
  const tokenDoc = await resolveTokenDoc(target.tokenUuid);
  const defenderActor = tokenDoc?.actor ?? null;
  if (!defenderActor) {
    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] reaction skipped: target token has no actor`, {
        kind,
        messageId: fresh.id,
        target
      });
    }
    return false;
  }

  const defenderCombatant = findCombatantForActor(defenderActor);
  if (!defenderCombatant && debugEnabled()) {
    console.debug(`[${MODULE_ID}] reaction continuing without combatant`, {
      kind,
      messageId: fresh.id,
      defenderActorId: defenderActor.id
    });
  }

  const attackType = classifyAttackType(fresh);
  if (!attackType) return false;

  const reactionRoute = definition.resolveRoute?.(defenderActor, { attackType }) ?? null;
  const defenseSkillKey = reactionRoute?.skillKey ?? null;

  if (!defenseSkillKey) {
    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] reaction skipped: no exact route for actor`, {
        kind,
        messageId: fresh.id,
        defenderActorId: defenderActor.id,
        actorType: defenderActor.type,
        attackType,
        availableSkills: Object.keys(defenderActor.system?.skills ?? {})
      });
    }
    return false;
  }

  const routing = getPromptRouting(defenderActor, tokenDoc, {
    attackType,
    defenseSkillKey
  });
  if (!routing.promptUserId) {
    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] reaction skipped: no prompt user resolved`, {
        kind,
        messageId: fresh.id,
        defenderActorId: defenderActor.id,
        tokenActorId: tokenDoc?.actorId ?? null
      });
    }
    return false;
  }

  const attackSuccesses = getRollSuccessCount(fresh);
  const cost = defenderCombatant ? getNextReactionCost(defenderCombatant) : 1;
  const baseDefenderActor = getBaseActor(defenderActor, tokenDoc);

  const payload = buildPendingReactionPayload({
    kind,
    message: fresh,
    defenderActor,
    defenderCombatant,
    target,
    attackType,
    defenseSkillKey,
    attackSuccesses,
    cost,
    baseDefenderActor
  });

  payload.preferredCharacterActorId = baseDefenderActor?.id ?? defenderActor.id ?? null;
  payload.promptUserId = routing.promptUserId ?? null;
  payload.fallbackGmUserId = routing.fallbackGmUserId ?? null;

  await setReactionState(fresh, {
    kind,
    phase: REACTION_PHASES.PROMPTED,
    attackType,
    blockedDamage: definition.blocksDamageWhenPrompted === true,
    outcome: null,
    reactionId: payload.reactionId,
    attackerSuccesses: attackSuccesses,
    defenseSkillKey,
    defenderActorUuid: payload.defenderActorUuid,
    defenderActorId: payload.defenderActorId ?? null,
    defenderCombatantUuid: payload.defenderCombatantUuid,
    defenderName: payload.defenderName,
    preferredCharacterActorId: payload.preferredCharacterActorId ?? null,
    promptUserId: payload.promptUserId ?? null,
    fallbackGmUserId: payload.fallbackGmUserId ?? null,
    cost
  });

  const shouldHandleLocally = payload.promptUserId === game.user?.id;

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] reaction prompt`, {
      kind,
      payload,
      routing,
      preferredCharacterActorId: payload.preferredCharacterActorId ?? null,
      shouldHandleLocally,
      currentUserId: game.user?.id ?? null
    });
  }

  if (shouldHandleLocally) {
    await promptReactionDecision(payload);
    return true;
  }

  emitSocket(SOCKET_OPS.PROMPT_REACTION, payload);
  return true;
}

export async function maybeStartDefendWorkflow(message) {
  return maybeStartReactionWorkflow(message, {
    kind: REACTION_KINDS.DEFEND
  });
}

export async function beginReaction(payload) {
  const kind = payload?.kind ?? REACTION_KINDS.DEFEND;
  const definition = getReactionDefinition(kind);
  if (!definition) return false;

  const message = game.messages?.get(payload?.attackMessageId);
  if (!message || !isAuthoritativeForAttackMessage(message)) return false;

  let defenderCombatant = null;
  if (payload?.defenderCombatantUuid) {
    try {
      defenderCombatant = await fromUuid(payload.defenderCombatantUuid);
    } catch (_e) {
      defenderCombatant = null;
    }
  }

  const defenderActor = await resolveDefenderActorFromPayload(payload);
  const reactionCost = Number(payload.cost ?? 1) || 1;
  const costApplied = definition.applyCost
    ? await definition.applyCost(defenderActor, reactionCost)
    : true;

  if (!costApplied && definition.trackerUnavailableWarningKey) {
    ui.notifications?.warn(game.i18n.localize(definition.trackerUnavailableWarningKey));
  }

  const pending = {
    id: payload.reactionId,
    kind,
    attackMessageId: payload.attackMessageId,
    attackType: payload.attackType,
    attackSuccesses: payload.attackSuccesses,
    defenseSkillKey: payload.defenseSkillKey,
    defenderActorUuid: payload.defenderActorUuid,
    defenderActorId: payload.defenderActorId ?? null,
    defenderTokenUuid: payload.defenderTokenUuid ?? payload.targetTokenUuid ?? null,
    defenderCombatantUuid: payload.defenderCombatantUuid ?? null,
    defenderName: payload.defenderName,
    originalTargetActorUuid: payload.originalTargetActorUuid ?? null,
    originalTargetTokenUuid: payload.originalTargetTokenUuid ?? null,
    originalTargetName: payload.originalTargetName ?? null,
    retaliateItemId: payload.retaliateItemId ?? null,
    retaliateItemName: payload.retaliateItemName ?? null,
    protectTriedActorIds: Array.isArray(payload.protectTriedActorIds)
      ? foundry.utils.deepClone(payload.protectTriedActorIds)
      : [],
    reactionDifficulty: payload.reactionDifficulty ?? null,
    cost: reactionCost,
    costApplied: costApplied === true,
    createdAt: Date.now()
  };

  if (defenderCombatant) {
    if (kind !== REACTION_KINDS.RETALIATE) {
      await pushPendingReaction(defenderCombatant, pending);
    }

    await incrementReactionCount(defenderCombatant, {
      kind,
      cost: pending.cost,
      attackMessageId: pending.attackMessageId,
      outcome: null
    });
  }

  if (kind === REACTION_KINDS.RETALIATE) {
    return true;
  }

  await setReactionState(message, {
    kind,
    phase: REACTION_PHASES.ROLLING,
    blockedDamage: definition.blocksDamageWhileRolling === true,
    outcome: null,
    reactionId: payload.reactionId,
    attackerSuccesses: payload.attackSuccesses,
    defenseSkillKey: payload.defenseSkillKey,
    defenderActorUuid: payload.defenderActorUuid,
    defenderActorId: payload.defenderActorId ?? null,
    defenderTokenUuid: payload.defenderTokenUuid ?? payload.targetTokenUuid ?? null,
    defenderCombatantUuid: payload.defenderCombatantUuid ?? null,
    defenderName: payload.defenderName,
    originalTargetActorUuid: payload.originalTargetActorUuid ?? null,
    originalTargetTokenUuid: payload.originalTargetTokenUuid ?? null,
    originalTargetName: payload.originalTargetName ?? null,
    protectTriedActorIds: pending.protectTriedActorIds,
    reactionDifficulty: payload.reactionDifficulty ?? null,
    cost: pending.cost,
    costApplied: pending.costApplied
  });

  return true;
}

export async function beginDefendReaction(payload) {
  return beginReaction({
    ...(payload ?? {}),
    kind: payload?.kind ?? REACTION_KINDS.DEFEND
  });
}

export async function cancelReaction(payload) {
  const kind = payload?.kind ?? REACTION_KINDS.DEFEND;
  if (!getReactionDefinition(kind)) return false;

  if (kind === REACTION_KINDS.RETALIATE) {
    return true;
  }

  const message = game.messages?.get(payload?.attackMessageId);
  if (!message || !isAuthoritativeForAttackMessage(message)) return false;

  await setReactionState(message, {
    kind,
    phase: REACTION_PHASES.DECLINED,
    blockedDamage: false,
    outcome: REACTION_OUTCOMES.DECLINED,
    reactionId: payload?.reactionId ?? null,
    protectTriedActorIds: Array.isArray(payload?.protectTriedActorIds)
      ? foundry.utils.deepClone(payload.protectTriedActorIds)
      : []
  });

  const fresh = game.messages?.get(message.id) ?? message;
  refreshChatUI();

  if (kind === REACTION_KINDS.DEFEND) {
    const protectBlocked = await maybeStartProtectWorkflow(fresh);
    if (protectBlocked) {
      refreshChatUI();
      return true;
    }
  }

  if (kind === REACTION_KINDS.PROTECT) {
    const protectBlocked = await maybeStartProtectWorkflow(fresh, {
      excludeActorIds: Array.isArray(payload?.protectTriedActorIds)
        ? payload.protectTriedActorIds
        : (Array.isArray(fresh.flags?.[MODULE_ID]?.reaction?.protectTriedActorIds)
            ? fresh.flags[MODULE_ID].reaction.protectTriedActorIds
            : [])
    });

    if (protectBlocked) {
      refreshChatUI();
      return true;
    }
  }

  await continueAttackResolution(fresh);
  refreshChatUI();
  return true;
}

export async function cancelDefendReaction(payload) {
  return cancelReaction({
    ...(payload ?? {}),
    kind: payload?.kind ?? REACTION_KINDS.DEFEND
  });
}

export async function maybeResolvePendingReactionRoll(message) {
  let actor = await resolveActorFromMessage(message);
  let combatant = actor ? findCombatantForActor(actor) : null;
  let pending = combatant
    ? findPendingReaction(combatant, (entry) => !!getReactionDefinition(entry?.kind ?? REACTION_KINDS.DEFEND))
    : null;

  let attackMessage = pending ? game.messages?.get(pending.attackMessageId) ?? null : null;
  let activePending = pending ?? null;

  if (!attackMessage && actor) {
    attackMessage = findRollingAttackMessageForDefender(actor);
    if (attackMessage) activePending = buildPendingFromReactionState(attackMessage);
  }

  if (!attackMessage) {
    attackMessage = findRollingAttackMessageForDefenseMessage(message, actor);
    if (attackMessage) activePending = buildPendingFromReactionState(attackMessage);
  }

  const kind = activePending?.kind ?? REACTION_KINDS.DEFEND;
  const definition = getReactionDefinition(kind);

  if (!attackMessage || !activePending || !definition) return false;
  if (!isAuthoritativeForAttackMessage(attackMessage)) return false;

  if (!actor) {
    actor = await resolveDefenderActorFromPayload(activePending);
    combatant = actor ? findCombatantForActor(actor) : null;
  }

  if (combatant && pending) {
    const removed = await consumePendingReaction(combatant, (entry) => entry?.id === pending.id);
    activePending = removed ?? activePending;
  }

  const defenseSuccesses = isSuccessfulRoll(message) ? getRollSuccessCount(message) : 0;
  const outcome = definition.resolveOutcome(activePending.attackSuccesses, defenseSuccesses);

  const reactionPatch = {
    kind,
    phase: REACTION_PHASES.RESOLVED,
    blockedDamage: definition.blocksDamageWhenResolved === true,
    outcome,
    reactionId: activePending.id,
    attackerSuccesses: activePending.attackSuccesses,
    defenseSuccesses,
    defenseSkillKey: activePending.defenseSkillKey,
    defenderActorUuid: activePending.defenderActorUuid,
    defenderActorId: activePending.defenderActorId ?? actor?.id ?? null,
    defenderTokenUuid: activePending.defenderTokenUuid ?? null,
    defenderCombatantUuid: activePending.defenderCombatantUuid,
    defenderName: activePending.defenderName,
    originalTargetActorUuid: activePending.originalTargetActorUuid ?? null,
    originalTargetTokenUuid: activePending.originalTargetTokenUuid ?? null,
    originalTargetName: activePending.originalTargetName ?? null,
    protectTriedActorIds: Array.isArray(activePending.protectTriedActorIds)
      ? foundry.utils.deepClone(activePending.protectTriedActorIds)
      : [],
    preferredCharacterActorId: activePending.preferredCharacterActorId ?? null,
    promptUserId: activePending.promptUserId ?? null,
    fallbackGmUserId: activePending.fallbackGmUserId ?? null,
    reactionDifficulty: activePending.reactionDifficulty ?? null,
    cost: activePending.cost,
    costApplied: activePending.costApplied,
    resolvedByMessageId: message.id
  };

  const shouldRetargetToProtector =
    kind === REACTION_KINDS.PROTECT &&
    defenseSuccesses > 0 &&
    outcome === REACTION_OUTCOMES.HIT &&
    !!activePending.defenderTokenUuid;

  if (shouldRetargetToProtector && attackMessage.flags?.[MODULE_ID]) {
    const next = foundry.utils.duplicate(attackMessage.flags[MODULE_ID]);

    next.targets = [{
      tokenUuid: activePending.defenderTokenUuid,
      name: activePending.defenderName ?? actor?.name ?? game.i18n.localize("C2MQ.UnknownActor")
    }];

    next.applied = {};
    if (next.hitLocation?.byTarget) next.hitLocation.byTarget = {};

    next.reaction = foundry.utils.mergeObject(next.reaction ?? {}, reactionPatch, {
      inplace: false,
      insertKeys: true,
      insertValues: true,
      overwrite: true
    });

    await attackMessage.update({ [`flags.${MODULE_ID}`]: next });
  } else {
    await setReactionState(attackMessage, reactionPatch);
  }

  if (
    kind === REACTION_KINDS.PROTECT &&
    defenseSuccesses <= 0 &&
    outcome === REACTION_OUTCOMES.HIT
  ) {
    const nextProtectStarted = await maybeStartProtectWorkflow(attackMessage, {
      excludeActorIds: Array.isArray(activePending.protectTriedActorIds)
        ? activePending.protectTriedActorIds
        : []
    });

    if (nextProtectStarted) {
      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] protect chaining to next candidate`, {
          attackMessageId: attackMessage.id,
          defenseMessageId: message.id,
          triedActorIds: activePending.protectTriedActorIds ?? []
        });
      }
      return false;
    }
  }

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] reaction resolved`, {
      kind,
      attackMessageId: attackMessage.id,
      defenseMessageId: message.id,
      attackSuccesses: activePending.attackSuccesses,
      defenseSuccesses,
      outcome,
      retargetedToProtector: shouldRetargetToProtector,
      defenderActorId: actor?.id ?? null
    });
  }

  return outcome;
}

export async function maybeResolvePendingDefenseRoll(message) {
  return maybeResolvePendingReactionRoll(message);
}

export async function promptReactionFromSocket(payload) {
  const currentUserId = game.user?.id ?? null;
  const promptUserId = payload?.promptUserId ?? null;
  const fallbackGmUserId = payload?.fallbackGmUserId ?? null;

  const shouldPromptHere =
    (promptUserId && promptUserId === currentUserId) ||
    (!promptUserId && fallbackGmUserId && fallbackGmUserId === currentUserId);

  if (!shouldPromptHere) {
    if (debugEnabled()) {
      console.debug(`[${MODULE_ID}] reaction socket prompt ignored on this client`, {
        kind: payload?.kind ?? REACTION_KINDS.DEFEND,
        userId: currentUserId,
        promptUserId,
        fallbackGmUserId,
        reactionId: payload?.reactionId ?? null
      });
    }
    return false;
  }

  // The authoritative client already resolved the recipient.
  // Do not re-run ownership heuristics on the receiving client.
  await promptReactionDecision(payload);
  return true;
}

export async function promptDefendFromSocket(payload) {
  return promptReactionFromSocket({
    ...(payload ?? {}),
    kind: payload?.kind ?? REACTION_KINDS.DEFEND
  });
}