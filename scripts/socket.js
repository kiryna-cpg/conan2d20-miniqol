import {
  SOCKET_NAME,
  MODULE_ID,
  SETTING_KEYS,
  SOCKET_OPS,
  COMBAT_STATE_CLEAR_MODES
} from "./constants.js";
import {
  execRollDamage,
  execRerollDamage,
  execApplyDamage,
  execUndoDamage,
  promptSacrificialItemFromSocket,
  resolveSacrificialItemPrompt
} from "./workflows/damage-workflow.js";
import { execBreakGuard } from "./workflows/guard-workflow.js";
import { execDisarm } from "./workflows/disarm-workflow.js";
import { ensureMessageFlags } from "./workflows/message-flags.js";
import {
  patchCombatState,
  clearCombatState,
  resolveCombatantFromUuid
} from "./state/combat-state-store.js";
import {
  promptReactionFromSocket,
  beginReaction,
  cancelReaction
} from "./workflows/reaction-workflow.js";

let _socketRegistered = false;

function debugEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.DEBUG);
}

function hasActiveGM() {
  return game.users?.some((user) => user.active && user.isGM);
}

function isAuthoritativeForMessage(message, op = null) {
  if (game.user?.isGM) return true;

  // Damage rolling may still be handled by the chat message author.
  if (op === SOCKET_OPS.ROLL_DAMAGE) {
    return message?.author?.id === game.user?.id;
  }

  // All message mutations that can affect actor state should be GM-authoritative
  // whenever a GM is connected.
  if (hasActiveGM()) return false;

  return message?.author?.id === game.user?.id;
}

function isAuthoritativeForCombatant(combatant) {
  if (game.user?.isGM) return true;
  if (hasActiveGM()) return false;
  return combatant?.actor?.isOwner === true;
}

function getRequesterUser(payload) {
  const requesterUserId = payload?.requesterUserId ?? null;
  return requesterUserId ? game.users?.get(requesterUserId) ?? null : null;
}

function getMessageAuthorId(message) {
  const raw =
    message?.author?.id ??
    message?.user?.id ??
    message?.user ??
    message?._source?.user ??
    null;

  return typeof raw === "object" ? raw?.id ?? null : raw;
}

function actorIdFromUuid(actorUuid) {
  const parts = String(actorUuid ?? "").split(".");
  return parts[0] === "Actor" ? parts[1] ?? null : null;
}

function getMessagePermissionActor(message) {
  const actorId =
    message?.speaker?.actor ??
    actorIdFromUuid(message?.flags?.[MODULE_ID]?.context?.attackerActorUuid) ??
    message?.flags?.data?.actor?._id ??
    message?.flags?.data?.actor?.id ??
    message?.flags?.data?.rollData?.actorId ??
    null;

  if (actorId && game.actors?.has?.(actorId)) return game.actors.get(actorId);

  const tokenDoc = getMessagePermissionToken(message);
  return tokenDoc?.actor ?? null;
}

function getMessagePermissionToken(message) {
  const sceneId = message?.speaker?.scene ?? null;
  const tokenId = message?.speaker?.token ?? null;
  if (!sceneId || !tokenId) return null;

  return game.scenes?.get(sceneId)?.tokens?.get(tokenId)
    ?? (canvas?.scene?.id === sceneId ? canvas.scene?.tokens?.get(tokenId) ?? null : null)
    ?? null;
}

function userOwnsDocument(user, document) {
  if (!user || !document) return false;
  if (user.id === game.user?.id && document.isOwner === true) return true;

  if (typeof document.testUserPermission === "function") {
    try {
      if (document.testUserPermission(user, "OWNER")) return true;
    } catch (_e) {
      // Continue with numeric and ownership fallbacks below.
    }

    try {
      const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
      if (document.testUserPermission(user, ownerLevel)) return true;
    } catch (_e) {
      // Continue with ownership fallback below.
    }
  }

  const ownerLevel = CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const ownership = document.ownership ?? document._source?.ownership ?? null;
  const level = Number(ownership?.[user.id] ?? ownership?.default ?? 0);

  return Number.isFinite(level) && level >= ownerLevel;
}

