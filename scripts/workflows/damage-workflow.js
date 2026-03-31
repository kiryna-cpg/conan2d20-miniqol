import { MODULE_ID, SETTING_KEYS, SOCKET_NAME, SOCKET_OPS } from "../constants.js";
import {
  debugEnabled,
  getHitLocationEnabled,
  hitLocationFromD20,
  resolveDamageSpec,
  rollCombatDice,
  resolveStressPaths,
  resolvePersistentSoak,
  buildDotTrackUpdate
} from "../adapter/conan2d20.js";

function hasActiveGM() {
  return game.users?.some((u) => u.active && u.isGM);
}

function isAuthoritativeForDamageRoll(message) {
  if (game.user?.isGM) return true;
  if (message?.author?.id === game.user?.id) return true;
  return false;
}

function isAuthoritativeForApplyWorkflow(message) {
  if (game.user?.isGM) return true;
  if (hasActiveGM()) return false;
  return message?.author?.id === game.user?.id;
}

async function openDamageRollerDialog({ itemName, baseDice, defaultAttackType }) {
  const state = {
    attackType: defaultAttackType ?? "melee",
    baseDice: Math.max(1, Number(baseDice ?? 1) || 1),
    bonusOther: 0,
    bonusTalent: 0,
    spendMomentum: 0,
    spendDoom: 0
  };

  const content = `
  <section class="window-content">
    <div class="dialog">
      <div class="dialog-content damage-roller">
        <div class="label">${game.i18n.localize("C2MQ.DamageRoller.AttackType.Label")}</div>
        <div class="grid-3-columns">
          <button class="damage-roller damage-type button" data-damage-type="melee">${game.i18n.localize("C2MQ.DamageRoller.AttackType.Melee")}</button>
          <button class="damage-roller damage-type button" data-damage-type="ranged">${game.i18n.localize("C2MQ.DamageRoller.AttackType.Ranged")}</button>
          <button class="damage-roller damage-type button" data-damage-type="threaten">${game.i18n.localize("C2MQ.DamageRoller.AttackType.Threaten")}</button>
        </div>

        <div class="label">${foundry.utils.escapeHTML(String(itemName ?? ""))}</div>

        <div class="dialog-inputs damage-roller grid-2-columns">
          <div class="damage-roller quantity-grid disable-entry">
            <div class="quantity-header">${game.i18n.localize("C2MQ.DamageRoller.CombatDice")}</div>
            <input id="numDice" type="number" min="1" value="${state.baseDice}" data-quantity-type="base.numDice" disabled="">
            <div class="quantity-up"><i class="fa-regular fa-square-plus"></i></div>
            <div class="quantity-down"><i class="fa-regular fa-square-minus"></i></div>
          </div>

          <div class="damage-roller quantity-grid reload-quantity disable-entry">
            <div class="quantity-header">${game.i18n.localize("C2MQ.DamageRoller.Reloads")}</div>
            <input id="reloads" type="number" min="0" step="1" value="0" data-quantity-type="bonus.reloads" disabled="">
            <div class="quantity-up"><i class="fa-regular fa-square-plus"></i></div>
            <div class="quantity-down"><i class="fa-regular fa-square-minus"></i></div>
          </div>
        </div>

        <div class="dialog-inputs reload-choice disable-entry">
          <select class="damage-roller reload-select" name="reload" data-dtype="String">
            <option value="">${game.i18n.localize("C2MQ.DamageRoller.NoReloads")}</option>
          </select>
        </div>

        <div class="label">${game.i18n.localize("C2MQ.DamageRoller.BonusDice")}</div>
        <div class="grid-2-columns">
          <div class="damage-roller quantity-grid" data-quantity-type="bonus.other">
            <div class="quantity-header">${game.i18n.localize("C2MQ.DamageRoller.Bonus.Other")}</div>
            <input type="number" min="0" step="1" value="0" data-quantity-type="bonus.other" disabled="">
            <div class="quantity-up"><i class="fa-regular fa-square-plus"></i></div>
            <div class="quantity-down"><i class="fa-regular fa-square-minus"></i></div>
          </div>

          <div class="damage-roller quantity-grid" data-quantity-type="bonus.talent">
            <div class="quantity-header">${game.i18n.localize("C2MQ.DamageRoller.Bonus.Talent")}</div>
            <input type="number" min="0" step="1" value="0" data-quantity-type="bonus.talent" disabled="">
            <div class="quantity-up"><i class="fa-regular fa-square-plus"></i></div>
            <div class="quantity-down"><i class="fa-regular fa-square-minus"></i></div>
          </div>
        </div>

        <div class="label">${game.i18n.localize("C2MQ.DamageRoller.BonusDamage")}</div>
        <div class="grid-2-columns">
          <div class="damage-roller quantity-grid disable-entry" data-quantity-type="spends.doom">
            <div class="quantity-header">${game.i18n.localize("C2MQ.DamageRoller.Spend.Doom")}</div>
            <input type="number" min="0" step="1" value="0" data-quantity-type="spends.doom" disabled="">
            <div class="quantity-up"><i class="fa-regular fa-square-plus"></i></div>
            <div class="quantity-down"><i class="fa-regular fa-square-minus"></i></div>
          </div>

          <div class="damage-roller quantity-grid" data-quantity-type="spends.momentum">
            <div class="quantity-header">${game.i18n.localize("C2MQ.DamageRoller.Spend.Momentum")}</div>
            <input type="number" min="0" step="1" value="0" data-quantity-type="spends.momentum" disabled="">
            <div class="quantity-up"><i class="fa-regular fa-square-plus"></i></div>
            <div class="quantity-down"><i class="fa-regular fa-square-minus"></i></div>
          </div>
        </div>

        <div class="dialog-inputs">
          <button class="roll-dice">${game.i18n.localize("C2MQ.DamageRoller.RollDice")}</button>
        </div>
      </div>
    </div>
  </section>`;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value ?? null);
    };

    const dlg = new Dialog(
      {
        title: game.i18n.localize("C2MQ.DamageRoller.Title"),
        content,
        buttons: {},
        render: (html) => {
          const root = html[0];
          if (!root) return;

          const typeBtns = Array.from(root.querySelectorAll("button.damage-type"));
          const syncTypeUi = () => {
            for (const b of typeBtns) {
              b.classList.toggle("active", b.dataset.damageType === state.attackType);
            }
          };
          syncTypeUi();

          for (const b of typeBtns) {
            b.addEventListener("click", (ev) => {
              ev.preventDefault();
              state.attackType = b.dataset.damageType;
              syncTypeUi();
            });
          }

          const getKey = (el) =>
            el?.dataset?.quantityType ?? el?.querySelector?.("input")?.dataset?.quantityType ?? null;

          const setInput = (key, value) => {
            const input = root.querySelector(`input[data-quantity-type="${CSS.escape(key)}"]`);
            if (input) input.value = String(value);
          };

          const bump = (key, delta) => {
            const d = Number(delta ?? 0) || 0;
            if (!d || !key) return;
            if (key === "bonus.other") state.bonusOther = Math.max(0, state.bonusOther + d);
            else if (key === "bonus.talent") state.bonusTalent = Math.max(0, state.bonusTalent + d);
            else if (key === "spends.momentum") state.spendMomentum = Math.max(0, state.spendMomentum + d);
            else if (key === "spends.doom") state.spendDoom = Math.max(0, state.spendDoom + d);

            setInput("bonus.other", state.bonusOther);
            setInput("bonus.talent", state.bonusTalent);
            setInput("spends.momentum", state.spendMomentum);
            setInput("spends.doom", state.spendDoom);
          };

          for (const up of Array.from(root.querySelectorAll(".quantity-up"))) {
            up.addEventListener("click", (ev) => {
              ev.preventDefault();
              bump(getKey(up.closest(".quantity-grid")), +1);
            });
          }
          for (const down of Array.from(root.querySelectorAll(".quantity-down"))) {
            down.addEventListener("click", (ev) => {
              ev.preventDefault();
              bump(getKey(down.closest(".quantity-grid")), -1);
            });
          }

          root.querySelector("button.roll-dice")?.addEventListener("click", (ev) => {
            ev.preventDefault();
            finish(foundry.utils.duplicate(state));
            dlg.close();
          });
        },
        close: () => finish(null)
      },
      { classes: ["c2mq", "damage-roller-dialog"] }
    );

    dlg.render(true);
  });
}

