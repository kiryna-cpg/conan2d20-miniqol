import { MODULE_ID, SETTING_KEYS, SOCKET_NAME, SOCKET_OPS } from "../constants.js";
import { adjustPoolValue } from "../adapter/pool-tracker.js";
import { execBreakGuard } from "./guard-workflow.js";
import { execDisarm } from "./disarm-workflow.js";
import { isDisarmableItem } from "../utils/npc-attack-equipment.js";

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function safeTokenKey(tokenUuid) {
  const raw = String(tokenUuid ?? "");
  return encodeURIComponent(raw).replaceAll(".", "%2E");
}

function hasActiveGM() {
  return game.users?.some((user) => user.active && user.isGM) === true;
}

function requestDisarm(messageId, allocation) {
  game.socket.emit(SOCKET_NAME, {
    op: SOCKET_OPS.DISARM,
    messageId,
    allocation: foundry.utils.duplicate(allocation ?? {}),
    requesterUserId: game.user?.id ?? null
  });
}

const PRONE_STATUS_ID = "prone";

const CALLED_SHOT_LOCATIONS = [
  { key: "head", labelKey: "CONAN.Item.Armor.Coverage.Head" },
  { key: "torso", labelKey: "CONAN.Item.Armor.Coverage.Torso" },
  { key: "rarm", labelKey: "CONAN.Item.Armor.Coverage.RightArm" },
  { key: "larm", labelKey: "CONAN.Item.Armor.Coverage.LeftArm" },
  { key: "rleg", labelKey: "CONAN.Item.Armor.Coverage.RightLeg" },
  { key: "lleg", labelKey: "CONAN.Item.Armor.Coverage.LeftLeg" }
];

function localizeCoverageKey(locationKey) {
  const labelKey = CONFIG.CONAN?.coverageTypes?.[locationKey]
    ?? CALLED_SHOT_LOCATIONS.find((loc) => loc.key === locationKey)?.labelKey
    ?? locationKey;
  return game.i18n.localize(labelKey);
}

function getCalledShotLocation(locationKey) {
  const key = String(locationKey ?? "").trim();
  if (!CALLED_SHOT_LOCATIONS.some((loc) => loc.key === key)) return null;

  return {
    d20: null,
    key,
    label: localizeCoverageKey(key),
    source: "calledShot"
  };
}

function buildCalledShotOptions() {
  return [
    `<option value="">${game.i18n.localize("C2MQ.Dialog.Momentum.NoCalledShot")}</option>`,
    ...CALLED_SHOT_LOCATIONS.map((loc) =>
      `<option value="${loc.key}">${foundry.utils.escapeHTML(localizeCoverageKey(loc.key))}</option>`
    )
  ].join("");
}

async function resolveTokenDoc(tokenUuid) {
  try {
    return await fromUuid(tokenUuid);
  } catch (_e) {
    return null;
  }
}

function hasIronGrasp(actor) {
  const names = Array.from(actor?.items ?? [])
    .filter((item) => item?.type === "talent")
    .map((item) => String(item?.name ?? "").trim().toLowerCase());

  return names.some((name) => name === "iron grasp" || name === "agarre de hierro");
}

function getDisarmCostForWeapon(item) {
  const size = String(item?.system?.size ?? "").trim();
  if (!size || size === "oneHanded") return 2;
  return 3;
}

function getWeaponSizeLabel(item) {
  const size = String(item?.system?.size ?? "").trim();
  const labelKey = size ? CONFIG.CONAN?.weaponSizes?.[size] ?? null : null;
  return labelKey ? game.i18n.localize(labelKey) : "";
}

async function getDisarmCandidates(flags) {
  const targets = Array.isArray(flags?.targets) ? flags.targets : [];
  const candidates = [];

  for (const target of targets) {
    if (!target?.tokenUuid) continue;

    const tokenDoc = await resolveTokenDoc(target.tokenUuid);
    const actor = tokenDoc?.actor ?? null;
    if (!actor || hasIronGrasp(actor)) continue;

    for (const item of Array.from(actor.items ?? [])) {
      if (!isDisarmableItem(item)) continue;

      const cost = getDisarmCostForWeapon(item);
      candidates.push({
        tokenUuid: target.tokenUuid,
        targetName: target.name ?? tokenDoc.name ?? actor.name ?? "Target",
        actorUuid: actor.uuid ?? null,
        itemUuid: item.uuid ?? null,
        itemId: item.id,
        itemName: item.name,
        size: String(item.system?.size ?? ""),
        sizeLabel: getWeaponSizeLabel(item),
        cost,
        spent: cost
      });
    }
  }

  return candidates;
}