function canRequesterOperateAttackMessage(message, payload) {
  const requester = getRequesterUser(payload);
  if (!requester) return false;
  if (requester.isGM) return true;
  if (getMessageAuthorId(message) === requester.id) return true;

  const actor = getMessagePermissionActor(message);
  if (userOwnsDocument(requester, actor)) return true;

  const tokenDoc = getMessagePermissionToken(message);
  if (userOwnsDocument(requester, tokenDoc)) return true;
  if (userOwnsDocument(requester, tokenDoc?.actor)) return true;

  return false;
}

function canRequesterApplyMessage(message, payload) {
  const requester = getRequesterUser(payload);
  if (!requester) return false;

  if (requester.isGM) return true;
  if (!game.settings.get(MODULE_ID, SETTING_KEYS.ALLOW_PLAYERS_REQUEST_APPLY)) return false;

  return canRequesterOperateAttackMessage(message, payload);
}

function canRequesterBreakGuardMessage(message, payload) {
  return canRequesterOperateAttackMessage(message, payload);
}

function canRequesterDisarmMessage(message, payload) {
  return canRequesterOperateAttackMessage(message, payload);
}

function safeTokenKey(tokenUuid) {
  const raw = String(tokenUuid ?? "");
  return encodeURIComponent(raw).replaceAll(".", "%2E");
}

function parseSceneTokenFromUuid(tokenUuid) {
  const parts = String(tokenUuid ?? "").split(".");
  if (parts.length >= 4 && parts[0] === "Scene" && parts[2] === "Token") {
    return { sceneId: parts[1], tokenId: parts[3] };
  }
  return null;
}

function removeTokenKeyedEntry(map, tokenUuid) {
  if (!map || !tokenUuid) return;

  delete map[safeTokenKey(tokenUuid)];
  delete map[tokenUuid];

  const ids = parseSceneTokenFromUuid(tokenUuid);
  if (!ids) return;

  if (map.Scene?.[ids.sceneId]?.Token) {
    delete map.Scene[ids.sceneId].Token[ids.tokenId];
    if (!Object.keys(map.Scene[ids.sceneId].Token).length) delete map.Scene[ids.sceneId].Token;
    if (!Object.keys(map.Scene[ids.sceneId]).length) delete map.Scene[ids.sceneId];
    if (!Object.keys(map.Scene).length) delete map.Scene;
  }
}

function buildSyncedTargetsUpdate(flags, selectedTargets = []) {
  const next = foundry.utils.duplicate(flags ?? {});
  const previousTargets = Array.isArray(next.targets) ? next.targets : [];
  const hadStoredTargets = previousTargets.length > 0;

  next.hitLocation = next.hitLocation ?? {
    enabled: false,
    mode: "perTarget",
    seed: null,
    byTarget: {}
  };
  next.hitLocation.byTarget = next.hitLocation.byTarget ?? {};

  const existingSeed =
    next.hitLocation.seed ??
    Object.values(next.hitLocation.byTarget).find((entry) => entry?.key || entry?.label) ??
    null;

  next.hitLocation.seed = existingSeed ? foundry.utils.duplicate(existingSeed) : null;
  next.targets = hadStoredTargets ? [] : (Array.isArray(selectedTargets) ? selectedTargets : []);
  next.applied = {};

  next.hitLocation.byTarget = {};
  if (!hadStoredTargets && next.hitLocation.seed && next.targets.length) {
    for (const target of next.targets) {
      if (!target?.tokenUuid) continue;
      next.hitLocation.byTarget[safeTokenKey(target.tokenUuid)] =
        foundry.utils.duplicate(next.hitLocation.seed);
    }
  }

  next.spends = next.spends ?? {};
  next.spends.breakGuard = {};

  return next;
}