function allowPlayerRequests() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.ALLOW_PLAYERS_REQUEST_APPLY);
}
function normalizeDamageType(rawType) {
  return String(rawType ?? "").trim().toLowerCase() === "mental" ? "mental" : "physical";
}

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

function getTokenKeyedEntry(map, tokenUuid) {
  if (!map) return null;
  const safe = safeTokenKey(tokenUuid);
  return map?.[safe] ?? map?.[tokenUuid] ?? getLegacyNestedEntry(map, tokenUuid) ?? null;
}

function normalizeTokenKeyedMap(map, targets = []) {
  const out = {};
  const targetUuids = Array.isArray(targets) ? targets.map((t) => t?.tokenUuid).filter(Boolean) : [];

  for (const tokenUuid of targetUuids) {
    const found = getTokenKeyedEntry(map, tokenUuid);
    if (found != null) out[safeTokenKey(tokenUuid)] = found;
  }

  for (const [key, value] of Object.entries(map ?? {})) {
    if (key === "Scene") continue;
    out[key.includes("Scene.") ? safeTokenKey(key) : key] ??= value;
  }

  return out;
}

function normalizeTokenKeyedFlags(flags) {
  const next = foundry.utils.duplicate(flags ?? {});
  next.targets = Array.isArray(next.targets) ? next.targets : [];
  next.applied = normalizeTokenKeyedMap(next.applied ?? {}, next.targets);
  next.hitLocation = next.hitLocation ?? { enabled: false, mode: "perTarget", byTarget: {} };
  next.hitLocation.byTarget = normalizeTokenKeyedMap(next.hitLocation.byTarget ?? {}, next.targets);
  return next;
}

function getFlags(message) {
  const raw = message?.flags?.[MODULE_ID] ?? null;
  return raw ? normalizeTokenKeyedFlags(raw) : null;
}

async function setFlags(message, nextFlags) {
  await message.update({ [`flags.${MODULE_ID}`]: normalizeTokenKeyedFlags(nextFlags) });
}

