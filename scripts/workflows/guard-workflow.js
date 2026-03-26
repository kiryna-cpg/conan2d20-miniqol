import { MODULE_ID } from "../constants.js";

/**
 * Ensure the Conan system "guardBroken" status is active on a target actor.
 * Uses the system-defined status effect instead of creating a module-specific effect.
 */
function safeTokenKey(tokenUuid) {
  const raw = String(tokenUuid ?? "");
  return encodeURIComponent(raw).replaceAll(".", "%2E");
}

async function resolveTokenDoc(tokenUuid) {
  try {
    return await fromUuid(tokenUuid);
  } catch (_e) {
    return null;
  }
}

function hasGuardBrokenEffect(actor) {
  return actor?.effects?.some((e) => {
    const statuses = e?.statuses ?? e?._source?.statuses;
    if (!statuses) return false;
    if (statuses instanceof Set) return statuses.has("guardBroken");
    if (Array.isArray(statuses)) return statuses.includes("guardBroken");
    return false;
  }) === true;
}

async function ensureGuardBroken(actor) {
  if (!actor) return false;
  if (hasGuardBrokenEffect(actor)) return true;

  await actor.toggleStatusEffect("guardBroken", { active: true });
  return hasGuardBrokenEffect(actor);
}

export async function execBreakGuard(message, targetTokenUuid) {
  if (!message || !targetTokenUuid) return;

  const flags = message.flags?.[MODULE_ID];
  if (!flags) return;

  const tokenDoc = await resolveTokenDoc(targetTokenUuid);
  const actor = tokenDoc?.actor ?? null;
  if (!actor) return;

  const key = safeTokenKey(targetTokenUuid);

  const next = foundry.utils.duplicate(flags);
  next.spends = next.spends ?? {};
  next.spends.breakGuard = next.spends.breakGuard ?? {};

  // Idempotent per target per message.
  if (next.spends.breakGuard[key]?.applied) return;

  const applied = await ensureGuardBroken(actor);

  next.spends.breakGuard[key] = {
    applied,
    appliedAt: Date.now(),
    appliedBy: game.user?.id ?? null,
    tokenUuid: targetTokenUuid,
    actorUuid: actor.uuid,
    spent: 2
  };

  await message.update({ [`flags.${MODULE_ID}`]: next });
  try {
    ui.chat?.render?.(true);
  } catch (_e) {
    // Ignore chat re-render failures.
  }
}