function buildDisarmOptions(candidates, generated) {
  return [
    `<option value="">${game.i18n.localize("C2MQ.Dialog.Momentum.NoDisarm")}</option>`,
    ...candidates.map((candidate, index) => {
      const labelParts = [candidate.targetName, candidate.itemName].filter(Boolean).join(": ");
      const size = candidate.sizeLabel ? ` · ${candidate.sizeLabel}` : "";
      const label = `${labelParts}${size} (${candidate.cost})`;
      const disabled = candidate.cost > generated ? " disabled" : "";
      return `<option value="${index}"${disabled}>${foundry.utils.escapeHTML(label)}</option>`;
    })
  ].join("");
}

function hasAppliedDamage(flags) {
  const stack = [flags?.applied ?? {}];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (current.state === "applied") return true;
    stack.push(...Object.values(current));
  }
  return false;
}

function applyCalledShotToHitLocations(flags, calledShot) {
  const hit = getCalledShotLocation(calledShot?.key);
  if (!hit) return;

  flags.hitLocation = {
    ...(flags.hitLocation ?? {}),
    enabled: true,
    mode: "perTarget",
    seed: foundry.utils.duplicate(hit),
    byTarget: {}
  };

  for (const target of Array.isArray(flags.targets) ? flags.targets : []) {
    if (!target?.tokenUuid) continue;
    flags.hitLocation.byTarget[safeTokenKey(target.tokenUuid)] = foundry.utils.duplicate(hit);
  }
}

function getMessageTokenDoc(message) {
  const sceneId = message?.speaker?.scene ?? null;
  const tokenId = message?.speaker?.token ?? null;
  if (!sceneId || !tokenId) return null;

  return game.scenes?.get(sceneId)?.tokens?.get(tokenId)
    ?? (canvas?.scene?.id === sceneId ? canvas.scene?.tokens?.get(tokenId) ?? null : null)
    ?? null;
}

function getMessageTokenUuid(message) {
  const tokenDoc = getMessageTokenDoc(message);
  return tokenDoc?.uuid ?? null;
}

function getMessageActor(message) {
  const tokenActor = getMessageTokenDoc(message)?.actor ?? null;
  if (tokenActor) return tokenActor;

  const actorId =
    message?.speaker?.actor ??
    message?.flags?.data?.actor?._id ??
    message?.flags?.data?.rollData?.actorId ??
    null;

  return actorId ? game.actors?.get(actorId) ?? null : null;
}

function effectHasStatus(effect, statusId) {
  const statuses = effect?.statuses ?? effect?._source?.statuses;
  if (!statuses) return false;
  if (statuses instanceof Set) return statuses.has(statusId);
  if (Array.isArray(statuses)) return statuses.includes(statusId);
  return false;
}

function findStatusEffect(actor, statusId) {
  return actor?.effects?.find((effect) => !effect.disabled && effectHasStatus(effect, statusId)) ?? null;
}

function hasProneEffect(actor) {
  return !!findStatusEffect(actor, PRONE_STATUS_ID);
}

function getChangeStanceState(message, actor) {
  const currentProne = hasProneEffect(actor);
  const nextProne = !currentProne;

  return {
    currentProne,
    nextProne,
    action: nextProne ? "goProne" : "standUp",
    label: game.i18n.localize(nextProne
      ? "C2MQ.Dialog.Momentum.ChangeStanceGoProne"
      : "C2MQ.Dialog.Momentum.ChangeStanceStandUp"),
    actorUuid: actor?.uuid ?? null,
    tokenUuid: getMessageTokenUuid(message)
  };
}

