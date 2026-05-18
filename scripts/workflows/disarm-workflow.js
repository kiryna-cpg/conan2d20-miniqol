import { MODULE_ID } from "../constants.js";
import {
  isDisarmableItem,
  isNpcAttackUnequipped,
  setNpcAttackUnequipped
} from "../utils/npc-attack-equipment.js";

function safeTokenKey(tokenUuid) {
  const raw = String(tokenUuid ?? "");
  return encodeURIComponent(raw).replaceAll(".", "%2E");
}

function disarmEntryKey(tokenUuid, itemId) {
  return `${safeTokenKey(tokenUuid)}__${safeTokenKey(itemId)}`;
}

async function resolveTokenDoc(tokenUuid) {
  try {
    return await fromUuid(tokenUuid);
  } catch (_e) {
    return null;
  }
}

async function resolveDisarmItem(allocation, tokenDoc) {
  if (allocation?.itemUuid) {
    try {
      const item = await fromUuid(allocation.itemUuid);
      if (item?.type === "weapon" || item?.type === "npcattack") return item;
    } catch (_e) {
      // Fall back to the target actor item lookup below.
    }
  }

  const itemId = allocation?.itemId ?? null;
  return itemId ? tokenDoc?.actor?.items?.get?.(itemId) ?? null : null;
}

export async function execDisarm(message, allocation = {}) {
  if (!message || !allocation?.tokenUuid || !allocation?.itemId) return false;

  const flags = message.flags?.[MODULE_ID];
  if (!flags) return false;

  const tokenDoc = await resolveTokenDoc(allocation.tokenUuid);
  const actor = tokenDoc?.actor ?? null;
  const item = await resolveDisarmItem(allocation, tokenDoc);

  if (!actor || !item || !isDisarmableItem(item)) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.DisarmTargetMissing"));
    return false;
  }

  const key = disarmEntryKey(allocation.tokenUuid, item.id);
  const next = foundry.utils.duplicate(flags);
  next.spends = next.spends ?? {};
  next.spends.disarm = next.spends.disarm ?? {};

  // Idempotent per target weapon per message.
  if (next.spends.disarm[key]?.applied === true) return true;

  let beforeEquipped;
  let afterEquipped;
  let applied = false;

  if (item.type === "npcattack") {
    beforeEquipped = !isNpcAttackUnequipped(item);
    await setNpcAttackUnequipped(item, true);
    afterEquipped = !isNpcAttackUnequipped(item);
    applied = afterEquipped === false;
  } else {
    beforeEquipped = item.system?.equipped === true;
    if (beforeEquipped) await item.update({ "system.equipped": false });
    afterEquipped = item.system?.equipped === true;
    applied = afterEquipped !== true;
  }

  const spent = Math.max(0, Number(allocation.spent ?? allocation.cost ?? 0) || 0);

  const entry = {
    applied,
    appliedAt: Date.now(),
    appliedBy: game.user?.id ?? null,
    tokenUuid: allocation.tokenUuid,
    targetName: allocation.targetName ?? tokenDoc.name ?? actor.name,
    actorUuid: actor.uuid,
    itemUuid: item.uuid,
    itemId: item.id,
    itemName: item.name,
    itemType: item.type,
    cost: spent,
    spent,
    beforeEquipped,
    afterEquipped
  };

  next.spends.disarm[key] = entry;
  next.momentum = foundry.utils.duplicate(next.momentum ?? {});
  next.momentum.allocations = foundry.utils.duplicate(next.momentum.allocations ?? {});
  next.momentum.allocations.disarm = {
    ...(foundry.utils.duplicate(next.momentum.allocations.disarm ?? {})),
    ...entry
  };

  await message.update({ [`flags.${MODULE_ID}`]: next });

  if (!applied) {
    ui.notifications.warn(game.i18n.localize("C2MQ.Warn.DisarmFailed"));
  }

  try {
    ui.chat?.render?.(true);
  } catch (_e) {
    // Ignore chat re-render failures.
  }

  return applied;
}