function findAppliedEntry(flags, tokenUuid) {
  const map = flags?.applied ?? {};
  const value = getTokenKeyedEntry(map, tokenUuid);
  if (value == null) return null;
  return { key: safeTokenKey(tokenUuid), value };
}

function findHitLocationEntry(flags, tokenUuid) {
  return getTokenKeyedEntry(flags?.hitLocation?.byTarget ?? {}, tokenUuid);
}

const _pendingSacrificialPrompts = new Map();

function emitSocket(op, payload = {}) {
  game.socket.emit(SOCKET_NAME, { op, ...payload });
}

function getBaseActor(actor, tokenDoc = null) {
  const baseActorId = tokenDoc?.actorId ?? actor?.id ?? null;
  return baseActorId ? game.actors?.get(baseActorId) ?? actor : actor;
}

function collectOwnershipDocs(actor, tokenDoc = null) {
  const docs = [];
  const seen = new Set();
  const push = (doc) => {
    if (!doc) return;
    const key = doc.uuid ?? `${doc.documentName ?? "Doc"}:${doc.id ?? foundry.utils.randomID()}`;
    if (seen.has(key)) return;
    seen.add(key);
    docs.push(doc);
  };
  push(tokenDoc);
  push(tokenDoc?.actor ?? null);
  push(actor);
  push(tokenDoc?.actorId ? game.actors?.get(tokenDoc.actorId) ?? null : null);
  push(actor?.id ? game.actors?.get(actor.id) ?? null : null);
  return docs;
}

function userOwnsAnyDoc(user, docs = []) {
  return docs.some((doc) => typeof doc?.testUserPermission === "function" && doc.testUserPermission(user, "OWNER"));
}

function itemIsEquipped(item) {
  return item?.system?.equipped === true;
}

function itemIsBroken(item) {
  return item?.system?.broken === true;
}

function itemIsUnarmed(item) {
  if (item?.system?.isUnarmed === true || item?.system?.unarmed === true) return true;

  const name = String(item?.name ?? "").trim().toLowerCase();

  return (
    name === "unarmed" ||
    name === "desarmado" ||
    name.includes("unarmed") ||
    name.includes("improvised") ||
    name.includes("desarmad") ||
    name.includes("improvisad")
  );
}

function itemHasQuality(item, qualityType) {
  return Array.isArray(item?.system?.qualities?.value)
    && item.system.qualities.value.some((quality) => quality?.type === qualityType);
}

function buildDamageQualityMeta(item, { damageType = "physical", effects = 0 } = {}) {
  const qualities = Array.isArray(item?.system?.qualities?.value) ? item.system.qualities.value : [];

  const findValue = (type) => {
    const entry = qualities.find((quality) => quality?.type === type);
    const value = Number(entry?.value ?? 0);
    return Number.isFinite(value) ? value : 0;
  };

  const fx = Math.max(0, Number(effects ?? 0) || 0);
  let bonusDamage = 0;

  const vicious = findValue("viciousx");
  if (vicious > 0) bonusDamage += vicious * fx;

  if (damageType === "physical") {
    const cavalry = findValue("cavalryx");
    if (cavalry > 0) bonusDamage += cavalry * fx;
  } else if (damageType === "mental") {
    const fearsome = findValue("fearsomex");
    if (fearsome > 0) bonusDamage += fearsome * fx;
  }

  return {
    intense: qualities.some((quality) => quality?.type === "intense"),
    nonlethal: qualities.some((quality) => quality?.type === "nonlethal"),
    ignoreSoak: Math.max(0, findValue("piercingx") * fx),
    bonusDamage
  };
}

function classifySacrificialKind(item) {
  if (!item || itemIsUnarmed(item)) return null;
  if (item?.system?.isShield === true || itemHasQuality(item, "shieldx")) return "shield";
  if (item.type === "armor") return "armor";
  if (item.type === "weapon") return "weapon";

  const text = `${item.name ?? ""} ${item.system?.type ?? ""}`.toLowerCase();
  if (text.includes("shield") || text.includes("escudo")) return "shield";

  return null;
}

function getArmorCoverageValues(item) {
  return Array.isArray(item?.system?.coverage?.value)
    ? [...item.system.coverage.value]
    : [];
}

function armorCoversLocation(item, hitLocationKey) {
  if (!item || classifySacrificialKind(item) !== "armor") return false;
  return getArmorCoverageValues(item).includes(hitLocationKey);
}

function localizeCoverageKey(locationKey) {
  const labelKey = CONFIG.CONAN?.coverageTypes?.[locationKey] ?? locationKey;
  return game.i18n.localize(labelKey);
}

