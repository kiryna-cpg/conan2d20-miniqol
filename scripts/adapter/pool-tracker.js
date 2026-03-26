import { MODULE_ID } from "../constants.js";

const SYSTEM_ID = "conan2d20";

function getTrackerApi() {
  return globalThis.conan?.apps?.MomentumTrackerV2 ?? null;
}

function isSupportedKind(kind) {
  return kind === "doom" || kind === "momentum";
}

function readSetting(kind) {
  try {
    const value = game.settings.get(SYSTEM_ID, kind);
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  } catch (_e) {
    return null;
  }
}

export function getPoolValue(kind) {
  if (!isSupportedKind(kind)) return null;
  return readSetting(kind);
}

export async function setPoolValue(kind, value) {
  if (!isSupportedKind(kind)) return false;

  const api = getTrackerApi();
  const next = Math.max(0, Number(value ?? 0) || 0);

  if (api?.setCounter) {
    await api.setCounter(next, kind);
    return true;
  }

  if (game.user?.isGM === true) {
    await game.settings.set(SYSTEM_ID, kind, next);
    return true;
  }

  return false;
}

export async function adjustPoolValue(kind, delta) {
  if (!isSupportedKind(kind)) return false;

  const signed = Number(delta ?? 0) || 0;
  if (!signed) return true;

  const api = getTrackerApi();
  if (api?.changeCounter) {
    await api.changeCounter(signed, kind);
    return true;
  }

  const current = getPoolValue(kind);
  if (current == null) return false;

  return await setPoolValue(kind, current + signed);
}

export async function addDoom(amount) {
  return await adjustPoolValue("doom", Number(amount ?? 0) || 0);
}

export async function spendMomentum(amount) {
  return await adjustPoolValue("momentum", -Math.max(0, Number(amount ?? 0) || 0));
}

export function debugPoolTracker() {
  console.debug(`[${MODULE_ID}] pool tracker`, {
    doom: getPoolValue("doom"),
    momentum: getPoolValue("momentum"),
    hasTrackerApi: !!getTrackerApi()
  });
}