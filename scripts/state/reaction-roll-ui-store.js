const STORE_TTL_MS = 15000;

const _entries = [];

function now() {
  return Date.now();
}

function isExpired(entry) {
  return (now() - Number(entry?.createdAt ?? 0)) > STORE_TTL_MS;
}

function prune() {
  for (let i = _entries.length - 1; i >= 0; i -= 1) {
    if (isExpired(_entries[i])) _entries.splice(i, 1);
  }
}

export function markReactionRollUiFusion({
  userId = null,
  reactionKind = null
} = {}) {
  prune();

  const entry = {
    id: foundry.utils.randomID(),
    createdAt: now(),
    userId: userId ?? game.user?.id ?? null,
    reactionKind,
    suppressSystemDoomCard: true
  };

  _entries.push(entry);
  return entry;
}

export function consumeReactionRollUiFusionForUser(userId = null) {
  prune();

  const uid = userId ?? game.user?.id ?? null;
  if (!uid) return null;

  for (let i = _entries.length - 1; i >= 0; i -= 1) {
    const entry = _entries[i];
    if (entry.userId !== uid) continue;

    _entries.splice(i, 1);
    return entry;
  }

  return null;
}