async function setActorProne(actor, active) {
  if (!actor) return false;

  const shouldBeProne = active === true;
  if (hasProneEffect(actor) === shouldBeProne) return true;

  if (typeof actor.toggleStatusEffect === "function") {
    await actor.toggleStatusEffect(PRONE_STATUS_ID, { active: shouldBeProne });
  }
  else if (shouldBeProne && typeof actor.addCondition === "function") {
    await actor.addCondition(PRONE_STATUS_ID);
  }
  else if (!shouldBeProne && typeof actor.removeCondition === "function") {
    await actor.removeCondition(PRONE_STATUS_ID);
  }
  else if (!shouldBeProne) {
    const existing = findStatusEffect(actor, PRONE_STATUS_ID);
    if (existing?.id) await actor.deleteEmbeddedDocuments("ActiveEffect", [existing.id]);
  }

  try {
    if (canvas?.tokens?.hud?.object?.actor?.uuid === actor.uuid) {
      canvas.tokens.hud.refreshStatusIcons();
    }
  } catch (_e) {
    // Ignore HUD refresh failures.
  }

  return hasProneEffect(actor) === shouldBeProne;
}

function getBankType(message, actor) {
  const explicit = String(message?.flags?.data?.rollData?.bankType ?? "").trim().toLowerCase();
  if (explicit === "momentum" || explicit === "doom") return explicit;

  return String(actor?.type ?? "").trim().toLowerCase() === "npc" ? "doom" : "momentum";
}

export function getGeneratedMomentum(message) {
  return toInt(message?.flags?.data?.results?.momentum, 0);
}

function buildDefaultMomentumPlan(message, actor) {
  return {
    schema: 1,
    committed: false,
    generated: getGeneratedMomentum(message),
    spent: 0,
    banked: 0,
    bankType: getBankType(message, actor),
    committedAt: null,
    committedByUserId: null,
    allocations: {
      bonusDamage: 0,
      penetration: 0,
      subdue: false,
      calledShot: null,
      changeStance: null,
      secondWind: null,
      rerollDamage: null,
      breakGuard: null,
      disarm: null
    }
  };
}

export function getMomentumPlan(flags, message) {
  const actor = getMessageActor(message);
  const base = buildDefaultMomentumPlan(message, actor);
  const stored = foundry.utils.duplicate(flags?.momentum ?? {});

  const merged = foundry.utils.mergeObject(base, stored, {
    inplace: false,
    insertKeys: true,
    insertValues: true,
    overwrite: true
  });

  // Until the player confirms a spend/bank decision, the live roll remains
  // the source of truth for generated Momentum.
  if (merged.committed !== true) {
    merged.generated = base.generated;
    if (!merged.bankType) merged.bankType = base.bankType;
    merged.spent = 0;
    merged.banked = 0;
    merged.committedAt = null;
    merged.committedByUserId = null;
    merged.allocations = {
      bonusDamage: 0,
      penetration: 0,
      subdue: false,
      calledShot: null,
      changeStance: null,
      secondWind: null,
      rerollDamage: null,
      breakGuard: null,
      disarm: null
    };
  }

  return merged;
}

export function hasCommittedMomentumPlan(flags) {
  return flags?.momentum?.committed === true;
}

export function getCommittedBonusDamage(flags) {
  return toInt(flags?.momentum?.allocations?.bonusDamage, 0);
}

export function getCommittedPenetration(flags) {
  return toInt(flags?.momentum?.allocations?.penetration, 0);
}

export function getCommittedSubdue(flags) {
  return flags?.momentum?.allocations?.subdue === true;
}

export function getCommittedCalledShot(flags) {
  const raw = flags?.momentum?.allocations?.calledShot ?? null;
  return raw?.key ? raw : null;
}

function getActorMethodNumber(actor, methodName) {
  try {
    const fn = actor?.[methodName];
    if (typeof fn !== "function") return null;
    const n = Number(fn.call(actor));
    return Number.isFinite(n) ? n : null;
  } catch (_e) {
    return null;
  }
}

function getSecondWindCapabilityState(actor, capability) {
  const key = String(capability ?? "").trim().toLowerCase() === "mental" ? "mental" : "physical";
  const isMental = key === "mental";
  const path = isMental ? "system.health.mental.value" : "system.health.physical.value";
  const maxPath = isMental ? "system.health.mental.max" : "system.health.physical.max";
  const methodName = isMental ? "getMaxResolve" : "getMaxVigor";
  const labelKey = isMental ? "CONAN.Actor.Health.Resolve.label" : "CONAN.Actor.Health.Vigor.label";

  const currentRaw = Number(foundry.utils.getProperty(actor, path));
  const current = Number.isFinite(currentRaw) ? Math.max(0, currentRaw) : 0;
  const methodMax = getActorMethodNumber(actor, methodName);
  const storedMaxRaw = Number(foundry.utils.getProperty(actor, maxPath));
  const storedMax = Number.isFinite(storedMaxRaw) ? storedMaxRaw : null;
  const max = Math.max(0, Number(methodMax ?? storedMax ?? current) || 0);

  return {
    key,
    path,
    current,
    max,
    missing: Math.max(0, max - current),
    label: game.i18n.localize(labelKey)
  };
}