async function withMessage(payload, callback) {
  const message = game.messages?.get(payload.messageId);
  if (!message) return;
  if (!isAuthoritativeForMessage(message, payload.op)) return;

  if (
    [
      SOCKET_OPS.ROLL_DAMAGE,
      SOCKET_OPS.REROLL_DAMAGE,
      SOCKET_OPS.APPLY,
      SOCKET_OPS.UNDO,
      SOCKET_OPS.APPLY_ALL,
      SOCKET_OPS.SET_TARGETS,
      SOCKET_OPS.REMOVE_TARGET,
      SOCKET_OPS.DISARM
    ].includes(payload.op)
  ) {
    await ensureMessageFlags(message);
  }

  await callback(message);
}

async function withCombatant(payload, callback) {
  const combatant = await resolveCombatantFromUuid(payload.combatantUuid);
  if (!combatant) return;
  if (!isAuthoritativeForCombatant(combatant)) return;
  await callback(combatant);
}

const SOCKET_HANDLERS = {
  [SOCKET_OPS.ROLL_DAMAGE]: async (payload) =>
    withMessage(payload, (message) => {
      if (!canRequesterOperateAttackMessage(message, payload)) return;
      return execRollDamage(message);
    }),

  [SOCKET_OPS.REROLL_DAMAGE]: async (payload) =>
    withMessage(payload, (message) => {
      if (!canRequesterOperateAttackMessage(message, payload)) return;
      return execRerollDamage(message, payload.selectedIndices);
    }),

  [SOCKET_OPS.APPLY]: async (payload) =>
    withMessage(payload, (message) => {
      if (!canRequesterApplyMessage(message, payload)) return;
      return execApplyDamage(message, payload.targetTokenUuid);
    }),

  [SOCKET_OPS.UNDO]: async (payload) =>
    withMessage(payload, (message) => {
      if (!canRequesterUndoMessage(payload)) return;
      return execUndoDamage(message, payload.targetTokenUuid);
    }),

  [SOCKET_OPS.APPLY_ALL]: async (payload) =>
    withMessage(payload, (message) => {
      if (!canRequesterApplyMessage(message, payload)) return;
      return execApplyDamage(message, null, { applyAll: true });
    }),

  [SOCKET_OPS.SET_TARGETS]: async (payload) =>
    withMessage(payload, async (message) => {
      if (!canRequesterApplyMessage(message, payload)) return;

      const flags = message.flags?.[MODULE_ID];
      if (!flags) return;

      const next = buildSyncedTargetsUpdate(
        flags,
        Array.isArray(payload.targets) ? payload.targets : []
      );

      await message.update({ [`flags.${MODULE_ID}`]: next });
    }),

  [SOCKET_OPS.REMOVE_TARGET]: async (payload) =>
    withMessage(payload, async (message) => {
      if (!canRequesterApplyMessage(message, payload)) return;
      if (!payload.targetTokenUuid) return;

      const flags = message.flags?.[MODULE_ID];
      if (!flags) return;

      const next = foundry.utils.duplicate(flags);
      next.targets = (Array.isArray(next.targets) ? next.targets : [])
        .filter((target) => target?.tokenUuid !== payload.targetTokenUuid);

      next.applied = next.applied ?? {};
      next.hitLocation = next.hitLocation ?? { enabled: false, mode: "perTarget", byTarget: {} };
      next.hitLocation.byTarget = next.hitLocation.byTarget ?? {};

      removeTokenKeyedEntry(next.applied, payload.targetTokenUuid);
      removeTokenKeyedEntry(next.hitLocation.byTarget, payload.targetTokenUuid);

      await message.update({ [`flags.${MODULE_ID}`]: next });
    }),

  [SOCKET_OPS.BREAK_GUARD]: async (payload) =>
    withMessage(payload, (message) => {
      if (!canRequesterBreakGuardMessage(message, payload)) return;
      return execBreakGuard(message, payload.targetTokenUuid);
    }),

  [SOCKET_OPS.DISARM]: async (payload) =>
    withMessage(payload, (message) => {
      if (!canRequesterDisarmMessage(message, payload)) return;
      return execDisarm(message, payload.allocation ?? {});
    }),

  [SOCKET_OPS.UPSERT_COMBAT_STATE]: async (payload) =>
    withCombatant(payload, (combatant) => patchCombatState(combatant, payload.patch ?? {})),

  [SOCKET_OPS.CLEAR_COMBAT_STATE]: async (payload) =>
    withCombatant(payload, (combatant) =>
      clearCombatState(combatant, {
        mode: payload.mode ?? COMBAT_STATE_CLEAR_MODES.TRANSIENT
      })
    ),

  [SOCKET_OPS.PROMPT_REACTION]: async (payload) =>
    promptReactionFromSocket(payload),

  [SOCKET_OPS.BEGIN_REACTION]: async (payload) =>
    beginReaction(payload),

  [SOCKET_OPS.CANCEL_REACTION]: async (payload) =>
    cancelReaction(payload),

  [SOCKET_OPS.PROMPT_SACRIFICIAL]: async (payload) =>
    promptSacrificialItemFromSocket(payload),

  [SOCKET_OPS.RESOLVE_SACRIFICIAL]: async (payload) =>
    resolveSacrificialItemPrompt(payload)
};

