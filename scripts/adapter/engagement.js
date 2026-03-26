import { HOOK_NAMES } from "../constants.js";
import { computeActorReach } from "./conan2d20.js";

function getActorToken(actor, explicitToken = null) {
  if (explicitToken) return explicitToken;
  return actor?.token ?? actor?.getActiveTokens?.()?.[0] ?? null;
}

function getTokenSceneId(tokenDoc) {
  return tokenDoc?.parent?.id ?? tokenDoc?.scene?.id ?? null;
}

function getTokenCenter(tokenDoc) {
  const objectCenter = tokenDoc?.object?.center;
  if (objectCenter?.x != null && objectCenter?.y != null) return objectCenter;

  const grid = canvas?.grid;
  if (!grid) return null;

  const sizeX = Number(grid.sizeX ?? grid.size ?? 0) || 0;
  const sizeY = Number(grid.sizeY ?? grid.size ?? 0) || 0;
  const width = Number(tokenDoc?.width ?? 1) || 1;
  const height = Number(tokenDoc?.height ?? 1) || 1;
  const x = Number(tokenDoc?.x ?? NaN);
  const y = Number(tokenDoc?.y ?? NaN);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !sizeX || !sizeY) return null;

  return {
    x: x + (width * sizeX) / 2,
    y: y + (height * sizeY) / 2
  };
}

function measureTokenDistance(tokenDoc, targetTokenDoc) {
  const grid = canvas?.grid;
  if (!grid?.measurePath) return null;

  const a = getTokenCenter(tokenDoc);
  const b = getTokenCenter(targetTokenDoc);
  if (!a || !b) return null;

  try {
    const result = grid.measurePath([a, b]);
    const distance = Number(result?.distance ?? result?.cost ?? result?.totalDistance ?? NaN);
    return Number.isFinite(distance) ? distance : null;
  } catch (_e) {
    return null;
  }
}

function resolveLocalWithinReach(payload) {
  const tokenDoc = payload.token;
  const targetTokenDoc = payload.targetToken;

  if (!tokenDoc || !targetTokenDoc) {
    payload.reason = "missing-token";
    return payload;
  }

  const sceneA = getTokenSceneId(tokenDoc);
  const sceneB = getTokenSceneId(targetTokenDoc);
  if (!sceneA || !sceneB || sceneA !== sceneB) {
    payload.reason = "different-scene";
    return payload;
  }

  const distance = measureTokenDistance(tokenDoc, targetTokenDoc);
  if (distance == null) {
    payload.reason = "unmeasurable";
    return payload;
  }

  const sceneDistance =
    Number(canvas?.scene?.grid?.distance ?? canvas?.dimensions?.distance ?? 0) || 0;

  const actorReach = Math.max(0, Number(payload.actorReach ?? 0) || 0);
  const targetReach = Math.max(0, Number(payload.targetReach ?? 0) || 0);

  // Protect needs the friendly actor to be in melee reach of the ally.
  // Use the larger of the two reach values as the local interaction band.
  const reachBands = Math.max(actorReach, targetReach);

  payload.resolved = true;
  payload.provider = "local-grid";
  payload.distance = distance;
  payload.reachBands = reachBands;

  if (!sceneDistance || reachBands <= 0) {
    payload.withinReach = false;
    payload.reason = "no-reach";
    return payload;
  }

  payload.withinReach = distance <= (reachBands * sceneDistance);
  payload.reason = payload.withinReach ? null : "out-of-reach";
  return payload;
}

export function resolveWithinReach({
  actor = null,
  targetActor = null,
  token = null,
  targetToken = null,
  purpose = null
} = {}) {
  const payload = {
    actor,
    targetActor,
    token: getActorToken(actor, token),
    targetToken: getActorToken(targetActor, targetToken),
    purpose,
    actorReach: computeActorReach(actor),
    targetReach: computeActorReach(targetActor),
    resolved: false,
    withinReach: null,
    provider: null,
    reason: null
  };

  if (!actor || !targetActor) {
    payload.reason = "missing-actor";
    return payload;
  }

  if (actor.id === targetActor.id) {
    payload.resolved = true;
    payload.withinReach = false;
    payload.provider = "self";
    return payload;
  }

  // Allow external providers to override the local answer.
  Hooks.callAll(HOOK_NAMES.RESOLVE_WITHIN_REACH, payload);

  if (payload.resolved === true && typeof payload.withinReach === "boolean") {
    return payload;
  }

  return resolveLocalWithinReach(payload);
}

export function isWithinReachKnown(result) {
  return result?.resolved === true && typeof result?.withinReach === "boolean";
}