async function createSacrificialChatMessage({ item, kind, hitLocationKey = null, becameBroken = false } = {}) {
  if (!item || !kind) return;

  const safeItem = `<strong>${foundry.utils.escapeHTML(String(item.name ?? ""))}</strong>`;
  const safeLocation = hitLocationKey
    ? `<strong>${foundry.utils.escapeHTML(localizeCoverageKey(hitLocationKey))}</strong>`
    : null;

  let body = "";

  if (kind === "armor" && !becameBroken) {
    body = game.i18n.format("C2MQ.Info.SacrificialArmorCoverageLost", {
      item: safeItem,
      location: safeLocation
    });
  } else if (kind === "armor" && becameBroken) {
    body = game.i18n.format("C2MQ.Info.SacrificialArmorBroken", {
      item: safeItem,
      location: safeLocation
    });
  } else if (kind === "shield") {
    body = game.i18n.format("C2MQ.Info.SacrificialShieldBroken", {
      item: safeItem
    });
  } else if (kind === "weapon") {
    body = game.i18n.format("C2MQ.Info.SacrificialWeaponBroken", {
      item: safeItem
    });
  }

  if (!body) return;

  await ChatMessage.create({
    user: game.user?.id ?? null,
    content: `<h2>${game.i18n.localize("C2MQ.Dialog.Sacrificial.Title")}</h2><div><p>${body}</p></div>`
  });
}

async function applySacrificialSelection(item, { kind, hitLocationKey } = {}) {
  if (!item || !kind) return null;

  const beforeBroken = item?.system?.broken === true;
  const beforeCoverage = getArmorCoverageValues(item);

  let afterBroken = beforeBroken;
  let afterCoverage = beforeCoverage;

  if (kind === "armor") {
    if (!beforeCoverage.includes(hitLocationKey)) return null;

    afterCoverage = beforeCoverage.filter((loc) => loc !== hitLocationKey);
    afterBroken = beforeBroken || afterCoverage.length === 0;

    await item.update({
      "system.coverage.value": afterCoverage,
      "system.broken": afterBroken
    });

    await createSacrificialChatMessage({
      item,
      kind,
      hitLocationKey,
      becameBroken: afterBroken
    });

    return {
      itemUuid: item.uuid ?? null,
      itemId: item.id ?? null,
      kind,
      hitLocationKey,
      beforeBroken,
      afterBroken,
      beforeCoverage,
      afterCoverage
    };
  }

  await item.update({ "system.broken": true });

  await createSacrificialChatMessage({
    item,
    kind,
    hitLocationKey: null,
    becameBroken: true
  });

  return {
    itemUuid: item.uuid ?? null,
    itemId: item.id ?? null,
    kind,
    hitLocationKey: null,
    beforeBroken,
    afterBroken: true,
    beforeCoverage: null,
    afterCoverage: null
  };
}

function buildSacrificialCandidates(actor, { hitLocationKey = "torso", allowWeaponSacrifice = false } = {}) {
  const items = Array.from(actor?.items ?? []);
  const candidates = [];

  for (const item of items) {
    if (!itemIsEquipped(item) || itemIsBroken(item)) continue;

    const kind = classifySacrificialKind(item);
    if (!kind) continue;
    if (kind === "weapon" && !allowWeaponSacrifice) continue;

    // Armor may only be sacrificed if it actually covers the struck location.
    if (kind === "armor" && !armorCoversLocation(item, hitLocationKey)) continue;

    let priority = 10;
    if (kind === "shield") priority = 1;
    else if (kind === "armor") priority = 2;
    else if (kind === "weapon") priority = 3;

    candidates.push({
      item,
      uuid: item.uuid,
      id: item.id,
      name: item.name,
      kind,
      locationKey: kind === "armor" ? hitLocationKey : null,
      priority
    });
  }

  return candidates.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

async function promptSacrificialItem(actor, { hitLocationKey = "torso", allowWeaponSacrifice = false } = {}) {
  const candidates = buildSacrificialCandidates(actor, { hitLocationKey, allowWeaponSacrifice });
  if (!candidates.length) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.NoSacrificialCandidates"));
    return null;
  }
  const options = candidates
    .map((c) => {
      const kindKey = c.kind === "shield" ? "Shield" : c.kind === "weapon" ? "Weapon" : "Armor";
      const kindLabel = game.i18n.localize(`C2MQ.Dialog.Sacrificial.Kind.${kindKey}`);
      const coverageSuffix =
        c.kind === "armor" && c.locationKey
          ? ` — ${localizeCoverageKey(c.locationKey)}`
          : "";

      return `<option value="${foundry.utils.escapeHTML(c.uuid)}">${foundry.utils.escapeHTML(`${c.name} (${kindLabel}${coverageSuffix})`)}</option>`;
    })
    .join("");

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value ?? null);
    };

    const dlg = new Dialog({
      title: game.i18n.localize("C2MQ.Dialog.Sacrificial.Title"),
      content: `
        <p>${game.i18n.localize("C2MQ.Dialog.Sacrificial.Content")}</p>
        <div class="form-group">
          <label>${game.i18n.localize("C2MQ.Dialog.Sacrificial.SelectLabel")}</label>
          <select name="sacrificial-item">${options}</select>
        </div>
      `,
      buttons: {
        yes: {
          label: game.i18n.localize("C2MQ.Dialog.Sacrificial.ButtonSacrifice"),
          callback: (html) => finish(html.find('select[name="sacrificial-item"]').val())
        },
        no: {
          label: game.i18n.localize("C2MQ.Dialog.Sacrificial.ButtonCancel"),
          callback: () => finish(null)
        }
      },
      default: "yes",
      close: () => finish(null)
    });

    dlg.render(true);
  });
}

