import { ROLL_INTENT_TTL_MS } from "../constants.js";

const _pendingRollIntents = [];

function now() {
  return Date.now();
}

function normalizeIntent(intent = {}) {
  return {
    id: foundry.utils.randomID(),
    createdAt: now(),
    actorId: intent.actorId ?? null,
    itemId: intent.itemId ?? null,
    skillKey: intent.skillKey ?? null,
    userId: intent.userId ?? game.user?.id ?? null,
    type: intent.type ?? "skill-roll",
    metadata: foundry.utils.deepClone(intent.metadata ?? {})
  };
}

function isExpired(intent) {
  return (now() - Number(intent?.createdAt ?? 0)) > ROLL_INTENT_TTL_MS;
}

export function pruneExpiredPendingRollIntents() {
  for (let i = _pendingRollIntents.length - 1; i >= 0; i -= 1) {
    if (isExpired(_pendingRollIntents[i])) _pendingRollIntents.splice(i, 1);
  }
}

export function queuePendingRollIntent(intent) {
  const normalized = normalizeIntent(intent);
  pruneExpiredPendingRollIntents();
  _pendingRollIntents.push(normalized);
  return normalized;
}

export function consumeMatchingPendingRollIntent({
  actorId = null,
  itemId = null,
  skillKey = null,
  userId = null
} = {}) {
  pruneExpiredPendingRollIntents();

  const uid = userId ?? game.user?.id ?? null;

  for (let i = _pendingRollIntents.length - 1; i >= 0; i -= 1) {
    const intent = _pendingRollIntents[i];
    if (actorId && intent.actorId !== actorId) continue;
    if (uid && intent.userId && intent.userId !== uid) continue;
    if (itemId && intent.itemId && intent.itemId !== itemId) continue;
    if (skillKey && intent.skillKey && intent.skillKey !== skillKey) continue;

    _pendingRollIntents.splice(i, 1);
    return intent;
  }

  return null;
}