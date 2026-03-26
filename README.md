# Conan 2d20: Mini QoL

Mini QoL is a lightweight combat companion for **Foundry VTT** and **Robert E. Howard’s Conan: Adventures in an Age Undreamed Of**.

It keeps the Conan system’s native workflow and adds the missing glue for **targets, damage, reactions, Reach/Guard, and post-hit combat helpers**.

## What it does

- Enriches **attack cards** and **native Conan damage cards** with:
  - target sync / clear
  - **Roll Damage**
  - **Apply / Undo**
  - **Apply All** (optional)
  - **Damage Details**
  - **Momentum Spends** reference
  - inline **Break Guard** helper
- Applies Conan-aware **physical** and **mental** damage.
- Handles **soak**, **wounds / traumas**, and **Undo** safely from chat.
- Supports optional **Hit Location** for physical attacks.
- Supports **Sacrificial Armor / Shield** using the system’s real armor coverage.
- Supports **Defend**, optional **Protect**, and **Retaliate** using Conan’s native dialogs.
- Adds **Reach / Guard** assistance for melee combat.
- Works in **English** and **Spanish**.

## Typical flow

1. Make an attack with the normal Conan system workflow.
2. On the chat card, use the **target icon**:
   - if the card already has stored targets, clicking it clears them
   - if the card has no stored targets, clicking it captures your current canvas targets
3. Roll damage.
4. Review **Damage Details** and **Momentum Spends**.
5. **Apply** or **Undo** per target.

## Scope

Mini QoL is focused on **combat chat workflow and combat assistance**.

It is **not**:
- a replacement for Argon or another combat HUD
- a full action-economy manager
- a full abstract-zones / engagement module

## Main features

### Damage workflow
- Chat-based **Roll Damage / Apply / Undo**
- One-apply-per-target protection until Undo
- Persistent message state stored in `ChatMessage.flags`
- GM-safe socket routing for player-side Apply/Undo requests

### Damage details and helpers
- Damage Type
- Combat dice breakdown
- Effects rolled
- Momentum / Doom spent on damage
- Weapon quality / effect tags when present
- Compact **Momentum Spends** reminder for combat

### Reach / Guard
- Reach-aware difficulty assistance
- Reach preview in native rollers
- Guard-aware handling
- Inline **Break Guard** helper when eligible

### Reactions
- **Defend**
- **Protect** (optional, off by default)
- **Retaliate**
- Native roller routing for reaction flows

### Sacrificial Armor
- Uses real Conan coverage data: `item.system.coverage.value`
- Armor loses coverage by struck location
- Shields and sacrificed items are marked broken
- Undo restores actor and item state

## Recommended settings

World Settings → **Conan 2d20: Mini QoL**

Good baseline setup:
- **Auto Reach Difficulty**: ON
- **Use Hit Location**: ON
- **Enable Sacrificial Armor**: ON
- **Automatic Protect reaction**: OFF
- **Allow players to request Apply/Undo**: ON

## Requirements

- **Foundry VTT**: `13.351`
- **Conan 2d20 system**: `2.4.3`

## Installation

1. Foundry → **Add-on Modules** → **Install Module**
2. Paste this manifest URL:

   `https://raw.githubusercontent.com/kiryna-cpg/conan2d20-miniqol/main/module.json`

3. Install the module
4. Enable **Conan 2d20: Mini QoL** in your world
5. **Reload Application**

## Notes

- Mini QoL is designed specifically for the **Conan 2d20** Foundry system.
- The chat controls survive **Reload Application** because state is stored in message flags.
- Reach-sensitive logic uses current scene/token context today and can later integrate with an external engagement provider.
- Native Conan **damage roll cards** can also receive Mini QoL controls.

## Support

- Issues: https://github.com/kiryna-cpg/conan2d20-miniqol/issues
- Repo: https://github.com/kiryna-cpg/conan2d20-miniqol

## License

MIT. See `LICENSE`.