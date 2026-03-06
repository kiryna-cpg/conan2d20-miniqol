import { SOCKET_NAME, MODULE_ID, SETTING_KEYS } from "./constants.js";
import { execRollDamage, execApplyDamage, execUndoDamage } from "./workflows/damage-workflow.js";

let _socketRegistered = false;

function debugEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.DEBUG);
}

function hasActiveGM() {
  return game.users?.some(u => u.active && u.isGM);
}

function isAuthoritativeFor(message) {
  if (game.user?.isGM) return true;
  if (hasActiveGM()) return false;
  return message?.author?.id === game.user?.id;
}

function isDamageCapableMessage(message) {
  const dice = Number(message?.flags?.data?.item?.system?.damage?.dice ?? 0);
  return Number.isFinite(dice) && dice > 0;
}

function buildPayloadFromMessage(message) {
  const data = message.flags?.data ?? {};
  const actorId = data?.actor?._id ?? data?.rollData?.actorId ?? null;
  const actorUuid = actorId ? `Actor.${actorId}` : null;

  const sceneId = message?.speaker?.scene ?? null;
  const tokenId = message?.speaker?.token ?? null;
  const attackerTokenUuid = tokenId && sceneId ? `Scene.${sceneId}.Token.${tokenId}` : null;

  const itemId = data?.rollData?.item?._id ?? data?.item?._id ?? null;
  const itemUuid = (actorUuid && itemId) ? `${actorUuid}.Item.${itemId}` : null;

  const dmgDice = Number(data?.item?.system?.damage?.dice ?? 0);
  const dmgType = String(data?.item?.system?.damage?.type ?? "physical");

  return {
    schema: 1,
    context: {
      attackerActorUuid: actorUuid,
      attackerTokenUuid,
      itemUuid,
      itemId,
      itemName: data?.item?.name ?? null
    },
    targets: [], // targets can be set via SET_TARGETS / Use current targets
    damage: {
      rolled: false,
      total: null,
      dice: null,
      static: 0,
      effects: 0,
      faces: [],
      type: dmgType
    },
    hitLocation: {
      enabled: !!game.settings.get(MODULE_ID, SETTING_KEYS.HIT_LOCATION_ENABLED),
      mode: "perTarget",
      byTarget: {}
    },
    applied: {}
  };
}

async function ensureMinQolFlags(message) {
  if (message?.flags?.[MODULE_ID]) return true;
  if (!isDamageCapableMessage(message)) return false;

  const payload = buildPayloadFromMessage(message);
  await message.update({ [`flags.${MODULE_ID}`]: payload });
  return true;
}

export function registerSocket() {
  if (_socketRegistered) return;
  _socketRegistered = true;

  game.socket.on(SOCKET_NAME, async (payload) => {
    try {
      if (!payload?.op) return;

      const message = game.messages?.get(payload.messageId);
      if (!message) return;

      if (!isAuthoritativeFor(message)) return;

      // Ensure flags exist for operations that depend on them.
      if (["ROLL_DAMAGE", "APPLY", "UNDO", "APPLY_ALL", "SET_TARGETS"].includes(payload.op)) {
        await ensureMinQolFlags(message);
      }

      if (debugEnabled()) console.debug(`[${MODULE_ID}] socket op`, payload);

      switch (payload.op) {
        case "ROLL_DAMAGE":
          await execRollDamage(message);
          break;

        case "APPLY":
          await execApplyDamage(message, payload.targetTokenUuid);
          break;

        case "UNDO":
          await execUndoDamage(message, payload.targetTokenUuid);
          break;

        case "APPLY_ALL":
          await execApplyDamage(message, null, { applyAll: true });
          break;

        case "SET_TARGETS": {
          const flags = message.flags?.[MODULE_ID];
          if (!flags) break;
          const next = foundry.utils.duplicate(flags);
          next.targets = Array.isArray(payload.targets) ? payload.targets : [];
          next.applied = {}; // if targets changed, reset applied state
          await message.update({ [`flags.${MODULE_ID}`]: next });
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] socket handler error`, e);
    }
  });
}

export function requestRollDamage(messageId) {
  game.socket.emit(SOCKET_NAME, { op: "ROLL_DAMAGE", messageId });
}

export function requestApplyDamage(messageId, targetTokenUuid) {
  game.socket.emit(SOCKET_NAME, { op: "APPLY", messageId, targetTokenUuid });
}

export function requestUndoDamage(messageId, targetTokenUuid) {
  game.socket.emit(SOCKET_NAME, { op: "UNDO", messageId, targetTokenUuid });
}

export function requestApplyAll(messageId) {
  game.socket.emit(SOCKET_NAME, { op: "APPLY_ALL", messageId });
}

export function requestSetTargets(messageId, targets) {
  game.socket.emit(SOCKET_NAME, { op: "SET_TARGETS", messageId, targets });
}