import { MODULE_ID, SETTING_KEYS, REACTION_OUTCOMES, REACTION_KINDS } from "../constants.js";
import {
  ensureMessageFlags,
  isAttackMessage,
  isDamageCapableRoll,
  isSuccessfulRoll,
  isStandaloneDamageCardMessage
} from "./message-flags.js";
import { execRollDamage, execApplyDamage } from "./damage-workflow.js";
import {
  maybeStartReactionWorkflow,
  maybeStartProtectWorkflow,
  maybeResolvePendingReactionRoll
} from "./reaction-workflow.js";

function hasActiveGM() {
  return game.users?.some((user) => user.active && user.isGM);
}

function autoRollEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.AUTO_ROLL_DAMAGE);
}

function autoApplyEnabled() {
  return !!game.settings.get(MODULE_ID, SETTING_KEYS.AUTO_APPLY_DAMAGE);
}

function isAuthoritativeForMessage(message) {
  if (game.user?.isGM) return true;
  if (hasActiveGM()) return false;
  return message?.author?.id === game.user?.id;
}

export async function dispatchCreatedChatMessage(message) {
  if (game.system?.id !== "conan2d20") return;

  const reactionResolution = await maybeResolvePendingReactionRoll(message);
  if (reactionResolution) {
    const attackMessage = game.messages?.find((candidate) =>
      candidate?.flags?.[MODULE_ID]?.reaction?.resolvedByMessageId === message.id
    ) ?? null;

    if (attackMessage && isAuthoritativeForMessage(attackMessage)) {
      const reactionKind = attackMessage.flags?.[MODULE_ID]?.reaction?.kind ?? null;

      if (reactionKind === REACTION_KINDS.DEFEND && reactionResolution === REACTION_OUTCOMES.HIT) {
        const protectBlocked = await maybeStartProtectWorkflow(attackMessage);
        if (protectBlocked) return;
      }

      if (reactionResolution === REACTION_OUTCOMES.HIT) {
        const autoRoll = autoRollEnabled();
        const autoApply = autoApplyEnabled();

        if (autoRoll && !attackMessage.flags?.[MODULE_ID]?.damage?.rolled) {
          const fresh = game.messages?.get(attackMessage.id) ?? attackMessage;
          await execRollDamage(fresh);
        }

        if (autoRoll && autoApply) {
          const fresh = game.messages?.get(attackMessage.id) ?? attackMessage;
          const flags = fresh.flags?.[MODULE_ID];
          const only = flags?.targets?.length === 1 ? flags.targets[0] : null;
          if (only?.tokenUuid) await execApplyDamage(fresh, only.tokenUuid);
        }
      }
    }

    return;
  }

  if (isStandaloneDamageCardMessage(message)) {
    if (!isAuthoritativeForMessage(message)) return;

    await ensureMessageFlags(message);

    if (autoApplyEnabled()) {
      const fresh = game.messages?.get(message.id) ?? message;
      const flags = fresh.flags?.[MODULE_ID];
      const only = flags?.targets?.length === 1 ? flags.targets[0] : null;
      if (only?.tokenUuid) await execApplyDamage(fresh, only.tokenUuid);
    }

    return;
  }

  if (!isSuccessfulRoll(message)) return;
  if (!isDamageCapableRoll(message)) return;
  if (!isAttackMessage(message)) return;
  if (!isAuthoritativeForMessage(message)) return;

  await ensureMessageFlags(message);

  const reactionBlocked = await maybeStartReactionWorkflow(message, {
    kind: REACTION_KINDS.DEFEND
  });
  if (reactionBlocked) return;

  const autoRoll = autoRollEnabled();
  const autoApply = autoApplyEnabled();

  if (autoRoll) {
    const fresh = game.messages?.get(message.id) ?? message;
    await execRollDamage(fresh);
  }

  if (autoRoll && autoApply) {
    const fresh = game.messages?.get(message.id) ?? message;
    const flags = fresh.flags?.[MODULE_ID];
    const only = flags?.targets?.length === 1 ? flags.targets[0] : null;
    if (only?.tokenUuid) await execApplyDamage(fresh, only.tokenUuid);
  }
}