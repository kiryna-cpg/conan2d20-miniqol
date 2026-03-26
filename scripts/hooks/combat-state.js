import {
  MODULE_ID,
  SETTING_KEYS,
  COMBAT_STATE_CLEAR_MODES
} from "../constants.js";
import {
  clearCombatState,
  clearTransientCombatState,
  resetReactionCount
} from "../state/combat-state-store.js";

let _combatStateHooksRegistered = false;

function debugEnabled() {
  try {
    return !!game.settings.get(MODULE_ID, SETTING_KEYS.DEBUG);
  } catch (_e) {
    return false;
  }
}

async function clearTransientForCombat(combat) {
  if (!combat?.combatants?.size) return;

  for (const combatant of combat.combatants) {
    await clearTransientCombatState(combatant);
  }
}

async function clearAllForCombat(combat) {
  if (!combat?.combatants?.size) return;

  for (const combatant of combat.combatants) {
    await clearCombatState(combatant, { mode: COMBAT_STATE_CLEAR_MODES.ALL });
  }
}

function getActiveCombatant(combat) {
  if (!combat) return null;
  return combat.turns?.[combat.turn] ?? combat.combatant ?? null;
}

export function registerCombatStateHooks() {
  if (_combatStateHooksRegistered) return;
  _combatStateHooksRegistered = true;

  Hooks.on("updateCombat", async (combat, changed) => {
    try {
      if (!game.user?.isGM) return;

      const roundChanged = Object.hasOwn(changed ?? {}, "round");
      const turnChanged = Object.hasOwn(changed ?? {}, "turn");
      if (!roundChanged && !turnChanged) return;

      await clearTransientForCombat(combat);

      if (roundChanged && combat?.combatants?.size) {
        for (const combatant of combat.combatants) {
          await resetReactionCount(combatant);
        }
      }

      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] cleared transient combat state`, {
          combatId: combat.id,
          round: combat.round,
          turn: combat.turn,
          roundChanged,
          turnChanged,
          resetReactionCounts: roundChanged
        });
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] updateCombat cleanup error`, e);
    }
  });

  Hooks.on("deleteCombat", (combat) => {
    try {
      if (!game.user?.isGM) return;

      if (debugEnabled()) {
        console.debug(`[${MODULE_ID}] combat deleted; combatant-scoped state removed with combat`, {
          combatId: combat?.id ?? null
        });
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] deleteCombat hook error`, e);
    }
  });
}