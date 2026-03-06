import { MODULE_ID, SETTING_KEYS } from "../constants.js";
import {
  debugEnabled,
  getSceneScopeId,
  getHitLocationEnabled,
  hitLocationFromD20,
  resolveDamageSpec,
  rollCombatDice,
  resolveStressPaths,
  resolvePersistentSoak
} from "../adapter/conan2d20.js";

function hasActiveGM() {
  return game.users?.some(u => u.active && u.isGM);
}

function isAuthoritativeFor(message) {
  if (game.user?.isGM) return true;
  if (hasActiveGM()) return false;
  return message?.author?.id === game.user?.id;
}

function allowPlayerRequests() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.ALLOW_PLAYERS_REQUEST_APPLY);
}

function getFlags(message) {
  return message?.flags?.[MODULE_ID] ?? null;
}

function setFlags(message, next) {
  return message.update({ [`flags.${MODULE_ID}`]: next });
}

/**
 * IMPORTANT:
 * Never use raw tokenUuid as an object key inside flags, because "." characters
 * are treated as object-path separators by Foundry's merge/expand logic, turning
 * `applied["Scene.xxx.Token.yyy"]` into `applied.Scene.xxx.Token.yyy`.
 */
function safeTokenKey(tokenUuid) {
  const raw = String(tokenUuid ?? "");
  return encodeURIComponent(raw).replaceAll(".", "%2E");
}

function parseSceneTokenFromUuid(tokenUuid) {
  const parts = String(tokenUuid ?? "").split(".");
  if (parts.length >= 4 && parts[0] === "Scene" && parts[2] === "Token") {
    return { sceneId: parts[1], tokenId: parts[3] };
  }
  return null;
}

function getLegacyNestedEntry(map, tokenUuid) {
  const ids = parseSceneTokenFromUuid(tokenUuid);
  if (!ids) return null;
  return map?.Scene?.[ids.sceneId]?.Token?.[ids.tokenId] ?? null;
}

function flattenTokenKeyedMap(map) {
  const out = {};

  for (const [k, v] of Object.entries(map ?? {})) {
    // Do not carry over legacy nested storage root.
    if (!k.includes(".") && k !== "Scene" && v && typeof v === "object") out[k] = v;
  }

  const scenes = map?.Scene;
  if (scenes && typeof scenes === "object") {
    for (const [sceneId, sceneVal] of Object.entries(scenes)) {
      const tokens = sceneVal?.Token;
      if (!tokens || typeof tokens !== "object") continue;

      for (const [tokenId, entry] of Object.entries(tokens)) {
        const tokenUuid = `Scene.${sceneId}.Token.${tokenId}`;
        out[safeTokenKey(tokenUuid)] = entry;
      }
    }
  }

  return out;
}

function normalizeTokenKeyedFlags(flags) {
  const next = foundry.utils.duplicate(flags ?? {});
  next.applied = flattenTokenKeyedMap(next.applied);

  if (next.hitLocation?.byTarget) {
    next.hitLocation.byTarget = flattenTokenKeyedMap(next.hitLocation.byTarget);
  }

  return next;
}

function findAppliedEntry(flags, tokenUuid) {
  const applied = flags?.applied ?? {};
  const k = safeTokenKey(tokenUuid);

  if (applied?.[k]) return { key: k, value: applied[k] };
  if (applied?.[tokenUuid]) return { key: tokenUuid, value: applied[tokenUuid] };

  const nested = getLegacyNestedEntry(applied, tokenUuid);
  if (nested) return { key: k, value: nested, legacyNested: true };

  return null;
}

function findHitLocationEntry(flags, tokenUuid) {
  const byTarget = flags?.hitLocation?.byTarget ?? {};
  const k = safeTokenKey(tokenUuid);
  return byTarget?.[k] ?? byTarget?.[tokenUuid] ?? getLegacyNestedEntry(byTarget, tokenUuid) ?? null;
}

function findEquippedArmorForLocation(actor, hitLocationKey) {
  const locMap = {
    head: "head",
    torso: "torso",
    leftArm: "l-arm",
    rightArm: "r-arm",
    leftLeg: "l-leg",
    rightLeg: "r-leg"
  };
  const covKey = locMap[hitLocationKey] ?? "torso";

  return actor.items?.find(i =>
    i.type === "armor" &&
    i.system?.equipped === true &&
    Array.isArray(i.system?.coverage?.value) &&
    i.system.coverage.value.includes(covKey)
  ) ?? null;
}

function findEquippedShield(actor) {
  return actor.items?.find(i =>
    i.type === "weapon" &&
    i.system?.equipped === true &&
    i.system?.isShield === true
  ) ?? null;
}

