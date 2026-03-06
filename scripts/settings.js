import { MODULE_ID, SETTING_KEYS } from "./constants.js";

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

  game.settings.register(MODULE_ID, SETTING_KEYS.AUTO_REACH_DIFFICULTY, {
    name: game.i18n.localize("C2MQ.Setting.AutoReachDifficulty.Name"),
    hint: game.i18n.localize("C2MQ.Setting.AutoReachDifficulty.Hint"),
    scope: "world",
    config: true,
    type: Boolean,
    default: true
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
}