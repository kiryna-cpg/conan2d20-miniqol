# Conan 2d20: Mini QoL

Quality-of-life companion module for the Foundry VTT system **“Robert E. Howard’s Conan: Adventures in an Age Undreamed Of”**.

This module focuses on **combat damage workflow**: roll damage from chat, apply it to targets, undo it, and prevent repeated application of the same attack to the same target.

---

## Features

- Adds a MiniQoL block to **successful** damage-capable chat rolls:
  - **Roll Damage**
  - **Apply Damage**
  - **Undo Damage**
- Damage is rolled using **Conan Combat Dice** (d6 mapping).
- Target workflow:
  - Captures current targets automatically, or
  - Use **Use current targets** after the roll
- **Apply locking (idempotent):**
  - The same attack message can be applied **only once per target**
  - To apply again, you must **Undo** first
- **Persistence:**
  - MiniQoL state is stored in `ChatMessage.flags`
  - The block survives **Reload Application**
- Optional **Sacrificial Armor / Shield**:
  - When used, the sacrificed item is marked **broken** (`item.system.broken = true`)
  - Undo restores it to unbroken

---

## Requirements

- Foundry VTT: v13 (**tested with 13.351**)
- System: Robert E. Howard’s Conan 2d20 (**tested with 2.4.3**)

---

## Installation

### Install via Manifest URL (recommended)

1. Foundry → Add-on Modules → Install Module
2. Paste this Manifest URL:
   - https://raw.githubusercontent.com/kiryna-cpg/conan2d20-miniqol/main/module.json
3. Install, then enable it in your world:
   - World → Manage Modules → enable “Conan 2d20: Mini QoL”
4. Reload Application

---

## What this module automates

### Chat workflow

For successful rolls where the system provides item damage data:

- Roll damage from chat (Combat Dice)
- Apply damage to selected targets
- Undo damage per target
- Prevent repeated Apply on the same target until Undo

---

## Settings

World Settings → **Conan 2d20: Mini QoL**

- Auto-roll damage
- Auto-apply damage (single target)
- Use Hit Location
- Enable Sacrificial Armor
- Allow players to request Apply/Undo (GM-authoritative via socket)
- Show Apply All
- Debug logging

---

## Support / Issues

Report issues or request improvements here:

- https://github.com/kiryna-cpg/conan2d20-miniqol/issues

When reporting, include:

- Foundry version
- Conan 2d20 system version
- Steps to reproduce + console logs (F12)

## License

MIT. See LICENSE.