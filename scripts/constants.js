export const MODULE_ID = "conan2d20-miniqol";
export const SOCKET_NAME = `module.${MODULE_ID}`;

export const SETTING_KEYS = {
  AUTO_ROLL_DAMAGE: "autoRollDamage",
  AUTO_APPLY_DAMAGE: "autoApplyDamage",
  AUTO_REACH_DIFFICULTY: "autoReachDifficulty",
  HIT_LOCATION_ENABLED: "hitLocationEnabled",
  SACRIFICIAL_ARMOR_ENABLED: "sacrificialArmorEnabled",
  ALLOW_PLAYERS_REQUEST_APPLY: "allowPlayersRequestApply",
  SHOW_APPLY_ALL: "showApplyAll",
  DEBUG: "debug"
};

export const TEMPLATE_PATHS = [
  `modules/${MODULE_ID}/templates/chat/miniqol-controls.hbs`
];