function getSacrificialPromptRouting(actor, tokenDoc = null) {
  const docs = collectOwnershipDocs(actor, tokenDoc);
  const baseActor = getBaseActor(actor, tokenDoc);
  const activePlayers = game.users?.filter((user) => user.active && !user.isGM) ?? [];
  const activeGMs = game.users?.filter((user) => user.active && user.isGM) ?? [];

  const fallbackGM =
    activeGMs.find((user) => userOwnsAnyDoc(user, docs)) ??
    activeGMs[0] ??
    (game.user?.isGM ? game.user : null);

  const actorType = String(baseActor?.type ?? actor?.type ?? "").toLowerCase();

  // Deterministic-but-robust routing:
  // - NPC defenders are always handled by GM.
  // - PC defenders go first to the assigned player character.
  // - If no assigned character exists, use real ownership on token/actor.
  // - If no active player can handle it, fall back to GM.
  if (actorType === "npc") {
    return {
      promptUserId: fallbackGM?.id ?? null,
      fallbackGmUserId: fallbackGM?.id ?? null
    };
  }

  const assignedPlayer =
    activePlayers.find((user) => user.character?.id === baseActor?.id) ?? null;

  const ownerPlayers =
    activePlayers.filter((user) => userOwnsAnyDoc(user, docs));

  const ownerPlayer =
    ownerPlayers.find((user) => user.character?.id === baseActor?.id) ??
    ownerPlayers[0] ??
    null;

  return {
    promptUserId: assignedPlayer?.id ?? ownerPlayer?.id ?? fallbackGM?.id ?? null,
    fallbackGmUserId: fallbackGM?.id ?? null
  };
}

function getSacrificialUsageContext(actor, tokenDoc = null) {
  const combat = game.combat;
  if (!combat?.started) {
    return {
      limited: false,
      scopeType: null,
      scopeId: null,
      combatantId: null
    };
  }

  const combatant =
    (tokenDoc?.id
      ? combat.combatants?.find((entry) => entry.tokenId === tokenDoc.id) ?? null
      : null) ??
    combat.combatants?.find((entry) => entry.actor?.id === actor?.id) ??
    null;

  if (!combatant) {
    return {
      limited: false,
      scopeType: null,
      scopeId: null,
      combatantId: null
    };
  }

  return {
    limited: true,
    scopeType: "combat",
    scopeId: combat.id ?? null,
    combatantId: combatant.id ?? null
  };
}

function waitForSacrificialPromptResolution(requestId, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(() => {
      const pending = _pendingSacrificialPrompts.get(requestId);
      if (!pending) return;
      _pendingSacrificialPrompts.delete(requestId);
      pending.resolve({ status: "timeout", chosenUuid: null, responderUserId: null });
    }, timeoutMs);

    _pendingSacrificialPrompts.set(requestId, { resolve, timer });
  });
}

async function requestSacrificialItem(actor, tokenDoc, { hitLocationKey, allowWeaponSacrifice } = {}) {
  const candidates = buildSacrificialCandidates(actor, { hitLocationKey, allowWeaponSacrifice });
  if (!candidates.length) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.NoSacrificialCandidates"));
    return null;
  }

  const routing = getSacrificialPromptRouting(actor, tokenDoc);
  const promptUserId = routing.promptUserId ?? null;
  const fallbackGmUserId = routing.fallbackGmUserId ?? null;

  if (!promptUserId || promptUserId === game.user?.id) {
    return await promptSacrificialItem(actor, { hitLocationKey, allowWeaponSacrifice });
  }

  const baseActor = getBaseActor(actor, tokenDoc);
  const requestId = foundry.utils.randomID();
  const pending = waitForSacrificialPromptResolution(requestId);

  emitSocket(SOCKET_OPS.PROMPT_SACRIFICIAL, {
    requestId,
    promptUserId,
    fallbackGmUserId,
    targetTokenUuid: tokenDoc?.uuid ?? null,
    actorUuid: baseActor?.uuid ?? actor?.uuid ?? null,
    actorId: baseActor?.id ?? actor?.id ?? null,
    preferredCharacterActorId: baseActor?.id ?? actor?.id ?? null,
    hitLocationKey,
    allowWeaponSacrifice: allowWeaponSacrifice === true
  });

  const response = await pending;

  if (response?.status === "resolved") {
    return response.chosenUuid ?? null;
  }

  // Hard GM fallback if the remote client never showed or never resolved the prompt.
  if (game.user?.isGM === true && fallbackGmUserId === game.user?.id) {
    return await promptSacrificialItem(actor, { hitLocationKey, allowWeaponSacrifice });
  }

  return null;
}