function getSecondWindDefaultCapability(actor) {
  const physical = getSecondWindCapabilityState(actor, "physical");
  const mental = getSecondWindCapabilityState(actor, "mental");
  if (physical.missing > 0) return "physical";
  if (mental.missing > 0) return "mental";
  return "physical";
}

function hasSecondWindRecoveryAvailable(actor) {
  return getSecondWindCapabilityState(actor, "physical").missing > 0
    || getSecondWindCapabilityState(actor, "mental").missing > 0;
}

function buildSecondWindOptions(actor, selectedCapability = "physical") {
  return ["physical", "mental"].map((capability) => {
    const state = getSecondWindCapabilityState(actor, capability);
    const selected = state.key === selectedCapability ? " selected" : "";
    const disabled = state.missing <= 0 ? " disabled" : "";
    const label = game.i18n.format("C2MQ.Dialog.Momentum.SecondWindCapabilityState", {
      capability: state.label,
      current: state.current,
      max: state.max
    });

    return `<option value="${state.key}" data-missing="${state.missing}"${selected}${disabled}>${foundry.utils.escapeHTML(label)}</option>`;
  }).join("");
}

async function applySecondWindSpend(actor, { capability, spent } = {}) {
  const requested = toInt(spent, 0);
  if (!actor || requested <= 0) return null;

  const state = getSecondWindCapabilityState(actor, capability);
  const recovered = Math.min(requested, state.missing);
  if (recovered <= 0) return null;

  const after = Math.min(state.max, state.current + recovered);
  await actor.update({ [state.path]: after });

  return {
    actorUuid: actor.uuid ?? null,
    capability: state.key,
    label: state.label,
    path: state.path,
    before: state.current,
    after,
    recovered,
    spent: recovered
  };
}

function getBreakGuardCandidates(flags) {
  return (Array.isArray(flags?.targets) ? flags.targets : [])
    .filter((target) => target?.tokenUuid)
    .map((target) => ({
      tokenUuid: target.tokenUuid,
      name: target.name ?? "Target"
    }));
}

