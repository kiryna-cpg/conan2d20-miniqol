import { MODULE_ID, FLAG_KEYS, TARGET_SNAPSHOT_DEBOUNCE_MS } from "../constants.js";

function normalizeTargetEntry(token) {
  if (!token?.document) return null;

  return {
    tokenUuid: token.document.uuid,
    actorUuid: token.actor?.uuid ?? null,
    name: token.name ?? token.actor?.name ?? token.document.name ?? ""
  };
}

function sortTargets(targets) {
  return [...targets].sort((a, b) => String(a.tokenUuid).localeCompare(String(b.tokenUuid)));
}

function sameTargets(a = [], b = []) {
  if (a.length !== b.length) return false;

  const aa = sortTargets(a);
  const bb = sortTargets(b);

  for (let i = 0; i < aa.length; i += 1) {
    if (aa[i].tokenUuid !== bb[i].tokenUuid) return false;
    if ((aa[i].actorUuid ?? null) !== (bb[i].actorUuid ?? null)) return false;
    if ((aa[i].name ?? "") !== (bb[i].name ?? "")) return false;
  }

  return true;
}

export function collectCurrentUserTargets() {
  return Array.from(game.user?.targets ?? [])
    .map(normalizeTargetEntry)
    .filter(Boolean);
}

export function buildCurrentUserTargetSnapshot() {
  return {
    sceneId: canvas?.scene?.id ?? null,
    updatedAt: Date.now(),
    targets: collectCurrentUserTargets()
  };
}

export function getUserTargetSnapshot(user) {
  return user?.getFlag(MODULE_ID, FLAG_KEYS.USER_TARGET_SNAPSHOT) ?? null;
}

export function getTargetsFromSnapshot(snapshot, { sceneId = null } = {}) {
  if (!snapshot || typeof snapshot !== "object") return [];
  if (sceneId && snapshot.sceneId && snapshot.sceneId !== sceneId) return [];

  return Array.isArray(snapshot.targets)
    ? snapshot.targets.map((t) => ({
        tokenUuid: t.tokenUuid,
        actorUuid: t.actorUuid ?? null,
        name: t.name ?? ""
      }))
    : [];
}

export function getStoredTargetsForUser(user, { sceneId = null } = {}) {
  const snapshot = getUserTargetSnapshot(user);
  return getTargetsFromSnapshot(snapshot, { sceneId });
}

export async function syncCurrentUserTargetSnapshot({ force = false } = {}) {
  const user = game.user;
  if (!user) return null;

  const next = buildCurrentUserTargetSnapshot();
  const current = getUserTargetSnapshot(user);

  if (!force && current?.sceneId === next.sceneId && sameTargets(current?.targets ?? [], next.targets)) {
    return current;
  }

  await user.setFlag(MODULE_ID, FLAG_KEYS.USER_TARGET_SNAPSHOT, next);
  return next;
}

let _targetSyncTimer = null;

export function scheduleCurrentUserTargetSnapshotSync({ force = false } = {}) {
  if (_targetSyncTimer) clearTimeout(_targetSyncTimer);

  _targetSyncTimer = setTimeout(() => {
    _targetSyncTimer = null;
    syncCurrentUserTargetSnapshot({ force }).catch((e) => {
      console.error(`[${MODULE_ID}] target snapshot sync error`, e);
    });
  }, TARGET_SNAPSHOT_DEBOUNCE_MS);
}