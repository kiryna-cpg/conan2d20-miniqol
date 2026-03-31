# Conan 2d20: Mini QoL

Mini QoL is a focused combat companion for **Foundry VTT** and **Robert E. Howard’s Conan: Adventures in an Age Undreamed Of**.

It keeps the Conan system’s native workflow and adds the missing glue for **targets, damage, reactions, Reach/Guard, and post-hit combat helpers**, centered on the chat cards players already use.

## Current scope

Mini QoL is focused on **combat chat workflow and combat assistance**.

It is **not**:
- a replacement for Argon or another combat HUD
- a full action-economy manager
- a full abstract-zones / engagement module

## Main features

### Attack card improvements
- Enriched **attack cards** with:
  - target sync / clear
  - inline **Defend**
  - **Roll Damage**
  - target-by-target **Apply / Undo**
  - optional **Apply All / Undo All**
  - inline **Break Guard**
  - **Momentum Spends** reminder block
- Damage state is surfaced directly in the target row.
- Damage presentation stays visible on the original attack card.

### Damage workflow
- Chat-based **Roll Damage / Apply / Undo**
- Conan-aware **physical** and **mental** damage application
- Safe **Undo** from chat
- One-apply-per-target protection until undone
- Persistent message state stored in `ChatMessage.flags`
- GM-safe socket routing for player-side Apply/Undo requests

### Damage presentation
- Expanded inline damage block on attack cards
- Large damage summary matching the Conan damage presentation style
- Combat dice breakdown
- Number of dice
- Hit location
- Effects rolled
- Momentum / Doom spent on damage
- Weapon quality / effect tags when present

### Native Conan damage cards
- Mini QoL also enhances **native Conan damage cards**
- Standalone damage cards are kept intentionally compact:
  - targets
  - Apply / Undo
  - target sync / clear
- Redundant duplicate damage presentation is removed from those standalone cards

### Reactions
- **Defend** is handled as an inline chat-card reaction
- Linked defense roll cards show:
  - Doom spent / paid for the reaction
  - reaction result
  - navigation back to the attack roll
- Optional **Protect** support
- **Retaliate** support
- Native Conan roller routing is preserved for reaction flows

### Reach / Guard
- Reach-aware difficulty assistance
- Reach preview in native attack dialogs
- Guard-aware handling
- Lost Guard / Guard Broken handling
- Inline **Break Guard** helper when eligible

### Hit location and Sacrificial Armor
- Optional **Hit Location** support stored per target
- **Sacrificial Armor / Shield** support uses Conan system coverage data
- Armor loses coverage by struck location
- Shields and sacrificed items are marked broken
- Undo restores actor and item state
- Optional sacrificial weapons support

### Languages
- UI strings and visible combat labels are available in:
  - **English**
  - **Spanish**

## Typical flow

1. Make an attack with the normal Conan system workflow.
2. Use the target button on the chat card:
   - if stored targets exist, clicking clears them
   - if there are no stored targets, clicking captures the current canvas targets
3. If the attack can be defended, the card shows **Defend** inline.
4. Use **Roll Damage** from the same attack card.
5. Review the inline damage block and Momentum reminder.
6. **Apply / Undo** damage per target, or use **Apply All / Undo All** when appropriate.

## Recommended settings

**World Settings → Conan 2d20: Mini QoL**

Good baseline setup:
- **Auto Reach Difficulty**: ON
- **Use Hit Location**: ON
- **Enable Sacrificial Armor**: ON
- **Automatic Protect reaction**: OFF
- **Allow players to request Apply/Undo**: ON
- **Show Apply All**: ON

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
- Native Conan damage cards can also receive Mini QoL controls.
- The module is intentionally chat-card driven: it complements the system’s native dialogs rather than replacing them.

## Support

- Issues: `https://github.com/kiryna-cpg/conan2d20-miniqol/issues`
- Repo: `https://github.com/kiryna-cpg/conan2d20-miniqol`

## License

MIT