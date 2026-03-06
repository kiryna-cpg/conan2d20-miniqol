# Conan 2d20 Mini QoL (Foundry VTT)

Small quality-of-life automation module for **Robert E. Howard's Conan: Adventures in an Age Undreamed Of (Conan 2d20)** on Foundry VTT.

This module focuses on **combat damage workflow**: roll damage from chat, apply to targets, undo, and prevent repeated application of the same attack to the same target.

## Compatibility

- Foundry VTT: **v13.351** (tested)
- System: **conan2d20 v2.4.3** (tested)
- Module: `conan2d20-miniqol`

## Features

### Damage workflow in Chat
After a successful attack that has damage defined on the item:

- **Roll Damage** button appears on the chat message.
- Damage is rolled as **Conan Combat Dice** (d6 mapping).
- You can select one or more targets and:
  - **Apply** damage to each target
  - **Undo** damage per target
- **Idempotent application**: the same chat attack can be applied **only once per target** until it is undone.

### Persistence (survives reload)
The module stores workflow state in the **ChatMessage flags**. That means:
- the MiniQoL block persists on reload
- applied/undo state is still available after refresh

### RAW-friendly hooks
The module uses the system’s canonical data when available:
- Reads damage dice/type from `message.flags.data.item.system.damage`
- Applies Stress/Harms to:
  - Physical: `system.health.physical.value`, `system.health.physical.wounds.value`
  - Mental: `system.health.mental.value`, `system.health.mental.traumas.value`
- Soak:
  - PCs: `system.armor.<location>.soak`
  - NPCs: `system.armor` (flat number)
  - Mental soak: `system.health.courage`

### Sacrificial Armor / Shield (optional)
If enabled, when an attack would inflict a Wound:
- the module can prompt to use **Sacrificial Armor** (once per scene scope)
- the sacrificed armor/shield is marked as **broken** (`item.system.broken = true`)
- Undo restores it to unbroken

> Note: This is a simplified v0.1 implementation; some RAW shield/guard interactions may be expanded in later versions.

## Installation

1. Place the module folder in:
   - `FoundryVTT/Data/modules/conan2d20-miniqol`
2. Enable the module in:
   - *Game Settings → Manage Modules*
3. Reload Foundry (*Reload Application*)

## Usage

1. Make a **successful attack** with an item that has damage (e.g. weapon, display).
2. In chat, click **Roll Damage**.
3. Select target tokens (Foundry targeting), then:
   - Click **Apply** for each target, or
   - Use **Use current targets** if you targeted after rolling
4. If needed, click **Undo** on the same target to revert the exact applied changes.

## Settings (World)

- **Auto-roll damage**: automatically roll damage when the attack chat message is created.
- **Auto-apply damage (single target)**: if exactly one target was captured, auto-apply after auto-roll.
- **Use Hit Location**: rolls hit location per target (used for location soak).
- **Enable Sacrificial Armor**: prompts for sacrificial use (and breaks the item).
- **Allow players to request Apply/Undo**: players can click Apply/Undo; execution is GM-first via socket.
- **Show Apply All**: shows Apply All when multiple targets are present.

Client:
- **Debug logging**: additional console logs.

## How it works (technical)

- Chat UI is injected via `renderChatMessage` and persisted via `ChatMessage.flags.conan2d20-miniqol`.
- Actions are GM-authoritative when possible:
  - players emit socket requests
  - GM processes apply/undo and updates the actor/message
- Applied state is tracked per message per target, and Undo stores and restores exact patches.

## Known limitations

- Some advanced combat rules are not automated yet (planned for later versions):
  - Reach/Guard full automation
  - Shield Soak button integration
  - Full cover/morale soak dice workflow
  - Quality/effects automation beyond basic damage
- This module assumes the Conan2d20 system data schema tested on v2.4.3.

## Roadmap

- v0.0.2: Reach/Guard difficulty helpers (RAW default) + optional homebrew toggles
- v0.2+: expanded soak dice flows, qualities/effects automation (optional), more integrations

## License

MIT (see module.json)

## Credits

- Modiphius Conan 2d20 system for Foundry VTT
- Foundry Virtual Tabletop