async function resolveTokenDoc(tokenUuid) {
  try {
    const doc = await fromUuid(tokenUuid);
    return doc ?? null;
  } catch (_e) {
    return null;
  }
}

export async function execRollDamage(message) {
  if (!message) return;

  const flags = getFlags(message);
  if (!flags) {
    console.warn(`[${MODULE_ID}] execRollDamage: missing flags on message`, message?.id);
    return;
  }

  if (!isAuthoritativeFor(message)) return;
  if (flags.damage?.rolled) return;

  const sysItem = message.flags?.data?.item;
  const sysDice = Number(sysItem?.system?.damage?.dice ?? 0);
  const sysType = String(sysItem?.system?.damage?.type ?? "physical");

  let spec = null;
  if (Number.isFinite(sysDice) && sysDice > 0) {
    spec = { dice: sysDice, static: 0, type: sysType };
  } else {
    const attacker = flags.context?.attackerActorUuid ? await fromUuid(flags.context.attackerActorUuid) : null;
    const item = flags.context?.itemUuid ? await fromUuid(flags.context.itemUuid) : null;
    spec = resolveDamageSpec(attacker, item);
  }

  if (!spec?.dice) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.DamageSpecMissing"));
    return;
  }

  const rolled = await rollCombatDice(spec.dice);
  const total = (rolled.total ?? 0) + (spec.static ?? 0);

  const hitLocationEnabled = getHitLocationEnabled();
  const byTarget = {};

  for (const t of (flags.targets ?? [])) {
    const key = safeTokenKey(t.tokenUuid);
    if (hitLocationEnabled) {
      const d20 = await (new Roll("1d20")).evaluate();
      const face = Number(d20.total ?? d20.result ?? 0);
      const hl = hitLocationFromD20(face);
      byTarget[key] = { d20: face, key: hl.key, label: hl.label };
    } else {
      byTarget[key] = { d20: null, key: "torso", label: "Torso" };
    }
  }

  const next = normalizeTokenKeyedFlags(flags);
  next.damage = {
    rolled: true,
    total,
    dice: spec.dice,
    static: spec.static ?? 0,
    effects: rolled.effects ?? 0,
    faces: rolled.faces ?? [],
    type: spec.type ?? "physical"
  };

  next.hitLocation = {
    enabled: hitLocationEnabled,
    mode: "perTarget",
    byTarget
  };

  await setFlags(message, next);
  try { ui.chat?.render?.(true); } catch (_e) {}

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] rollDamage`, { messageId: message.id, spec, rolled, total, hitLocationEnabled });
  }
}

export async function execApplyDamage(message, targetTokenUuid, { applyAll = false } = {}) {
  if (!message) return;
  const flags = getFlags(message);
  if (!flags?.damage?.rolled) return;

  if (!allowPlayerRequests() && !game.user?.isGM) return;
  if (!isAuthoritativeFor(message)) return;

  const targets = flags.targets ?? [];
  const list = applyAll ? targets.map(t => t.tokenUuid) : [targetTokenUuid].filter(Boolean);

  for (const tokenUuid of list) {
    await _applyToSingle(message, tokenUuid);
  }
}

async function _applyToSingle(message, tokenUuid) {
  const flags = getFlags(message);
  if (!flags) return;

  // Idempotency: already applied for this target (supports legacy formats)
  if (findAppliedEntry(flags, tokenUuid)) return;

  const appliedKey = safeTokenKey(tokenUuid);

  const tokenDoc = await resolveTokenDoc(tokenUuid);
  const actor = tokenDoc?.actor ?? null;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.TargetMissing"));
    return;
  }

  const damageType = flags.damage?.type ?? "physical";
  const damageTotal = Number(flags.damage?.total ?? 0) || 0;

  const hit = findHitLocationEntry(flags, tokenUuid);
  const hitLocationKey = hit?.key ?? "torso";

  const soak = resolvePersistentSoak(actor, { damageType, hitLocationKey });
  const netDamage = Math.max(0, damageTotal - soak);

  const { stressPath, harmPath } = resolveStressPaths(actor, damageType);
  if (!stressPath) {
    ui.notifications.error(game.i18n.localize("C2MQ.Err.StressPathMissing"));
    if (debugEnabled()) console.warn(`[${MODULE_ID}] Missing stressPath`, actor);
    return;
  }

  const beforeStress = Number(foundry.utils.getProperty(actor, stressPath) ?? 0) || 0;
  const afterStress = Math.max(0, beforeStress - netDamage);

  const patches = [];
  patches.push({ path: stressPath, before: beforeStress, after: afterStress });

  let harms = 0;
  if (netDamage > 0 && netDamage >= 5) harms += 1;
  if (netDamage > 0 && beforeStress === 0) harms += 1;
  if (netDamage > 0 && beforeStress > 0 && afterStress === 0) harms += 1;

  const sacrificialEnabled = !!game.settings.get(MODULE_ID, SETTING_KEYS.SACRIFICIAL_ARMOR_ENABLED);
  const scopeId = getSceneScopeId();

  const sacFlagPath = `flags.${MODULE_ID}.sacrificial`;
  const sacBefore = foundry.utils.getProperty(actor, sacFlagPath) ?? null;

  let sacrificedItem = null;
  let sacUsedNow = false;
  if (sacrificialEnabled && damageType === "physical" && harms > 0) {
    const alreadyUsed = sacBefore?.scopeId === scopeId && sacBefore?.used === true;

    if (!alreadyUsed) {
      const confirm = await Dialog.confirm({
        title: game.i18n.localize("C2MQ.Dialog.Sacrificial.Title"),
        content: `<p>${game.i18n.localize("C2MQ.Dialog.Sacrificial.Content")}</p>`,
        defaultYes: false
      });

      if (confirm) {
        harms = Math.max(0, harms - 1);
        sacUsedNow = true;

        sacrificedItem = findEquippedArmorForLocation(actor, hitLocationKey) ?? findEquippedShield(actor);
        if (sacrificedItem && sacrificedItem.system?.broken !== true) {
          await sacrificedItem.update({ "system.broken": true });
        }
      }
    }
  }

  const update = { [stressPath]: afterStress };

  let beforeHarm = null;
  let afterHarm = null;

  if (harms > 0 && harmPath) {
    beforeHarm = Number(foundry.utils.getProperty(actor, harmPath) ?? 0) || 0;
    afterHarm = beforeHarm + harms;
    patches.push({ path: harmPath, before: beforeHarm, after: afterHarm });
    update[harmPath] = afterHarm;
  }

  if (sacUsedNow) {
    const nextSac = { scopeId, used: true };
    patches.push({ path: sacFlagPath, before: sacBefore, after: nextSac });
    update[sacFlagPath] = nextSac;
  }

  await actor.update(update);

  const nextFlags = normalizeTokenKeyedFlags(flags);
  nextFlags.applied = nextFlags.applied ?? {};
  nextFlags.applied[appliedKey] = {
    state: "applied",
    appliedAt: Date.now(),
    appliedBy: game.user?.id ?? null,
    actorUuid: actor.uuid,
    patches,
    meta: {
      soakUsed: soak,
      netDamage,
      harmsApplied: harms,
      stressBefore: beforeStress,
      stressAfter: afterStress,
      hitLocationKey
    },
    sacrificial: sacUsedNow ? {
      itemUuid: sacrificedItem?.uuid ?? null,
      itemId: sacrificedItem?.id ?? null
    } : null
  };

  await setFlags(message, nextFlags);
  try { ui.chat?.render?.(true); } catch (_e) {}

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] apply`, { tokenUuid, damageTotal, soak, netDamage, harms, stressPath, harmPath });
  }
}