export async function promptSacrificialItemFromSocket(payload) {
  const currentUserId = game.user?.id ?? null;
  const promptUserId = payload?.promptUserId ?? null;
  const fallbackGmUserId = payload?.fallbackGmUserId ?? null;

  const shouldPromptHere =
    (promptUserId && promptUserId === currentUserId) ||
    (!promptUserId && fallbackGmUserId && fallbackGmUserId === currentUserId);

  if (!shouldPromptHere) return false;

  let actor = null;

  // Assigned player character is the source of truth for PC defenders.
  if (payload?.preferredCharacterActorId && game.user?.character?.id === payload.preferredCharacterActorId) {
    actor = game.user.character;
  }

  if (!actor && payload?.actorId && game.user?.character?.id === payload.actorId) {
    actor = game.user.character;
  }

  if (!actor && payload?.targetTokenUuid) {
    const tokenDoc = await resolveTokenDoc(payload.targetTokenUuid);
    actor = tokenDoc?.actor ?? null;
  }

  if (!actor && payload?.actorUuid) {
    try {
      actor = await fromUuid(payload.actorUuid);
    } catch (_e) {
      actor = null;
    }
  }

  if (!actor && payload?.actorId) {
    actor = game.actors?.get(payload.actorId) ?? null;
  }

  if (!actor && payload?.preferredCharacterActorId) {
    actor = game.actors?.get(payload.preferredCharacterActorId) ?? null;
  }

  if (!actor) {
    emitSocket(SOCKET_OPS.RESOLVE_SACRIFICIAL, {
      requestId: payload?.requestId ?? null,
      chosenUuid: null,
      failed: true,
      responderUserId: currentUserId
    });
    return false;
  }

  const chosenUuid = await promptSacrificialItem(actor, {
    hitLocationKey: payload?.hitLocationKey ?? "torso",
    allowWeaponSacrifice: payload?.allowWeaponSacrifice === true
  });

  emitSocket(SOCKET_OPS.RESOLVE_SACRIFICIAL, {
    requestId: payload?.requestId ?? null,
    targetTokenUuid: payload?.targetTokenUuid ?? null,
    actorUuid: payload?.actorUuid ?? null,
    actorId: payload?.actorId ?? null,
    chosenUuid: chosenUuid ?? null,
    failed: false,
    responderUserId: currentUserId
  });

  return true;
}

export async function resolveSacrificialItemPrompt(payload) {
  const requestId = String(payload?.requestId ?? "");
  if (!requestId) return false;

  const pending = _pendingSacrificialPrompts.get(requestId);
  if (!pending) return false;

  _pendingSacrificialPrompts.delete(requestId);
  if (pending.timer) globalThis.clearTimeout(pending.timer);

  pending.resolve({
    status: payload?.failed === true ? "failed" : "resolved",
    chosenUuid: payload?.chosenUuid ?? null,
    responderUserId: payload?.responderUserId ?? null
  });

  return true;
}

