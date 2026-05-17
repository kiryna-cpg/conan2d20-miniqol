import { MODULE_ID, SETTING_KEYS, HOOK_NAMES } from "./constants.js";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_KEYS.AUTO_ROLL_DAMAGE, {
    name: game.i18n.localize("C2MQ.Setting.AutoRollDamage.Name"),
    hint: game.i18n.localize("C2MQ.Setting.AutoRollDamage.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.AUTO_APPLY_DAMAGE, {
    name: game.i18n.localize("C2MQ.Setting.AutoApplyDamage.Name"),
    hint: game.i18n.localize("C2MQ.Setting.AutoApplyDamage.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.PROMPT_BREAK_GUARD, {
    name: game.i18n.localize("C2MQ.Setting.PromptBreakGuard.Name"),
    hint: game.i18n.localize("C2MQ.Setting.PromptBreakGuard.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.AUTO_REACH_DIFFICULTY, {
    name: game.i18n.localize("C2MQ.Setting.AutoReachDifficulty.Name"),
    hint: game.i18n.localize("C2MQ.Setting.AutoReachDifficulty.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.REACH_STATUS_ENABLED, {
    name: game.i18n.localize("C2MQ.Setting.ReachStatusEnabled.Name"),
    hint: game.i18n.localize("C2MQ.Setting.ReachStatusEnabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll(HOOK_NAMES.REACH_STATUS_SETTING_CHANGED)
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.SHOW_REACH_1_STATUS, {
    name: game.i18n.localize("C2MQ.Setting.ShowReach1Status.Name"),
    hint: game.i18n.localize("C2MQ.Setting.ShowReach1Status.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => Hooks.callAll(HOOK_NAMES.REACH_STATUS_SETTING_CHANGED)
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.HIT_LOCATION_ENABLED, {
    name: game.i18n.localize("C2MQ.Setting.HitLocationEnabled.Name"),
    hint: game.i18n.localize("C2MQ.Setting.HitLocationEnabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.SACRIFICIAL_ARMOR_ENABLED, {
    name: game.i18n.localize("C2MQ.Setting.SacrificialArmorEnabled.Name"),
    hint: game.i18n.localize("C2MQ.Setting.SacrificialArmorEnabled.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.AUTO_PROTECT_REACTION, {
    name: game.i18n.localize("C2MQ.Setting.AutoProtectReaction.Name"),
    hint: game.i18n.localize("C2MQ.Setting.AutoProtectReaction.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.ALLOW_PLAYERS_REQUEST_APPLY, {
    name: game.i18n.localize("C2MQ.Setting.AllowPlayersRequestApply.Name"),
    hint: game.i18n.localize("C2MQ.Setting.AllowPlayersRequestApply.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.SHOW_APPLY_ALL, {
    name: game.i18n.localize("C2MQ.Setting.ShowApplyAll.Name"),
    hint: game.i18n.localize("C2MQ.Setting.ShowApplyAll.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.DEBUG, {
    name: game.i18n.localize("C2MQ.Setting.Debug.Name"),
    hint: game.i18n.localize("C2MQ.Setting.Debug.Hint"),
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, SETTING_KEYS.SACRIFICIAL_WEAPONS_ENABLED, {
  name: game.i18n.localize("C2MQ.Setting.SacrificialWeapons.Name"),
  hint: game.i18n.localize("C2MQ.Setting.SacrificialWeapons.Hint"),
  scope: "world",
  config: true,
  type: Boolean,
  default: false
});
}