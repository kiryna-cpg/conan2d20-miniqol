import { MODULE_ID } from "../constants.js";
import { adjustPoolValue } from "../adapter/pool-tracker.js";
import { execBreakGuard } from "./guard-workflow.js";

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
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

  // Until the player confirms a spend/bank decision, the live system roll
  // remains the source of truth for generated Momentum. MiniQoL flags only
  // become authoritative once the plan is committed.
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

function getBreakGuardCandidates(flags) {
  return (Array.isArray(flags?.targets) ? flags.targets : [])
    .filter((target) => target?.tokenUuid)
    .map((target) => ({
      tokenUuid: target.tokenUuid,
      name: target.name ?? "Target"
    }));
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

  const isPhysicalAttack = String(existingFlags?.damage?.type ?? "").trim().toLowerCase() === "physical";

  return await new Promise((resolve) => {
    let confirmed = false;

    const content = `
      <div class="dialog">
        <div class="dialog-content">
          <p>${game.i18n.format("C2MQ.Dialog.Momentum.Content", { generated })}</p>

          <div class="form-group">
            <label>${game.i18n.localize("C2MQ.Dialog.Momentum.Penetration")}</label>
            <input type="number" name="penetration" min="0" max="${generated}" step="1" value="0">
          </div>

          ${isPhysicalAttack ? `
          <div class="form-group stacked">
            <label class="checkbox">
              <input type="checkbox" name="subdue">
              ${game.i18n.localize("C2MQ.Dialog.Momentum.Subdue")}
            </label>
          </div>
          ` : ""}

          <div class="form-group">
            <label>${game.i18n.localize("C2MQ.Dialog.Momentum.BreakGuard")}</label>
            <input type="number" name="penetration" min="0" max="${generated}" step="1" value="0">
          </div>

          <div class="form-group">
            <label>${game.i18n.localize("C2MQ.Dialog.Momentum.BreakGuard")}</label>
            <select name="breakGuardTokenUuid">
              <option value="">${game.i18n.localize("C2MQ.Dialog.Momentum.NoBreakGuard")}</option>
              ${breakGuardCandidates.map((target) => `
                <option value="${foundry.utils.escapeHTML(target.tokenUuid)}">
                  ${foundry.utils.escapeHTML(target.name)}
                </option>
              `).join("")}
            </select>
          </div>

          <p data-c2mq-preview="true"></p>
        </div>
      </div>
    `;

    let dlg = null;

    const updatePreview = (root) => {
      const bonusInput = root.querySelector('input[name="bonusDamage"]');
      const penetrationInput = root.querySelector('input[name="penetration"]');
      const subdueInput = root.querySelector('input[name="subdue"]');
      const guardSelect = root.querySelector('select[name="breakGuardTokenUuid"]');
      const preview = root.querySelector('[data-c2mq-preview="true"]');

      const guardCost = guardSelect?.value ? 2 : 0;
      const subdueCost = subdueInput?.checked ? 1 : 0;
      const maxVariableSpend = Math.max(0, generated - guardCost - subdueCost);

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

      const spent = bonusDamage + penetration + subdueCost + guardCost;
      const banked = Math.max(0, generated - spent);

      if (preview) {
        preview.textContent = game.i18n.format("C2MQ.Dialog.Momentum.Preview", {
          spent,
          banked
        });
      }
    };

    dlg = new Dialog(
      {
        title: game.i18n.localize("C2MQ.Dialog.Momentum.Title"),
        content,
        buttons: {
          confirm: {
            label: game.i18n.localize("C2MQ.Dialog.Momentum.ButtonConfirm"),
            callback: async (html) => {
              const root = html?.[0] ?? html;
              const bonusInput = root?.querySelector?.('input[name="bonusDamage"]');
              const penetrationInput = root?.querySelector?.('input[name="penetration"]');
              const subdueInput = root?.querySelector?.('input[name="subdue"]');
              const guardSelect = root?.querySelector?.('select[name="breakGuardTokenUuid"]');

              const breakGuardTokenUuid = String(guardSelect?.value ?? "");
              const breakGuardCost = breakGuardTokenUuid ? 2 : 0;
              const subdue = subdueInput?.checked === true;
              const subdueCost = subdue ? 1 : 0;
              const maxVariableSpend = Math.max(0, generated - breakGuardCost - subdueCost);
              const bonusDamage = Math.min(maxVariableSpend, toInt(bonusInput?.value, 0));
              const penetration = Math.min(
                Math.max(0, maxVariableSpend - bonusDamage),
                toInt(penetrationInput?.value, 0)
              );
              const spent = bonusDamage + penetration + subdueCost + breakGuardCost;
              const banked = Math.max(0, generated - spent);

              const breakGuardTarget = breakGuardCandidates.find((target) => {
                return target.tokenUuid === breakGuardTokenUuid;
              }) ?? null;

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
                  rerollDamage: null,
                  breakGuard: breakGuardTarget ? {
                    tokenUuid: breakGuardTarget.tokenUuid,
                    targetName: breakGuardTarget.name,
                    spent: 2
                  } : null
                }
              };

              // If damage was already rolled before committing the Momentum spend,
              // update the stored damage snapshot so the card display and later
              // Apply damage use the corrected total.
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
                  momentum: prevMomentumSpent + bonusDamage + penetration + subdueCost
                };
              }

              // Persist the message-scoped plan first so the roll cannot be reused.
              await message.update({ [`flags.${MODULE_ID}`]: next });

              // Bank only the remainder from this roll.
              if (banked > 0) {
                await adjustPoolValue(plan.bankType, banked);
              }

              // Clear the actor-side temporary momentum produced by the native roll.
              await actor.update({ "system.momentum": 0 });

              // Apply auto-resolvable spends immediately.
              if (breakGuardTarget?.tokenUuid) {
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
          root?.querySelector?.('select[name="breakGuardTokenUuid"]')?.addEventListener("change", () => updatePreview(root));
          updatePreview(root);
        },
        close: () => {
          if (!confirmed) resolve(false);
        }
      },
      { classes: ["c2mq", "c2mq-momentum-dialog"] }
    );

    dlg.render(true);
  });
}