export async function execUndoDamage(message, targetTokenUuid) {
  if (!message || !targetTokenUuid) return;
  const flags = getFlags(message);
  if (!flags) return;

  if (!allowPlayerRequests() && !game.user?.isGM) return;
  if (!isAuthoritativeFor(message)) return;

  const found = findAppliedEntry(flags, targetTokenUuid);
  if (!found) return;

  const applied = found.value;

  const confirm = await Dialog.confirm({
    title: game.i18n.localize("C2MQ.Dialog.Undo.Title"),
    content: `<p>${game.i18n.localize("C2MQ.Dialog.Undo.Content")}</p>`,
    defaultYes: false
  });

  if (!confirm) return;

  const actor = applied.actorUuid ? await fromUuid(applied.actorUuid) : null;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.TargetMissing"));
    return;
  }

  const sac = applied?.sacrificial;
  if (sac?.itemUuid) {
    const it = await fromUuid(sac.itemUuid);
    if (it) await it.update({ "system.broken": false });
  }

  const update = {};
  for (const p of (applied.patches ?? [])) update[p.path] = p.before;

  await actor.update(update);

  const nextFlags = normalizeTokenKeyedFlags(flags);
  const delKey = safeTokenKey(targetTokenUuid);
  delete nextFlags.applied?.[delKey];

  // IMPORTANT: ensure deletion is persisted (Foundry merges objects on update).
  await message.update({
    [`flags.${MODULE_ID}`]: nextFlags,
    [`flags.${MODULE_ID}.applied.-=${delKey}`]: null,
    [`flags.${MODULE_ID}.applied.-=Scene`]: null
  });
  try { ui.chat?.render?.(true); } catch (_e) {}

  if (debugEnabled()) console.debug(`[${MODULE_ID}] undo`, { targetTokenUuid, actor: actor.uuid });
}