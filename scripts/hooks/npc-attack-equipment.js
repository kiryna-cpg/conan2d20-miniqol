import { MODULE_ID } from "../constants.js";
import {
  isPhysicalNpcAttack,
  isNpcAttackUnequipped,
  setNpcAttackUnequipped
} from "../utils/npc-attack-equipment.js";

let _npcAttackEquipmentHooksRegistered = false;
let _npcAttackContextMenuPatched = false;

function getHtmlRoot(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.querySelector) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (html?.element?.[0] instanceof HTMLElement) return html.element[0];
  return null;
}

function cssEscape(value) {
  const raw = String(value ?? "");
  return globalThis.CSS?.escape ? CSS.escape(raw) : raw.replaceAll('"', '\\"');
}

function getSheetClassByName(actorType, className) {
  const entries = Object.values(CONFIG.Actor?.sheetClasses?.[actorType] ?? {});
  return entries.find((entry) => entry?.cls?.name === className)?.cls ?? null;
}

function canEditNpcAttackOnSheet(sheet, item) {
  return sheet?.actor?.type === "npc" && sheet.actor?.isOwner === true && isPhysicalNpcAttack(item);
}

function patchNpcAttackContextMenu() {
  if (_npcAttackContextMenuPatched) return;

  const sheetClass = getSheetClassByName("npc", "ConanNPCSheet");
  const proto = sheetClass?.prototype;
  if (!proto?._getItemContextOptions) return;

  _npcAttackContextMenuPatched = true;
  const original = proto._getItemContextOptions;

  proto._getItemContextOptions = function c2mqGetItemContextOptions(...args) {
    const options = Array.from(original.call(this, ...args) ?? []);
    if (options.some((option) => option?.c2mqNpcAttackUnequip === true)) return options;

    const unequipOption = {
      name: game.i18n.localize("C2MQ.Button.NpcAttackUnequip"),
      icon: '<i class="fa-solid fa-shirt"></i>',
      c2mqNpcAttackUnequip: true,
      condition: (target) => {
        const item = this.actor?.items?.get?.(target?.dataset?.itemId);
        return canEditNpcAttackOnSheet(this, item) && !isNpcAttackUnequipped(item);
      },
      callback: async (target) => {
        const item = this.actor?.items?.get?.(target?.dataset?.itemId);
        if (!canEditNpcAttackOnSheet(this, item)) return;
        await setNpcAttackUnequipped(item, true);
        this.render(false);
      }
    };

    const deleteIndex = options.findIndex((option) => String(option?.icon ?? "").includes("fa-trash"));
    if (deleteIndex >= 0) options.splice(deleteIndex, 0, unequipOption);
    else options.push(unequipOption);

    return options;
  };

  console.info(`[${MODULE_ID}] patched ConanNPCSheet item context menu for NPC attack equipment`);
}

function ensureUnequippedButton({ app, row, item }) {
  if (!row || row.querySelector(".c2mq-npcattack-equip-toggle")) return;

  const controls = row.querySelector(".item-controls");
  if (!controls) return;

  const button = document.createElement("a");
  button.classList.add("item-control", "c2mq-npcattack-equip-toggle");
  button.setAttribute("title", game.i18n.localize("C2MQ.Button.NpcAttackEquip"));
  button.innerHTML = '<i class="fa-solid fa-shirt"></i>';
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!app?.actor?.isOwner) return;
    await setNpcAttackUnequipped(item, false);
    app.render(false);
  });

  const attackButton = controls.querySelector(".item-control__attack");
  if (attackButton) attackButton.before(button);
  else controls.prepend(button);
}

function enhanceNpcAttackEquipmentControls(app, html) {
  if (app?.actor?.type !== "npc") return;

  const root = getHtmlRoot(html);
  if (!root) return;

  for (const item of app.actor.items ?? []) {
    if (!isPhysicalNpcAttack(item)) continue;

    const row = root.querySelector(`[data-item-id="${cssEscape(item.id)}"]`);
    if (!row) continue;

    const unequipped = isNpcAttackUnequipped(item);
    row.classList.toggle("c2mq-npcattack-unequipped", unequipped);
    if (unequipped) ensureUnequippedButton({ app, row, item });
  }
}

export function registerNpcAttackEquipmentHooks() {
  if (_npcAttackEquipmentHooksRegistered) return;
  _npcAttackEquipmentHooksRegistered = true;

  Hooks.once("ready", patchNpcAttackContextMenu);
  Hooks.on("renderConanNPCSheet", enhanceNpcAttackEquipmentControls);
}
