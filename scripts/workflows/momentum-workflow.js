import { MODULE_ID, SETTING_KEYS } from "../constants.js";
import { adjustPoolValue } from "../adapter/pool-tracker.js";
import { execBreakGuard } from "./guard-workflow.js";

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function safeTokenKey(tokenUuid) {
  const raw = String(tokenUuid ?? "");
  return encodeURIComponent(raw).replaceAll(".", "%2E");
}

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

function getMessageActor(message) {
  const actorId =
    message?.speaker?.actor ??
    message?.flags?.data?.actor?._id ??
    message?.flags?.data?.rollData?.actorId ??
    null;

  return actorId ? game.actors?.get(actorId) ?? null : null;
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
      rerollDamage: null,
      breakGuard: null
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
      rerollDamage: null,
      breakGuard: null
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
  showBreakGuard,
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
  const showCalledShot = isPhysicalAttack && hitLocationEnabled && generated >= 2 && !hasAppliedDamage(existingFlags);
  const showBreakGuard = isPhysicalAttack && !!breakGuardTarget;
  const canAffordBreakGuard = generated >= 2;

  return await new Promise((resolve) => {
    let confirmed = false;

    const content = buildMomentumDialogContent({
      generated,
      isPhysicalAttack,
      showCalledShot,
      showBreakGuard,
      canAffordBreakGuard
    });

    const readSpendForm = (root) => {
      const bonusInput = root.querySelector('input[name="bonusDamage"]');
      const penetrationInput = root.querySelector('input[name="penetration"]');
      const subdueInput = root.querySelector('input[name="subdue"]');
      const calledShotSelect = root.querySelector('select[name="calledShot"]');
      const breakGuardInput = root.querySelector('input[name="breakGuard"]');

      let subdue = subdueInput?.checked === true;
      let calledShotKey = String(calledShotSelect?.value ?? "");
      let breakGuardActive = breakGuardInput?.checked === true;

      // Fixed-cost spends are sanitized from right to left so the preview never
      // advertises spending more Momentum than the roll generated.
      let fixedCost = (subdue ? 1 : 0) + (calledShotKey ? 2 : 0) + (breakGuardActive ? 2 : 0);
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

      const calledShot = getCalledShotLocation(calledShotKey);
      const breakGuardCost = breakGuardActive ? 2 : 0;
      const subdueCost = subdue ? 1 : 0;
      const calledShotCost = calledShot ? 2 : 0;
      const spent = bonusDamage + penetration + subdueCost + calledShotCost + breakGuardCost;
      const banked = Math.max(0, generated - spent);

      return {
        bonusDamage,
        penetration,
        subdue,
        subdueCost,
        calledShot,
        calledShotCost,
        breakGuardActive,
        breakGuardCost,
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
                subdue,
                subdueCost,
                calledShot,
                calledShotCost,
                banked
              } = spend;
              const breakGuardActive = spend.breakGuardActive && !!breakGuardTarget;
              const breakGuardCost = breakGuardActive ? 2 : 0;
              const spent = bonusDamage + penetration + subdueCost + calledShotCost + breakGuardCost;

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
                  rerollDamage: null,
                  breakGuard: breakGuardActive ? {
                    tokenUuid: breakGuardTarget.tokenUuid,
                    targetName: breakGuardTarget.name,
                    spent: 2
                  } : null
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
          root?.querySelector?.('input[name="breakGuard"]')?.addEventListener("change", () => updatePreview(root));
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