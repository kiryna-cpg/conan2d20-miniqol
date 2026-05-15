# Conan 2d20 - Mini QoL

Mini QoL is a focused combat companion for **Foundry VTT v14** and **Robert E. Howard's Conan: Adventures in an Age Undreamed Of**.

It keeps the Conan system's native workflow and adds chat-card automation for targets, damage, reactions, Reach/Guard, Sacrificial Armor, and Momentum/Doom helper flows.

## v14 status

- Foundry VTT: **v14**
- Conan 2d20 system: **2.5.0**
- Languages: English and Spanish
- Reach Status is now integrated directly into Mini QoL.

The old standalone `conan2d20-reach-status` module should be disabled in v14 worlds to avoid duplicate Reach automation.

## Main features

### Attack and damage chat workflow
- Target sync / clear directly on attack and damage cards.
- Inline **Defend**, **Roll Damage**, **Apply**, **Undo**, **Apply All**, and **Undo All** controls.
- Conan-aware physical and mental damage application.
- Safe Undo from stored `ChatMessage.flags` state.
- GM-safe socket routing for player-side Apply/Undo requests.

### Native Conan integration
- Preserves the native Conan roll workflow.
- Enhances native attack and damage cards without replacing the system sheets or rollers.
- Uses Conan system data for damage, armor, stress, hit location, Doom, and Momentum workflows where available.

### Reactions
- Inline **Defend** prompts on attack cards.
- Linked defense roll summaries and navigation back to the original attack.
- Optional Protect support.
- Retaliate support.
- Doom-cost validation for relevant reaction flows.

### Reach / Guard
- Automatic Reach status icons on tokens.
- Reach-aware difficulty assistance for melee attacks.
- Reach preview in native attack dialogs.
- Guard-aware handling and Break Guard helper.
- Legacy Reach Status flags are read for migration compatibility.

### Hit location and Sacrificial Armor
- Optional hit location support stored per target.
- Sacrificial Armor / Shield support using Conan system coverage data.
- Undo restores actor and item state.
- Optional sacrificial weapon support.

## Recommended settings

World Settings → **Conan 2d20 - Mini QoL**

Suggested baseline:

- **Auto Reach Difficulty**: ON
- **Enable Reach Status icons**: ON
- **Show Reach 1 icon**: table preference
- **Use Hit Location**: ON
- **Enable Sacrificial Armor**: ON
- **Automatic Protect reaction**: OFF
- **Allow players to request Apply/Undo**: ON
- **Show Apply All**: ON

## Requirements

- Foundry VTT: `14`
- Conan 2d20 system: `2.5.0`

## Installation

Install with this manifest URL:

```txt
https://raw.githubusercontent.com/kiryna-cpg/conan2d20-miniqol/main/module.json
```

After updating from v13, do a full Foundry application reload. Disable `conan2d20-reach-status` if it is still active.

## Support

Report issues at:

```txt
https://github.com/kiryna-cpg/conan2d20-miniqol/issues
```

Include Foundry version, Conan system version, active companion modules, reproduction steps, and console logs.

## License

MIT.