async function resolveTokenDoc(tokenUuid) {
  try {
    return await fromUuid(tokenUuid);
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

  if (!isAuthoritativeForDamageRoll(message)) return;
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

  const sysItemType = String(sysItem?.type ?? "");
  const weaponType = String(sysItem?.system?.weaponType ?? "");
  const defaultAttackType = sysItemType === "display" ? "threaten" : weaponType === "ranged" ? "ranged" : "melee";
  const itemName = sysItem?.name ?? flags.context?.itemName ?? game.i18n.localize("C2MQ.DamageRoller.Title");

  const params = await openDamageRollerDialog({ itemName, baseDice: spec.dice, defaultAttackType });
  if (!params) return;

  const diceTotal = Math.max(1, (Number(params.baseDice ?? spec.dice) || spec.dice) + (Number(params.bonusOther ?? 0) || 0) + (Number(params.bonusTalent ?? 0) || 0));
  const staticBonus = (Number(params.spendMomentum ?? 0) || 0) + (Number(params.spendDoom ?? 0) || 0);

  const rolled = await rollCombatDice(diceTotal);
  const total = (rolled.total ?? 0) + (spec.static ?? 0) + staticBonus;

  const normalizedDamageType = normalizeDamageType(spec.type ?? sysType);
  const hitLocationEnabled =
    getHitLocationEnabled() && normalizedDamageType === "physical";

  const byTarget = {};
  for (const t of flags.targets ?? []) {
    const key = safeTokenKey(t.tokenUuid);

    if (hitLocationEnabled) {
      const d20 = await new Roll("1d20").evaluate();
      const face = Number(d20.total ?? d20.result ?? 0);
      const hl = hitLocationFromD20(face);
      byTarget[key] = { d20: face, key: hl.key, label: hl.label };
    } else {
      byTarget[key] = { d20: null, key: null, label: null };
    }
  }
  const qualityMeta = buildDamageQualityMeta(sysItem, {
    damageType: normalizedDamageType,
    effects: rolled.effects ?? 0
  });

  const next = normalizeTokenKeyedFlags(flags);
  next.damage = {
    rolled: true,
    total,
    dice: diceTotal,
    baseDice: spec.dice,
    static: (spec.static ?? 0) + staticBonus,
    effects: rolled.effects ?? 0,
    faces: rolled.faces ?? [],
    type: normalizedDamageType,
    ignoreSoak: qualityMeta.ignoreSoak,
    intense: qualityMeta.intense,
    nonlethal: qualityMeta.nonlethal,
    qualityBonusDamage: qualityMeta.bonusDamage,
    attackType: params.attackType ?? defaultAttackType,
    bonus: {
      other: Number(params.bonusOther ?? 0) || 0,
      talent: Number(params.bonusTalent ?? 0) || 0
    },
    spends: {
      momentum: Number(params.spendMomentum ?? 0) || 0,
      doom: Number(params.spendDoom ?? 0) || 0
    }
  };
  next.hitLocation = { enabled: hitLocationEnabled, mode: "perTarget", byTarget };

  await setFlags(message, next);
  try { ui.chat?.render?.(true); } catch (_e) {}
  if (debugEnabled()) console.debug(`[${MODULE_ID}] rollDamage`, { messageId: message.id, spec, rolled, total, hitLocationEnabled });
}

export async function execApplyDamage(message, targetTokenUuid, { applyAll = false } = {}) {
  if (!message) return;
  const flags = getFlags(message);
  if (!flags?.damage?.rolled) return;

  if (!allowPlayerRequests() && !game.user?.isGM) return;
  if (!isAuthoritativeForApplyWorkflow(message)) return;

  const targets = flags.targets ?? [];
  const list = applyAll ? targets.map((t) => t.tokenUuid) : [targetTokenUuid].filter(Boolean);
  for (const tokenUuid of list) {
    await _applyToSingle(message, tokenUuid);
  }
}

async function _applyToSingle(message, tokenUuid) {
  const flags = getFlags(message);
  if (!flags) return;
  if (findAppliedEntry(flags, tokenUuid)) return;

  const appliedKey = safeTokenKey(tokenUuid);
  const tokenDoc = await resolveTokenDoc(tokenUuid);
  const actor = tokenDoc?.actor ?? null;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.TargetMissing"));
    return;
  }

  const damageType = normalizeDamageType(flags.damage?.type ?? "physical");
  const baseDamageTotal = Number(flags.damage?.total ?? 0) || 0;
  const qualityBonusDamage = Math.max(0, Number(flags.damage?.qualityBonusDamage ?? 0) || 0);
  const damageTotal = baseDamageTotal + qualityBonusDamage;
  const hit = findHitLocationEntry(flags, tokenUuid);
  const hitLocationKey = hit?.key ?? "torso";

  const soak = resolvePersistentSoak(actor, { damageType, hitLocationKey });
  const ignoreSoak = Math.max(0, Number(flags.damage?.ignoreSoak ?? 0) || 0);
  const reducedSoak = Math.max(0, soak - ignoreSoak);
  const netDamage = Math.max(0, damageTotal - reducedSoak);
  const { stressPath, harmPath } = resolveStressPaths(actor, damageType);
  if (!stressPath) {
    ui.notifications.error(game.i18n.localize("C2MQ.Err.StressPathMissing"));
    if (debugEnabled()) console.warn(`[${MODULE_ID}] Missing stressPath`, actor);
    return;
  }

  const beforeStress = Number(foundry.utils.getProperty(actor, stressPath) ?? 0) || 0;
  const afterStress = Math.max(0, beforeStress - netDamage);
  const patches = [{ path: stressPath, before: beforeStress, after: afterStress }];

  const nonlethal = flags.damage?.nonlethal === true;
  const intense = flags.damage?.intense === true;

  let harms = 0;
  if (netDamage > 0 && !nonlethal) {
    if (netDamage >= 5) harms += 1;
    if (beforeStress > 0 && afterStress === 0) harms += 1;
    else if (beforeStress === 0) harms += 1;
    if (intense && harms > 0) harms += 1;
  }

    const sacrificialEnabled = !!game.settings.get(MODULE_ID, SETTING_KEYS.SACRIFICIAL_ARMOR_ENABLED);
  const allowWeaponSacrifice = !!game.settings.get(MODULE_ID, SETTING_KEYS.SACRIFICIAL_WEAPONS_ENABLED);
  const sacUsage = getSacrificialUsageContext(actor, tokenDoc);
  const sacFlagPath = `flags.${MODULE_ID}.sacrificial`;
  const sacBefore = foundry.utils.getProperty(actor, sacFlagPath) ?? null;

  let sacrificedItem = null;
  let sacrificedItemMeta = null;
  let sacUsedNow = false;
  if (sacrificialEnabled && damageType === "physical" && harms > 0) {
    const alreadyUsed =
      sacUsage.limited &&
      sacBefore?.scopeType === sacUsage.scopeType &&
      sacBefore?.scopeId === sacUsage.scopeId &&
      sacBefore?.used === true &&
      Number.isFinite(Number(sacBefore?.usedAt));

    if (!alreadyUsed) {
      const chosenUuid = await requestSacrificialItem(actor, tokenDoc, { hitLocationKey, allowWeaponSacrifice });
      if (chosenUuid) {
        const item = await fromUuid(chosenUuid);
        if (item) {
          const kind = classifySacrificialKind(item);
          const sacrificialMeta = await applySacrificialSelection(item, {
            kind,
            hitLocationKey
          });

          if (sacrificialMeta) {
            sacrificedItem = item;
            sacrificedItemMeta = sacrificialMeta;
            sacUsedNow = true;
            harms = Math.max(0, harms - 1);
          }
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

    const trackBasePath = String(harmPath).endsWith(".value") ? String(harmPath).slice(0, -".value".length) : null;
    if (trackBasePath) {
      const kind = damageType === "mental" ? "trauma" : "wound";
      const dot = buildDotTrackUpdate(actor, { trackBasePath, afterValue: afterHarm, kind });
      if (dot?.patches?.length) patches.push(...dot.patches);
      if (dot?.update && Object.keys(dot.update).length) Object.assign(update, dot.update);
    }
  }

  if (sacUsedNow && sacUsage.limited) {
    const nextSac = {
      scopeType: sacUsage.scopeType,
      scopeId: sacUsage.scopeId,
      combatantId: sacUsage.combatantId,
      used: true,
      usedAt: Date.now(),
      usedBy: game.user?.id ?? null
    };

    patches.push({ path: sacFlagPath, before: sacBefore, after: nextSac });
    update[sacFlagPath] = nextSac;
  }

  await actor.update(update);

  const nextFlags = normalizeTokenKeyedFlags(flags);
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
      itemUuid: sacrificedItemMeta?.itemUuid ?? sacrificedItem?.uuid ?? null,
      itemId: sacrificedItemMeta?.itemId ?? sacrificedItem?.id ?? null,
      kind: sacrificedItemMeta?.kind ?? null,
      hitLocationKey: sacrificedItemMeta?.hitLocationKey ?? null,
      beforeBroken: sacrificedItemMeta?.beforeBroken ?? null,
      afterBroken: sacrificedItemMeta?.afterBroken ?? null,
      beforeCoverage: Array.isArray(sacrificedItemMeta?.beforeCoverage) ? sacrificedItemMeta.beforeCoverage : null,
      afterCoverage: Array.isArray(sacrificedItemMeta?.afterCoverage) ? sacrificedItemMeta.afterCoverage : null
    } : null
  };

  await setFlags(message, nextFlags);
  try { ui.chat?.render?.(true); } catch (_e) {}
  if (debugEnabled()) console.debug(`[${MODULE_ID}] apply`, { tokenUuid, damageTotal, soak, netDamage, harms, stressPath, harmPath });
}

async function _undoSingleAppliedEntry(message, targetTokenUuid) {
  if (!message || !targetTokenUuid) return false;

  const flags = getFlags(message);
  if (!flags) return false;

  const found = findAppliedEntry(flags, targetTokenUuid);
  if (!found) return false;
  const applied = found.value;

  const actor = applied.actorUuid ? await fromUuid(applied.actorUuid) : null;
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.TargetMissing"));
    return false;
  }

  const sac = applied?.sacrificial;
  if (sac?.itemUuid) {
    const it = await fromUuid(sac.itemUuid);
    if (it) {
      const itemUpdate = {
        "system.broken": sac.beforeBroken === true
      };

      if (sac.kind === "armor" && Array.isArray(sac.beforeCoverage)) {
        itemUpdate["system.coverage.value"] = sac.beforeCoverage;
      }

      await it.update(itemUpdate);
    }
  }

  const update = {};
  for (const p of applied.patches ?? []) update[p.path] = p.before;
  await actor.update(update);

  const nextFlags = normalizeTokenKeyedFlags(flags);
  const delKey = safeTokenKey(targetTokenUuid);
  delete nextFlags.applied?.[delKey];

  await message.update({
    [`flags.${MODULE_ID}`]: nextFlags,
    [`flags.${MODULE_ID}.applied.-=${delKey}`]: null,
    [`flags.${MODULE_ID}.applied.-=Scene`]: null
  });

  if (debugEnabled()) {
    console.debug(`[${MODULE_ID}] undo`, { targetTokenUuid, actor: actor.uuid });
  }

  return true;
}

