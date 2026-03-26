import { MODULE_ID, SETTING_KEYS, REACTION_KINDS, ATTACK_TYPES } from "../constants.js";
import {
  requestRollDamage,
  requestApplyDamage,
  requestUndoDamage,
  requestApplyAll,
  requestSetTargets,
  requestRemoveTarget,
  requestBreakGuard
} from "../socket.js";
import {
  execRollDamage,
  execApplyDamage,
  execUndoDamage
} from "../workflows/damage-workflow.js";
import { execBreakGuard } from "../workflows/guard-workflow.js";
import {
  ensureMessageFlags,
  isDamageCapableRoll,
  isSuccessfulRoll,
  isStandaloneDamageCardMessage,
  collectCurrentTargets,
  classifyAttackType
} from "../workflows/message-flags.js";
import { dispatchCreatedChatMessage } from "../workflows/message-dispatcher.js";

let _hooksRegistered = false;
let _delegatedBound = false;

function hasActiveGM() {
  return game.users?.some((user) => user.active && user.isGM);
}

function allowPlayerRequests() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.ALLOW_PLAYERS_REQUEST_APPLY);
}

function getRootEl(html) {
  if (!html) return null;
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

async function refreshRenderedMessage(message) {
  if (!message?.id) return false;

  const node = document.querySelector?.(`.chat-message[data-message-id="${message.id}"]`)
    ?? document.querySelector?.(`[data-message-id="${message.id}"]`);
  if (!node) return false;

  await injectMinQolBlock(message, node);
  return true;
}

/**
 * IMPORTANT:
 * Never use raw tokenUuid as an object key inside flags, because "." gets expanded into nested objects.
 * We display and check state using a safe key (no dots) and also support legacy nested formats.
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

function getTokenKeyedEntry(map, tokenUuid) {
  if (!map) return null;
  const safe = safeTokenKey(tokenUuid);
  return map?.[safe] ?? map?.[tokenUuid] ?? getLegacyNestedEntry(map, tokenUuid) ?? null;
}

function removeTokenKeyedEntry(map, tokenUuid) {
  if (!map || !tokenUuid) return;

  delete map[safeTokenKey(tokenUuid)];
  delete map[tokenUuid];

  const ids = parseSceneTokenFromUuid(tokenUuid);
  if (!ids) return;

  if (map.Scene?.[ids.sceneId]?.Token) {
    delete map.Scene[ids.sceneId].Token[ids.tokenId];
    if (!Object.keys(map.Scene[ids.sceneId].Token).length) delete map.Scene[ids.sceneId].Token;
    if (!Object.keys(map.Scene[ids.sceneId]).length) delete map.Scene[ids.sceneId];
    if (!Object.keys(map.Scene).length) delete map.Scene;
  }
}

async function removeTargetFromMessage(message, targetTokenUuid) {
  if (!message || !targetTokenUuid) return;

  const flags = message.flags?.[MODULE_ID];
  if (!flags) return;

  const next = foundry.utils.duplicate(flags);
  next.targets = (Array.isArray(next.targets) ? next.targets : [])
    .filter((target) => target?.tokenUuid !== targetTokenUuid);

  next.applied = next.applied ?? {};
  next.hitLocation = next.hitLocation ?? { enabled: false, mode: "perTarget", byTarget: {} };
  next.hitLocation.byTarget = next.hitLocation.byTarget ?? {};

  removeTokenKeyedEntry(next.applied, targetTokenUuid);
  removeTokenKeyedEntry(next.hitLocation.byTarget, targetTokenUuid);

  await message.update({ [`flags.${MODULE_ID}`]: next });
}

function buildSyncedTargetsUpdate(flags, selectedTargets = []) {
  const next = foundry.utils.duplicate(flags ?? {});
  const previousTargets = Array.isArray(next.targets) ? next.targets : [];
  const hadStoredTargets = previousTargets.length > 0;

  next.hitLocation = next.hitLocation ?? {
    enabled: false,
    mode: "perTarget",
    seed: null,
    byTarget: {}
  };
  next.hitLocation.byTarget = next.hitLocation.byTarget ?? {};

  const existingSeed =
    next.hitLocation.seed ??
    Object.values(next.hitLocation.byTarget).find((entry) => entry?.key || entry?.label) ??
    null;

  next.hitLocation.seed = existingSeed ? foundry.utils.duplicate(existingSeed) : null;
  next.targets = hadStoredTargets ? [] : (Array.isArray(selectedTargets) ? selectedTargets : []);
  next.applied = {};

  next.hitLocation.byTarget = {};
  if (!hadStoredTargets && next.hitLocation.seed && next.targets.length) {
    for (const target of next.targets) {
      if (!target?.tokenUuid) continue;
      next.hitLocation.byTarget[safeTokenKey(target.tokenUuid)] =
        foundry.utils.duplicate(next.hitLocation.seed);
    }
  }

  next.spends = next.spends ?? {};
  next.spends.breakGuard = {};

  return next;
}

function isAppliedForToken(appliedMap, tokenUuid) {
  return !!getTokenKeyedEntry(appliedMap, tokenUuid);
}

function getReactionDisplayPrefix(kind) {
  const reactionKind = kind ?? REACTION_KINDS.DEFEND;

  if (reactionKind === REACTION_KINDS.DEFEND) {
    return "C2MQ.Reaction.Defend";
  }

  if (reactionKind === REACTION_KINDS.PROTECT) {
    return "C2MQ.Reaction.Protect";
  }

  return null;
}

function isMiniQolEligibleMessage(message) {
  if (isStandaloneDamageCardMessage(message)) return true;
  return isSuccessfulRoll(message) && isDamageCapableRoll(message);
}

function getReactionDisplayState(flags) {
  const reaction = flags?.reaction ?? {};
  const kind = reaction.kind ?? REACTION_KINDS.DEFEND;
  const phase = reaction.phase ?? "none";
  const outcome = reaction.outcome ?? null;
  const prefix = getReactionDisplayPrefix(kind);

  const state = {
    visible: false,
    label: "",
    detail: "",
    blocksDamage: false,
    outcomeMiss: false
  };

  if (phase === "none" || !prefix) return state;

  state.visible = true;

  if (phase === "prompted") {
    state.label = game.i18n.localize(`${prefix}.Available`);
    state.blocksDamage = true;
    return state;
  }

  if (phase === "rolling") {
    state.label = game.i18n.localize(`${prefix}.Pending`);
    state.blocksDamage = true;
    return state;
  }

  if (phase === "declined") {
    state.label = game.i18n.localize(`${prefix}.Declined`);
    return state;
  }

  if (phase === "resolved" && outcome === "miss") {
    state.label = game.i18n.localize(`${prefix}.ResolvedMiss`);
    state.outcomeMiss = true;
    return state;
  }

  if (phase === "resolved" && outcome === "hit") {
    if (kind === REACTION_KINDS.PROTECT && Number(reaction.defenseSuccesses ?? 0) <= 0) {
      state.label = game.i18n.localize("C2MQ.Reaction.Protect.ResolvedFailed");
      return state;
    }

    state.label = game.i18n.localize(`${prefix}.ResolvedHit`);
    return state;
  }

  return state;
}

function getCombatDieDisplay(face) {
  const n = Number(face ?? 0) || 0;
  return n > 0 && n <= 2 ? String(n) : "&nbsp;";
}

function buildDamageEffectTags(damage = {}) {
  const tags = [];

  const piercing = Math.max(0, Number(damage.ignoreSoak ?? 0) || 0);
  if (piercing > 0) {
    tags.push({
      label: game.i18n.format("C2MQ.Tag.Piercing", { value: piercing })
    });
  }

  const bonusDamage = Math.max(0, Number(damage.qualityBonusDamage ?? 0) || 0);
  if (bonusDamage > 0) {
    tags.push({
      label: game.i18n.format("C2MQ.Tag.BonusDamage", { value: bonusDamage })
    });
  }

  if (damage.intense === true) {
    tags.push({ label: game.i18n.localize("C2MQ.Tag.Intense") });
  }

  if (damage.nonlethal === true) {
    tags.push({ label: game.i18n.localize("C2MQ.Tag.Nonlethal") });
  }

  return tags;
}

function buildDamageDetailView(flags) {
  const damage = flags?.damage ?? {};
  const faces = Array.isArray(damage.faces) ? damage.faces : [];
  const damageType = String(damage.type ?? "physical").trim().toLowerCase() === "mental"
    ? "mental"
    : "physical";

  const dice = faces.map((face) => ({
    face: Number(face ?? 0) || 0,
    display: getCombatDieDisplay(face)
  }));

  const effectTags = buildDamageEffectTags(damage);

  return {
    dice,
    hasDice: dice.length > 0,
    damageType,
    damageTypeLabel: game.i18n.localize(
      damageType === "mental"
        ? "C2MQ.DamageType.Mental"
        : "C2MQ.DamageType.Physical"
    ),
    effects: Math.max(0, Number(damage.effects ?? 0) || 0),
    spendMomentum: Math.max(0, Number(damage.spends?.momentum ?? 0) || 0),
    spendDoom: Math.max(0, Number(damage.spends?.doom ?? 0) || 0),
    hasSpendMomentum: (Number(damage.spends?.momentum ?? 0) || 0) > 0,
    hasSpendDoom: (Number(damage.spends?.doom ?? 0) || 0) > 0,
    effectTags,
    hasEffectTags: effectTags.length > 0
  };
}

async function resolveTokenDoc(tokenUuid) {
  try {
    return await fromUuid(tokenUuid);
  } catch (_e) {
    return null;
  }
}

function hasGuardBrokenEffect(actor) {
  return actor?.effects?.some((effect) => {
    const statuses = effect?.statuses ?? effect?._source?.statuses;
    if (!statuses) return false;
    if (statuses instanceof Set) return statuses.has("guardBroken");
    if (Array.isArray(statuses)) return statuses.includes("guardBroken");
    return false;
  }) === true;
}

function getMessageMomentum(message) {
  return Math.max(0, Number(message?.flags?.data?.results?.momentum ?? 0) || 0);
}

function getAttackTypeForMessage(message, flags) {
  return String(
    flags?.damage?.attackType ??
    flags?.reaction?.attackType ??
    classifyAttackType(message) ??
    ""
  ).trim().toLowerCase();
}

function hasBreakGuardSpendApplied(flags, tokenUuid) {
  const entry = getTokenKeyedEntry(flags?.spends?.breakGuard ?? {}, tokenUuid);
  return entry?.applied === true;
}

function canUserOperateBreakGuard(message) {
  return game.user?.isGM === true || message?.author?.id === game.user?.id;
}

function makeMomentumSpendRow(key, { highlighted = false } = {}) {
  return {
    cost: game.i18n.localize(`C2MQ.MomentumSpend.${key}.Cost`),
    title: game.i18n.localize(`C2MQ.MomentumSpend.${key}.Title`),
    detail: game.i18n.localize(`C2MQ.MomentumSpend.${key}.Detail`),
    highlighted
  };
}

function buildMomentumSpendView(message, flags, reaction, targetRows) {
  const momentum = getMessageMomentum(message);
  if (momentum <= 0) {
    return { visible: false, momentum: 0, rows: [] };
  }

  if (reaction.blocksDamage || reaction.outcomeMiss) {
    return { visible: false, momentum: 0, rows: [] };
  }

  const attackType = getAttackTypeForMessage(message, flags);
  const isThreaten = attackType === ATTACK_TYPES.THREATEN;
  const isPhysical = String(flags?.damage?.type ?? "physical").trim().toLowerCase() === "physical";
  const hasRolledDamage = flags?.damage?.rolled === true;
  const hasDamageDice = Array.isArray(flags?.damage?.faces) && flags.damage.faces.length > 0;
  const hasSingleTarget = targetRows.length === 1;

  const breakGuardAvailable = targetRows.some((row) => row.canBreakGuard === true);

  // Conservative highlighting:
  // highlight only when the current card context clearly supports the spend.
  const rows = [
    makeMomentumSpendRow("BonusDamage", { highlighted: true }),
    makeMomentumSpendRow("BreakGuard", { highlighted: breakGuardAvailable }),
    makeMomentumSpendRow("CalledShot", { highlighted: isPhysical && !hasRolledDamage }),
    makeMomentumSpendRow("ChangeStance", { highlighted: true }),
    makeMomentumSpendRow("Confidence", { highlighted: true }),
    makeMomentumSpendRow("Disarm", { highlighted: hasSingleTarget && !isThreaten }),
    makeMomentumSpendRow("Penetration", { highlighted: isPhysical }),
    makeMomentumSpendRow("ReRollDamage", { highlighted: hasRolledDamage && hasDamageDice }),
    makeMomentumSpendRow("SecondWind", { highlighted: false }),
    makeMomentumSpendRow("SecondaryTarget", { highlighted: targetRows.length > 1 }),
    makeMomentumSpendRow("Subdue", { highlighted: isPhysical }),
    makeMomentumSpendRow("SwiftAction", { highlighted: momentum >= 2 }),
    makeMomentumSpendRow("Withdraw", { highlighted: hasSingleTarget && !isThreaten })
  ];

  return {
    visible: rows.length > 0,
    momentum,
    rows
  };
}

async function injectMinQolBlock(message, root) {
  if (!message || !root) return;
  if (game.system?.id !== "conan2d20") return;

  if (!isMiniQolEligibleMessage(message)) return;

  const existingBlock = root.querySelector?.(".c2d20-miniqol");
  if (existingBlock) existingBlock.remove();

  if (!message.flags?.[MODULE_ID]) {
    const canWrite = game.user?.isGM === true || message?.author?.id === game.user?.id;
    if (canWrite) await ensureMessageFlags(message);
  }

  const liveMessage = game.messages?.get(message.id) ?? message;
  const flags = liveMessage.flags?.[MODULE_ID] ?? {
    targets: [],
    applied: {},
    hitLocation: { byTarget: {} },
    damage: { rolled: false, total: null }
  };

  const canApplyOperate =
    game.user?.isGM === true ||
    (allowPlayerRequests() && liveMessage?.author?.id === game.user?.id);
  const canUndoOperate = game.user?.isGM === true;
  const reaction = getReactionDisplayState(flags);

  const targets = flags.targets ?? [];
  const applied = flags.applied ?? {};
  const hitByTarget = flags.hitLocation?.byTarget ?? {};
  const canBreakGuardOperate = canUserOperateBreakGuard(liveMessage);
  const showBreakGuardHelper =
    !!game.settings.get(MODULE_ID, SETTING_KEYS.PROMPT_BREAK_GUARD) &&
    canBreakGuardOperate &&
    getMessageMomentum(liveMessage) >= 2 &&
    getAttackTypeForMessage(liveMessage, flags) !== ATTACK_TYPES.THREATEN &&
    !reaction.blocksDamage &&
    !reaction.outcomeMiss &&
    targets.length === 1;

  const targetRows = await Promise.all(targets.map(async (target) => {
    const appliedToTarget = isAppliedForToken(applied, target.tokenUuid);
    const hit = getTokenKeyedEntry(hitByTarget, target.tokenUuid);
    const tokenDoc = await resolveTokenDoc(target.tokenUuid);
    const actor = tokenDoc?.actor ?? null;
    const guardBroken = hasGuardBrokenEffect(actor);
    const breakGuardApplied = hasBreakGuardSpendApplied(flags, target.tokenUuid);

    return {
      tokenUuid: target.tokenUuid,
      name: target.name,
      statusLabel: appliedToTarget
        ? game.i18n.localize("C2MQ.Status.Applied")
        : game.i18n.localize("C2MQ.Status.Pending"),
      statusClass: appliedToTarget ? "applied" : "pending",
      hitLocationLabel: hit?.label
        ? `${game.i18n.localize("C2MQ.Label.HitLocation")}: ${hit.label}`
        : "",
      guardStateLabel: (guardBroken || breakGuardApplied)
        ? game.i18n.localize("C2MQ.Status.NoGuard")
        : "",
      canApply: canApplyOperate && flags.damage?.rolled && !appliedToTarget && !reaction.blocksDamage && !reaction.outcomeMiss,
      canUndo: canUndoOperate && appliedToTarget && !reaction.blocksDamage && !reaction.outcomeMiss,
      canRemove: canApplyOperate && !appliedToTarget,
      canBreakGuard: showBreakGuardHelper && !!actor && !guardBroken && !breakGuardApplied
    };
  }));

  const showApplyAll =
    canApplyOperate &&
    !!game.settings.get(MODULE_ID, SETTING_KEYS.SHOW_APPLY_ALL) &&
    flags.damage?.rolled &&
    targets.length > 1 &&
    !reaction.blocksDamage &&
    !reaction.outcomeMiss;

  const data = {
    messageId: liveMessage.id,
    canRollDamage:
      (game.user?.isGM === true || liveMessage?.author?.id === game.user?.id) &&
      !reaction.blocksDamage &&
      !reaction.outcomeMiss,
    damage: flags.damage ?? { rolled: false },
    damageDetail: buildDamageDetailView(flags),
    momentumSpends: buildMomentumSpendView(liveMessage, flags, reaction, targetRows),
    reaction,
    targetRows,
    currentUserHasTargets: (game.user?.targets?.size ?? 0) > 0,
    hasTargets: targetRows.length > 0,
    showApplyAll,
    canSetTargets: canApplyOperate,
    isFallback: !liveMessage.flags?.[MODULE_ID]
  };

  const templatePath = `modules/${MODULE_ID}/templates/chat/miniqol-controls.hbs`;
  const blockHtml = await renderTemplate(templatePath, data);

  const contentEl = root.querySelector(".message-content") ?? root;
  contentEl.insertAdjacentHTML("beforeend", blockHtml);
}

function bindDelegatedClicksOnce() {
  if (_delegatedBound) return;
  _delegatedBound = true;

  document.addEventListener("click", async (event) => {
    const button = event.target?.closest?.(".c2d20-miniqol button[data-action]");
    if (!button) return;

    const container = button.closest(".c2d20-miniqol");
    const messageId = container?.dataset?.messageId;
    if (!messageId) return;

    const message = game.messages?.get(messageId);
    if (!message) return;

    const action = button.dataset.action;
    const targetTokenUuid = button.dataset.targetUuid ?? null;

    const useSocket = hasActiveGM() ? !game.user.isGM : false;
    const useSocketForRoll = hasActiveGM()
      ? !(game.user?.isGM === true || message?.author?.id === game.user?.id)
      : false;

    if (action === "roll-damage") {
      event.preventDefault();
      event.stopPropagation();

      if (useSocketForRoll) return requestRollDamage(messageId);

      const canWrite = game.user?.isGM === true || message?.author?.id === game.user?.id;
      if (!message.flags?.[MODULE_ID] && canWrite) await ensureMessageFlags(message);

      const fresh = game.messages?.get(messageId) ?? message;
      await execRollDamage(fresh);

      try {
        ui.chat?.render?.(true);
      } catch (_e) {
        // Ignore chat re-render failures.
      }
      return;
    }

    const canApplyOperate =
      game.user?.isGM === true ||
      (allowPlayerRequests() && message?.author?.id === game.user?.id);

    if (action === "apply") {
      if (!canApplyOperate) return;
      event.preventDefault();
      event.stopPropagation();
      if (!targetTokenUuid) return;

      if (useSocket) requestApplyDamage(messageId, targetTokenUuid);
      else await execApplyDamage(game.messages?.get(messageId) ?? message, targetTokenUuid);
      return;
    }

    if (action === "undo") {
      if (game.user?.isGM !== true) return;

      event.preventDefault();
      event.stopPropagation();
      if (!targetTokenUuid) return;

      await execUndoDamage(game.messages?.get(messageId) ?? message, targetTokenUuid);
      return;
    }

    if (action === "apply-all") {
      if (!canApplyOperate) return;

      event.preventDefault();
      event.stopPropagation();

      if (useSocket) requestApplyAll(messageId);
      else await execApplyDamage(game.messages?.get(messageId) ?? message, null, { applyAll: true });
      return;
    }

    if (action === "set-targets") {
      if (!canApplyOperate) return;

      event.preventDefault();
      event.stopPropagation();

      const targets = collectCurrentTargets();

      if (useSocket) {
        requestSetTargets(messageId, targets);
        return;
      }

      const flags = message.flags?.[MODULE_ID];
      if (!flags) return;

      const next = buildSyncedTargetsUpdate(flags, targets);
      await message.update({ [`flags.${MODULE_ID}`]: next });

      try {
        ui.chat?.render?.(true);
      } catch (_e) {
        // Ignore chat re-render failures.
      }
      return;
    }

    if (action === "break-guard") {
      const canBreakGuardOperate =
        game.user?.isGM === true ||
        message?.author?.id === game.user?.id;

      if (!canBreakGuardOperate) return;

      event.preventDefault();
      event.stopPropagation();
      if (!targetTokenUuid) return;

      if (useSocket) {
        requestBreakGuard(messageId, targetTokenUuid);
        return;
      }

      await execBreakGuard(game.messages?.get(messageId) ?? message, targetTokenUuid);
      return;
    }
  });
}

export function registerChatHooks() {
  if (_hooksRegistered) return;
  _hooksRegistered = true;

  bindDelegatedClicksOnce();

  Hooks.on("createChatMessage", async (message) => {
    try {
      await dispatchCreatedChatMessage(message);
    } catch (e) {
      console.error(`[${MODULE_ID}] createChatMessage error`, e);
    }
  });

  Hooks.on("renderChatMessage", async (message, html) => {
    try {
      const root = getRootEl(html);
      if (!root) return;
      await injectMinQolBlock(message, root);
    } catch (e) {
      console.error(`[${MODULE_ID}] renderChatMessage error`, e);
    }
  });

  Hooks.on("updateChatMessage", async (message) => {
    try {
      const refreshed = game.messages?.get(message.id) ?? message;
      const handled = await refreshRenderedMessage(refreshed);

      if (!handled) {
        try {
          ui.chat?.render?.(true);
        } catch (_e) {
          // Ignore chat re-render failures.
        }
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] updateChatMessage error`, e);
    }
  });

  Hooks.on("renderChatLog", async (_app, html) => {
    try {
      const root = getRootEl(html);
      if (!root) return;

      const nodes = root.querySelectorAll?.("li.chat-message[data-message-id]") ?? [];
      for (const li of nodes) {
        const messageId = li.dataset.messageId;
        const message = game.messages?.get(messageId);
        if (!message) continue;

        await injectMinQolBlock(message, li);
      }
    } catch (e) {
      console.error(`[${MODULE_ID}] renderChatLog inject error`, e);
    }
  });
}