function buildMomentumDialogContent({
  generated,
  isPhysicalAttack,
  showCalledShot,
  showChangeStance,
  changeStanceLabel,
  showSecondWind,
  secondWindOptions,
  secondWindMax,
  showBreakGuard,
  showDisarm,
  disarmOptions,
  canAffordBreakGuard
}) {
  return `
    <div class="c2mq-momentum-dialog-body">
      <p class="c2mq-momentum-summary">
        ${game.i18n.format("C2MQ.Dialog.Momentum.Content", { generated })}
      </p>

      <div class="c2mq-momentum-row">
        <label class="c2mq-momentum-label" for="c2mq-momentum-bonusDamage">
          ${game.i18n.localize("C2MQ.Dialog.Momentum.BonusDamage")}
        </label>
        <input
          id="c2mq-momentum-bonusDamage"
          class="c2mq-momentum-input"
          type="number"
          name="bonusDamage"
          min="0"
          max="${generated}"
          step="1"
          value="0">
      </div>

      ${isPhysicalAttack ? `
      <div class="c2mq-momentum-row">
        <label class="c2mq-momentum-label" for="c2mq-momentum-penetration">
          ${game.i18n.localize("C2MQ.Dialog.Momentum.Penetration")}
        </label>
        <input
          id="c2mq-momentum-penetration"
          class="c2mq-momentum-input"
          type="number"
          name="penetration"
          min="0"
          max="${generated}"
          step="1"
          value="0">
      </div>
      ` : ""}

      ${isPhysicalAttack ? `
      <div class="c2mq-momentum-row">
        <label class="c2mq-momentum-label" for="c2mq-momentum-subdue">
          ${game.i18n.localize("C2MQ.Dialog.Momentum.Subdue")}
        </label>
        <input
          id="c2mq-momentum-subdue"
          class="c2mq-momentum-checkbox"
          type="checkbox"
          name="subdue">
      </div>
      ` : ""}

      ${showCalledShot ? `
      <div class="c2mq-momentum-row">
        <label class="c2mq-momentum-label" for="c2mq-momentum-calledShot">
          ${game.i18n.localize("C2MQ.Dialog.Momentum.CalledShot")}
        </label>
        <select
          id="c2mq-momentum-calledShot"
          class="c2mq-momentum-select"
          name="calledShot">
          ${buildCalledShotOptions()}
        </select>
      </div>
      ` : ""}

      ${showChangeStance ? `
      <div class="c2mq-momentum-row">
        <label class="c2mq-momentum-label" for="c2mq-momentum-changeStance">
          ${game.i18n.format("C2MQ.Dialog.Momentum.ChangeStance", { stance: changeStanceLabel })}
        </label>
        <input
          id="c2mq-momentum-changeStance"
          class="c2mq-momentum-checkbox"
          type="checkbox"
          name="changeStance">
      </div>
      ` : ""}

      ${showSecondWind ? `
      <div class="c2mq-momentum-row c2mq-momentum-row-second-wind">
        <label class="c2mq-momentum-label" for="c2mq-momentum-secondWind">
          ${game.i18n.localize("C2MQ.Dialog.Momentum.SecondWind")}
        </label>
        <div class="c2mq-momentum-second-wind-controls">
          <select
            id="c2mq-momentum-secondWindCapability"
            class="c2mq-momentum-select c2mq-momentum-second-wind-select"
            name="secondWindCapability">
            ${secondWindOptions}
          </select>
          <input
            id="c2mq-momentum-secondWind"
            class="c2mq-momentum-input"
            type="number"
            name="secondWind"
            min="0"
            max="${secondWindMax}"
            step="1"
            value="0">
        </div>
      </div>
      ` : ""}

      ${showBreakGuard ? `
      <div class="c2mq-momentum-row">
        <label class="c2mq-momentum-label" for="c2mq-momentum-breakGuard">
          ${game.i18n.localize("C2MQ.Dialog.Momentum.BreakGuard")}
        </label>
        <input
          id="c2mq-momentum-breakGuard"
          class="c2mq-momentum-checkbox"
          type="checkbox"
          name="breakGuard"
          ${canAffordBreakGuard ? "" : "disabled"}>
      </div>
      ` : ""}

      ${showDisarm ? `
      <div class="c2mq-momentum-row c2mq-momentum-row-disarm">
        <label class="c2mq-momentum-label" for="c2mq-momentum-disarm">
          ${game.i18n.localize("C2MQ.Dialog.Momentum.Disarm")}
        </label>
        <select
          id="c2mq-momentum-disarm"
          class="c2mq-momentum-select c2mq-momentum-disarm-select"
          name="disarm">
          ${disarmOptions}
        </select>
      </div>
      ` : ""}

      <p class="c2mq-momentum-preview" data-c2mq-preview="true"></p>
    </div>
  `;
}