export async function execUndoDamage(message, targetTokenUuid) {
  if (!message || !targetTokenUuid) return;
  const flags = getFlags(message);
  if (!flags) return;

  if (!allowPlayerRequests() && !game.user?.isGM) return;
  if (!isAuthoritativeForApplyWorkflow(message)) return;

  const found = findAppliedEntry(flags, targetTokenUuid);
  if (!found) return;

  const confirm = await Dialog.confirm({
    title: game.i18n.localize("C2MQ.Dialog.Undo.Title"),
    content: `<p>${game.i18n.localize("C2MQ.Dialog.Undo.Content")}</p>`,
    defaultYes: false
  });
  if (!confirm) return;

  await _undoSingleAppliedEntry(message, targetTokenUuid);
  try { ui.chat?.render?.(true); } catch (_e) {}
}

export async function execUndoAll(message) {
  if (!message) return;
  const flags = getFlags(message);
  if (!flags) return;

  if (!allowPlayerRequests() && !game.user?.isGM) return;
  if (!isAuthoritativeForApplyWorkflow(message)) return;

  const targets = Array.isArray(flags.targets) ? flags.targets : [];
  const appliedUuids = targets
    .map((target) => target?.tokenUuid)
    .filter((tokenUuid) => !!tokenUuid && !!findAppliedEntry(flags, tokenUuid));

  if (!appliedUuids.length) return;

  const confirm = await Dialog.confirm({
    title: game.i18n.localize("C2MQ.Dialog.UndoAll.Title"),
    content: `<p>${game.i18n.localize("C2MQ.Dialog.UndoAll.Content")}</p>`,
    defaultYes: false
  });
  if (!confirm) return;

  for (const tokenUuid of appliedUuids) {
    await _undoSingleAppliedEntry(message, tokenUuid);
  }

  try { ui.chat?.render?.(true); } catch (_e) {}
}