export function registerSocket() {
  if (_socketRegistered) return;
  _socketRegistered = true;

  game.socket.on(SOCKET_NAME, async (payload) => {
    try {
      if (!payload?.op) return;

      const handler = SOCKET_HANDLERS[payload.op];
      if (!handler) return;

      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] socket op`, payload);
      }

      await handler(payload);
    } catch (e) {
      console.error(`[${MODULE_ID}] socket handler error`, e);
    }
  });
}

function emitSocket(op, payload = {}) {
  game.socket.emit(SOCKET_NAME, { op, ...payload });
}

export function requestRollDamage(messageId) {
  emitSocket(SOCKET_OPS.ROLL_DAMAGE, {
    messageId,
    requesterUserId: game.user?.id ?? null
  });
}

export function requestRerollDamage(messageId, selectedIndices) {
  emitSocket(SOCKET_OPS.REROLL_DAMAGE, {
    messageId,
    selectedIndices: Array.isArray(selectedIndices) ? selectedIndices : [],
    requesterUserId: game.user?.id ?? null
  });
}

export function requestApplyDamage(messageId, targetTokenUuid) {
  emitSocket(SOCKET_OPS.APPLY, {
    messageId,
    targetTokenUuid,
    requesterUserId: game.user?.id ?? null
  });
}

export function requestUndoDamage(messageId, targetTokenUuid) {
  emitSocket(SOCKET_OPS.UNDO, {
    messageId,
    targetTokenUuid,
    requesterUserId: game.user?.id ?? null
  });
}

export function requestApplyAll(messageId) {
  emitSocket(SOCKET_OPS.APPLY_ALL, {
    messageId,
    requesterUserId: game.user?.id ?? null
  });
}

export function requestSetTargets(messageId, targets) {
  emitSocket(SOCKET_OPS.SET_TARGETS, {
    messageId,
    targets,
    requesterUserId: game.user?.id ?? null
  });
}

export function requestRemoveTarget(messageId, targetTokenUuid) {
  emitSocket(SOCKET_OPS.REMOVE_TARGET, {
    messageId,
    targetTokenUuid,
    requesterUserId: game.user?.id ?? null
  });
}

export function requestBreakGuard(messageId, targetTokenUuid) {
  emitSocket(SOCKET_OPS.BREAK_GUARD, {
    messageId,
    targetTokenUuid,
    requesterUserId: game.user?.id ?? null
  });
}

export function requestDisarm(messageId, allocation) {
  emitSocket(SOCKET_OPS.DISARM, {
    messageId,
    allocation: foundry.utils.duplicate(allocation ?? {}),
    requesterUserId: game.user?.id ?? null
  });
}

export function requestUpsertCombatState(combatantUuid, patch) {
  emitSocket(SOCKET_OPS.UPSERT_COMBAT_STATE, { combatantUuid, patch });
}

export function requestClearCombatState(
  combatantUuid,
  mode = COMBAT_STATE_CLEAR_MODES.TRANSIENT
) {
  emitSocket(SOCKET_OPS.CLEAR_COMBAT_STATE, { combatantUuid, mode });
}