export async function openMomentumSpendDialog(message) {
  if (!message) return false;

  const actor = getMessageActor(message);
  if (!actor) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.MomentumActorMissing"));
    return false;
  }

  const existingFlags = foundry.utils.duplicate(message.flags?.[MODULE_ID] ?? {});
  const plan = getMomentumPlan(existingFlags, message);

  if (plan.committed) {
    ui.notifications.info(game.i18n.localize("C2MQ.Warn.MomentumAlreadyCommitted"));
    return false;
  }

  const generated = toInt(plan.generated, 0);
  if (generated <= 0) {
    ui.notifications.warn(game.i18n.localize("CONAN.noUnbankedMomentum"));
    return false;
  }

  const breakGuardCandidates = getBreakGuardCandidates(existingFlags);
  const breakGuardTarget = breakGuardCandidates.length === 1 ? breakGuardCandidates[0] : null;

  const isPhysicalAttack = String(existingFlags?.damage?.type ?? "").trim().toLowerCase() === "physical";
  const hitLocationEnabled = !!game.settings.get(MODULE_ID, SETTING_KEYS.HIT_LOCATION_ENABLED);
  const changeStanceState = getChangeStanceState(message, actor);
  const secondWindDefaultCapability = getSecondWindDefaultCapability(actor);
  const secondWindDefaultState = getSecondWindCapabilityState(actor, secondWindDefaultCapability);
  const showCalledShot = isPhysicalAttack && hitLocationEnabled && generated >= 2 && !hasAppliedDamage(existingFlags);
  const showChangeStance = !!actor && generated >= 1;
  const showSecondWind = generated >= 1 && hasSecondWindRecoveryAvailable(actor);
  const secondWindOptions = buildSecondWindOptions(actor, secondWindDefaultCapability);
  const secondWindMax = showSecondWind ? Math.min(generated, secondWindDefaultState.missing) : 0;
  const showBreakGuard = isPhysicalAttack && !!breakGuardTarget;
  const canAffordBreakGuard = generated >= 2;
  const disarmCandidates = isPhysicalAttack ? await getDisarmCandidates(existingFlags) : [];
  const showDisarm = disarmCandidates.some((candidate) => candidate.cost <= generated);
  const disarmOptions = buildDisarmOptions(disarmCandidates, generated);

  return await new Promise((resolve) => {
    let confirmed = false;

    const content = buildMomentumDialogContent({
      generated,
      isPhysicalAttack,
      showCalledShot,
      showChangeStance,
      changeStanceLabel: changeStanceState.label,
      showSecondWind,
      secondWindOptions,
      secondWindMax,
      showBreakGuard,
      showDisarm,
      disarmOptions,
      canAffordBreakGuard
    });

    const readSpendForm = (root) => {
      const bonusInput = root.querySelector('input[name="bonusDamage"]');
      const penetrationInput = root.querySelector('input[name="penetration"]');
      const subdueInput = root.querySelector('input[name="subdue"]');
      const calledShotSelect = root.querySelector('select[name="calledShot"]');
      const changeStanceInput = root.querySelector('input[name="changeStance"]');
      const secondWindCapabilitySelect = root.querySelector('select[name="secondWindCapability"]');
      const secondWindInput = root.querySelector('input[name="secondWind"]');
      const breakGuardInput = root.querySelector('input[name="breakGuard"]');
      const disarmSelect = root.querySelector('select[name="disarm"]');

      let subdue = subdueInput?.checked === true;
      let calledShotKey = String(calledShotSelect?.value ?? "");
      let changeStanceActive = changeStanceInput?.checked === true;
      let breakGuardActive = breakGuardInput?.checked === true;
      let disarmIndex = String(disarmSelect?.value ?? "");
      let disarm = disarmIndex === "" ? null : disarmCandidates[Number(disarmIndex)] ?? null;
      if (disarm?.cost > generated) disarm = null;

      // Fixed-cost spends are sanitized from right to left so the preview never
      // advertises spending more Momentum than the roll generated.
      let fixedCost = (subdue ? 1 : 0) + (calledShotKey ? 2 : 0) + (changeStanceActive ? 1 : 0) + (breakGuardActive ? 2 : 0) + (disarm?.cost ?? 0);
      if (fixedCost > generated && disarm) {
        fixedCost -= disarm.cost;
        disarm = null;
        disarmIndex = "";
        if (disarmSelect) disarmSelect.value = "";
      }
      if (fixedCost > generated && breakGuardActive) {
        breakGuardActive = false;
        fixedCost -= 2;
        if (breakGuardInput) breakGuardInput.checked = false;
      }
      if (fixedCost > generated && calledShotKey) {
        calledShotKey = "";
        fixedCost -= 2;
        if (calledShotSelect) calledShotSelect.value = "";
      }
      if (fixedCost > generated && changeStanceActive) {
        changeStanceActive = false;
        fixedCost -= 1;
        if (changeStanceInput) changeStanceInput.checked = false;
      }
      if (fixedCost > generated && subdue) {
        subdue = false;
        fixedCost -= 1;
        if (subdueInput) subdueInput.checked = false;
      }

      const maxVariableSpend = Math.max(0, generated - fixedCost);

      let bonusDamage = toInt(bonusInput?.value, 0);
      if (bonusDamage > maxVariableSpend) {
        bonusDamage = maxVariableSpend;
        if (bonusInput) bonusInput.value = String(maxVariableSpend);
      }

      let penetration = toInt(penetrationInput?.value, 0);
      const maxPenetration = Math.max(0, maxVariableSpend - bonusDamage);
      if (penetration > maxPenetration) {
        penetration = maxPenetration;
        if (penetrationInput) penetrationInput.value = String(maxPenetration);
      }

      const secondWindCapability = String(secondWindCapabilitySelect?.value ?? secondWindDefaultCapability);
      const secondWindState = getSecondWindCapabilityState(actor, secondWindCapability);
      const maxSecondWind = Math.min(secondWindState.missing, Math.max(0, maxVariableSpend - bonusDamage - penetration));
      if (secondWindInput) secondWindInput.max = String(maxSecondWind);

      let secondWind = toInt(secondWindInput?.value, 0);
      if (secondWind > maxSecondWind) {
        secondWind = maxSecondWind;
        if (secondWindInput) secondWindInput.value = String(maxSecondWind);
      }

      const calledShot = getCalledShotLocation(calledShotKey);
      const breakGuardCost = breakGuardActive ? 2 : 0;
      const disarmCost = disarm ? disarm.cost : 0;
      const subdueCost = subdue ? 1 : 0;
      const calledShotCost = calledShot ? 2 : 0;
      const changeStanceCost = changeStanceActive ? 1 : 0;
      const secondWindCost = secondWind;
      const spent = bonusDamage + penetration + secondWindCost + subdueCost + calledShotCost + changeStanceCost + breakGuardCost + disarmCost;
      const banked = Math.max(0, generated - spent);

      return {
        bonusDamage,
        penetration,
        secondWind,
        secondWindCapability,
        secondWindCost,
        subdue,
        subdueCost,
        calledShot,
        calledShotCost,
        changeStanceActive,
        changeStanceCost,
        breakGuardActive,
        breakGuardCost,
        disarm,
        disarmCost,
        spent,
        banked
      };
    };

    const updatePreview = (root) => {
      const preview = root.querySelector('[data-c2mq-preview="true"]');
      const spend = readSpendForm(root);

      if (preview) {
        preview.textContent = game.i18n.format("C2MQ.Dialog.Momentum.Preview", {
          spent: spend.spent,
          banked: spend.banked
        });
      }
    };

    new Dialog(
      {
        title: game.i18n.localize("C2MQ.Dialog.Momentum.Title"),
        content,
        buttons: {
          confirm: {
            label: game.i18n.localize("C2MQ.Dialog.Momentum.ButtonConfirm"),
            callback: async (html) => {
              const root = html?.[0] ?? html;
              const spend = readSpendForm(root);
              const {
                bonusDamage,
                penetration,
                secondWind,
                secondWindCapability,
                subdue,
                subdueCost,
                calledShot,
                calledShotCost,
                changeStanceActive,
                changeStanceCost,
                disarm,
                disarmCost
              } = spend;
              const breakGuardActive = spend.breakGuardActive && !!breakGuardTarget;
              const breakGuardCost = breakGuardActive ? 2 : 0;
              const disarmAllocation = disarm ? {
                ...foundry.utils.duplicate(disarm),
                spent: disarmCost
              } : null;

              let changeStanceAllocation = null;
              if (changeStanceActive) {
                const applied = await setActorProne(actor, changeStanceState.nextProne);
                if (!applied) {
                  ui.notifications.warn(game.i18n.localize("C2MQ.Warn.ChangeStanceFailed"));
                  return;
                }

                changeStanceAllocation = {
                  actorUuid: actor.uuid,
                  tokenUuid: changeStanceState.tokenUuid,
                  action: changeStanceState.action,
                  fromProne: changeStanceState.currentProne,
                  toProne: changeStanceState.nextProne,
                  spent: 1,
                  applied: true
                };
              }

              let secondWindAllocation = null;
              if (secondWind > 0) {
                secondWindAllocation = await applySecondWindSpend(actor, {
                  capability: secondWindCapability,
                  spent: secondWind
                });

                if (!secondWindAllocation) {
                  ui.notifications.warn(game.i18n.localize("C2MQ.Warn.SecondWindFailed"));
                }
              }

              const secondWindCost = Number(secondWindAllocation?.spent ?? 0) || 0;
              const spent = bonusDamage + penetration + secondWindCost + subdueCost + calledShotCost + changeStanceCost + breakGuardCost + disarmCost;
              const banked = Math.max(0, generated - spent);

              const next = foundry.utils.duplicate(existingFlags);
              next.momentum = {
                schema: 1,
                committed: true,
                generated,
                spent,
                banked,
                bankType: plan.bankType,
                committedAt: Date.now(),
                committedByUserId: game.user?.id ?? null,
                allocations: {
                  bonusDamage,
                  penetration,
                  subdue,
                  calledShot: calledShot ? {
                    key: calledShot.key,
                    label: calledShot.label,
                    spent: 2
                  } : null,
                  changeStance: changeStanceAllocation,
                  secondWind: secondWindAllocation,
                  rerollDamage: null,
                  breakGuard: breakGuardActive ? {
                    tokenUuid: breakGuardTarget.tokenUuid,
                    targetName: breakGuardTarget.name,
                    spent: 2
                  } : null,
                  disarm: disarmAllocation
                }
              };

              if (calledShot) {
                applyCalledShotToHitLocations(next, calledShot);
              }

              // If damage was already rolled before committing the Momentum spend,
              // update the stored snapshot so chat display and Apply use the
              // corrected values.
              if (next.damage?.rolled === true) {
                const prevMomentumSpent = Number(next.damage?.spends?.momentum ?? 0) || 0;

                if (bonusDamage > 0) {
                  const prevTotal = Number(next.damage.total ?? 0) || 0;
                  const prevStatic = Number(next.damage.static ?? 0) || 0;
                  next.damage.total = prevTotal + bonusDamage;
                  next.damage.static = prevStatic + bonusDamage;
                }

                if (penetration > 0) {
                  const prevIgnoreSoak = Number(next.damage.ignoreSoak ?? 0) || 0;
                  next.damage.ignoreSoak = prevIgnoreSoak + (penetration * 2);
                }

                if (subdue) {
                  next.damage.nonlethal = true;
                }

                next.damage.spends = {
                  ...(next.damage.spends ?? {}),
                  momentum: prevMomentumSpent + bonusDamage + penetration + subdueCost + calledShotCost
                };
              }

              await message.update({ [`flags.${MODULE_ID}`]: next });

              if (banked > 0) {
                await adjustPoolValue(plan.bankType, banked);
              }

              await actor.update({ "system.momentum": 0 });

              if (breakGuardActive && breakGuardTarget?.tokenUuid) {
                const freshMessage = game.messages?.get(message.id) ?? message;
                await execBreakGuard(freshMessage, breakGuardTarget.tokenUuid);
              }

              if (disarmAllocation) {
                const freshMessage = game.messages?.get(message.id) ?? message;
                if (game.user?.isGM || !hasActiveGM()) await execDisarm(freshMessage, disarmAllocation);
                else requestDisarm(freshMessage.id, disarmAllocation);
              }

              confirmed = true;
              try {
                ui.chat?.render?.(true);
              } catch (_e) {
                // Ignore chat rerender failures.
              }

              resolve(true);
            }
          },
          cancel: {
            label: game.i18n.localize("Cancel"),
            callback: () => resolve(false)
          }
        },
        render: (html) => {
          const root = html?.[0] ?? html;
          root?.querySelector?.('input[name="bonusDamage"]')?.addEventListener("input", () => updatePreview(root));
          root?.querySelector?.('input[name="penetration"]')?.addEventListener("input", () => updatePreview(root));
          root?.querySelector?.('input[name="subdue"]')?.addEventListener("change", () => updatePreview(root));
          root?.querySelector?.('select[name="calledShot"]')?.addEventListener("change", () => updatePreview(root));
          root?.querySelector?.('input[name="changeStance"]')?.addEventListener("change", () => updatePreview(root));
          root?.querySelector?.('select[name="secondWindCapability"]')?.addEventListener("change", () => updatePreview(root));
          root?.querySelector?.('input[name="secondWind"]')?.addEventListener("input", () => updatePreview(root));
          root?.querySelector?.('input[name="breakGuard"]')?.addEventListener("change", () => updatePreview(root));
          root?.querySelector?.('select[name="disarm"]')?.addEventListener("change", () => updatePreview(root));
          updatePreview(root);
        },
        close: () => {
          if (!confirmed) resolve(false);
        }
      },
      { classes: ["c2mq", "c2mq-momentum-dialog"] }
    ).render(true);
  });
}