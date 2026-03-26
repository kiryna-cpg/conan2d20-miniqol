export const MODULE_ID = "conan2d20-miniqol";
export const SOCKET_NAME = `module.${MODULE_ID}`;

export const FLAG_KEYS = {
  MESSAGE_ROOT: MODULE_ID,
  COMBAT_STATE: "combatState",
  USER_TARGET_SNAPSHOT: "userTargetSnapshot"
};

export const SOCKET_OPS = {
  ROLL_DAMAGE: "ROLL_DAMAGE",
  APPLY: "APPLY",
  UNDO: "UNDO",
  APPLY_ALL: "APPLY_ALL",
  SET_TARGETS: "SET_TARGETS",
  REMOVE_TARGET: "REMOVE_TARGET",
  BREAK_GUARD: "BREAK_GUARD",
  UPSERT_COMBAT_STATE: "UPSERT_COMBAT_STATE",
  CLEAR_COMBAT_STATE: "CLEAR_COMBAT_STATE",
  PROMPT_REACTION: "PROMPT_REACTION",
  BEGIN_REACTION: "BEGIN_REACTION",
  CANCEL_REACTION: "CANCEL_REACTION",
  // Legacy aliases kept so the current Defend pipeline keeps working
  // while the reaction engine is generalized.
  PROMPT_DEFEND: "PROMPT_REACTION",
  BEGIN_DEFEND: "BEGIN_REACTION",
  CANCEL_DEFEND: "CANCEL_REACTION",
  PROMPT_SACRIFICIAL: "PROMPT_SACRIFICIAL",
  RESOLVE_SACRIFICIAL: "RESOLVE_SACRIFICIAL"
};

export const COMBAT_STATE_SCHEMA = 1;

export const ATTACK_TYPES = {
  MELEE: "melee",
  RANGED: "ranged",
  THREATEN: "threaten"
};

export const REACTION_KINDS = {
  DEFEND: "defend",
  PROTECT: "protect",
  RETALIATE: "retaliate"
};

export const REACTION_PHASES = {
  NONE: "none",
  PROMPTED: "prompted",
  ROLLING: "rolling",
  DECLINED: "declined",
  RESOLVED: "resolved"
};

export const REACTION_OUTCOMES = {
  HIT: "hit",
  MISS: "miss",
  DECLINED: "declined"
};

export const COMBAT_STATE_DEFAULTS = {
  assists: [],
  exploits: [],
  brace: [],
  ready: [],
  reactions: {
    windows: [],
    history: [],
    pending: [],
    count: 0,
    lastResetRound: null,
    lastResetCombatantId: null
  },
  transient: {
    pendingLaunches: [],
    prompts: [],
    locks: {}
  }
};

export const COMBAT_STATE_CLEAR_MODES = {
  TRANSIENT: "transient",
  ALL: "all"
};

export const SETTING_KEYS = {
  AUTO_ROLL_DAMAGE: "autoRollDamage",
  AUTO_APPLY_DAMAGE: "autoApplyDamage",
  AUTO_REACH_DIFFICULTY: "autoReachDifficulty",
  PROMPT_BREAK_GUARD: "promptBreakGuard",
  HIT_LOCATION_ENABLED: "hitLocationEnabled",
  SACRIFICIAL_ARMOR_ENABLED: "sacrificialArmorEnabled",
  AUTO_PROTECT_REACTION: "autoProtectReaction",
  ALLOW_PLAYERS_REQUEST_APPLY: "allowPlayersRequestApply",
  SHOW_APPLY_ALL: "showApplyAll",
  DEBUG: "debug",
  SACRIFICIAL_WEAPONS_ENABLED: "sacrificialWeaponsEnabled"
};
export const HOOK_NAMES = {
  SKILL_ROLLER_CONTEXT: `${MODULE_ID}:skillRollerContext`,
  RESOLVE_WITHIN_REACH: `${MODULE_ID}:resolveWithinReach`
};

export const ROLL_INTENT_TTL_MS = 15000;
export const TARGET_SNAPSHOT_DEBOUNCE_MS = 50;

export const TEMPLATE_PATHS = [
  `modules/${MODULE_ID}/templates/chat/miniqol-controls.hbs`
];