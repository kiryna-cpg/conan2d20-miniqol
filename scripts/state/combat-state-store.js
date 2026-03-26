import {
  MODULE_ID,
  FLAG_KEYS,
  COMBAT_STATE_SCHEMA,
  COMBAT_STATE_DEFAULTS,
  COMBAT_STATE_CLEAR_MODES
} from "../constants.js";

function duplicate(value) {
  return foundry.utils.deepClone(value);
}

function getStoredCombatStateRaw(combatant) {
  return combatant?.getFlag(MODULE_ID, FLAG_KEYS.COMBAT_STATE) ?? null;
}

export function createEmptyCombatState(combatant) {
  return {
    schema: COMBAT_STATE_SCHEMA,
    combatId: combatant?.combat?.id ?? game.combat?.id ?? null,
    round: Number(combatant?.combat?.round ?? game.combat?.round ?? 0) || 0,
    turn: Number(combatant?.combat?.turn ?? game.combat?.turn ?? 0) || 0,
    assists: duplicate(COMBAT_STATE_DEFAULTS.assists),
    exploits: duplicate(COMBAT_STATE_DEFAULTS.exploits),
    brace: duplicate(COMBAT_STATE_DEFAULTS.brace),
    ready: duplicate(COMBAT_STATE_DEFAULTS.ready),
    reactions: duplicate(COMBAT_STATE_DEFAULTS.reactions),
    transient: duplicate(COMBAT_STATE_DEFAULTS.transient)
  };
}

export function normalizeCombatState(combatant, state) {
  const base = createEmptyCombatState(combatant);
  const merged = foundry.utils.mergeObject(base, duplicate(state ?? {}), {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true
  });

  merged.schema = COMBAT_STATE_SCHEMA;
  merged.combatId = combatant?.combat?.id ?? merged.combatId ?? null;
  merged.round = Number(combatant?.combat?.round ?? merged.round ?? 0) || 0;
  merged.turn = Number(combatant?.combat?.turn ?? merged.turn ?? 0) || 0;

  merged.reactions = foundry.utils.mergeObject(
    duplicate(COMBAT_STATE_DEFAULTS.reactions),
    duplicate(merged.reactions ?? {}),
    { inplace: false, insertKeys: true, insertValues: true, overwrite: true }
  );

  return merged;
}

export function getCombatState(combatant) {
  return normalizeCombatState(combatant, getStoredCombatStateRaw(combatant));
}

export async function setCombatState(combatant, nextState) {
  if (!combatant) return null;
  const normalized = normalizeCombatState(combatant, nextState);
  await combatant.setFlag(MODULE_ID, FLAG_KEYS.COMBAT_STATE, normalized);
  return normalized;
}

export async function patchCombatState(combatant, patch) {
  if (!combatant) return null;
  const current = getCombatState(combatant);
  const next = foundry.utils.mergeObject(current, duplicate(patch ?? {}), {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true
  });
  return setCombatState(combatant, next);
}

export async function updateCombatState(combatant, updater) {
  if (!combatant || typeof updater !== "function") return null;

  const current = getCombatState(combatant);
  const draft = duplicate(current);
  const result = await updater(draft, current);
  const next = result == null ? draft : result;

  return setCombatState(combatant, next);
}

export async function clearCombatState(combatant, { mode = COMBAT_STATE_CLEAR_MODES.ALL } = {}) {
  if (!combatant) return null;

  if (mode === COMBAT_STATE_CLEAR_MODES.ALL) {
    await combatant.unsetFlag(MODULE_ID, FLAG_KEYS.COMBAT_STATE);
    return null;
  }

  const currentRaw = getStoredCombatStateRaw(combatant);
  if (currentRaw == null) return null;

  const current = normalizeCombatState(combatant, currentRaw);
  current.transient = duplicate(COMBAT_STATE_DEFAULTS.transient);
  current.reactions.pending = [];
  current.reactions.windows = [];

  return setCombatState(combatant, current);
}

export async function clearTransientCombatState(combatant) {
  return clearCombatState(combatant, { mode: COMBAT_STATE_CLEAR_MODES.TRANSIENT });
}

export async function resolveCombatantFromUuid(combatantUuid) {
  if (!combatantUuid) return null;

  try {
    const doc = await fromUuid(combatantUuid);
    return doc?.documentName === "Combatant" ? doc : null;
  } catch (_e) {
    return null;
  }
}

export function findCombatantForActor(actor, combat = game.combat) {
  if (!actor || !combat?.combatants?.size) return null;
  return combat.combatants.find((combatant) => combatant.actor?.id === actor.id) ?? null;
}

export function getNextReactionCost(combatant) {
  const state = getCombatState(combatant);
  return Math.max(1, Number(state?.reactions?.count ?? 0) + 1);
}

export async function resetReactionCount(combatant) {
  if (!combatant) return null;

  return updateCombatState(combatant, (draft) => {
    draft.reactions.count = 0;
    draft.reactions.lastResetRound = combatant?.combat?.round ?? game.combat?.round ?? 0;
    draft.reactions.lastResetCombatantId = combatant.id;
    draft.reactions.pending = [];
    draft.reactions.windows = [];
    return draft;
  });
}

export async function incrementReactionCount(combatant, payload = {}) {
  if (!combatant) return null;

  return updateCombatState(combatant, (draft) => {
    draft.reactions.count = Math.max(0, Number(draft.reactions.count ?? 0)) + 1;
    draft.reactions.history = Array.isArray(draft.reactions.history) ? draft.reactions.history : [];
    draft.reactions.history.push({
      id: foundry.utils.randomID(),
      kind: payload.kind ?? null,
      cost: Number(payload.cost ?? 0) || 0,
      createdAt: Date.now(),
      round: combatant?.combat?.round ?? game.combat?.round ?? 0,
      attackMessageId: payload.attackMessageId ?? null,
      defenseMessageId: payload.defenseMessageId ?? null,
      outcome: payload.outcome ?? null
    });
    return draft;
  });
}

export async function pushPendingReaction(combatant, pending) {
  if (!combatant || !pending) return null;

  return updateCombatState(combatant, (draft) => {
    draft.reactions.pending = Array.isArray(draft.reactions.pending) ? draft.reactions.pending : [];
    draft.reactions.pending.push(duplicate(pending));
    return draft;
  });
}

export function findPendingReaction(combatant, matcher) {
  const state = getCombatState(combatant);
  const pending = Array.isArray(state?.reactions?.pending) ? state.reactions.pending : [];
  if (typeof matcher !== "function") return pending[0] ?? null;
  return pending.find(matcher) ?? null;
}

export async function consumePendingReaction(combatant, matcher) {
  if (!combatant) return null;

  let removed = null;

  await updateCombatState(combatant, (draft) => {
    const pending = Array.isArray(draft.reactions.pending) ? draft.reactions.pending : [];
    const index = typeof matcher === "function"
      ? pending.findIndex(matcher)
      : 0;

    if (index >= 0) {
      removed = duplicate(pending[index]);
      pending.splice(index, 1);
    }

    draft.reactions.pending = pending;
    return draft;
  });

  return removed;
}