# Changelog

All notable changes to this project will be documented in this file.

This project follows a lightweight versioning style.

## [Unreleased]
### Planned
- Combat Momentum spend interception / resolution.
- Broader metacurrency-aware combat helpers.
- Optional future integration points for external engagement / zones tooling.

---

## [13.3.10] - 2026-05-17
### Added
- Added a real **Called Shot** Momentum spend for physical attacks when Hit Location support is enabled.
- Called Shot costs 2 Momentum, lets the user choose the hit location, stores the allocation on the attack message, and applies that location to Roll Damage / Apply Damage.

### Changed
- Momentum committed summaries now show Bonus Damage and Called Shot explicitly.
- Damage re-rolls preserve Called Shot locations instead of replacing them with random hit locations.

### Fixed
- Removed the duplicated committed Momentum summary row that could show Penetration in place of Re-roll Damage.

---

## [13.3.9] - 2026-05-16
### Fixed
- Players who own the attacking actor/token can now see and use attack-card damage controls even when the chat message author is not that player.
- Socket-side validation for Roll Damage, Re-roll Damage, Apply, Apply All, Set Targets, and Break Guard now accepts actor/token ownership instead of relying only on chat message authorship.
- Failed Defense rolls that generated successes but did not beat the attack no longer trigger the “apply damage anyway” confirmation dialog.

---

## [13.3.8] - 2026-05-16
### Added
- Integrated the standalone **Conan 2d20 - Reach Status** module into Mini QoL for the Foundry v13 line.
- Added automatic token status icons for **Reach 1**, **Reach 2**, **Reach 3**, and **No Reach** under Mini QoL ownership.
- Added Mini QoL settings for enabling Reach Status sync and for controlling automatic **Reach 1** display.
- Added compatibility reading for legacy `conan2d20-reach-status` flags and migrated the legacy `showReach1` setting when present.

### Changed
- Mini QoL is now the owner of Reach Status automation for the v13 line alongside existing Reach/Guard assistance.
- Updated release metadata and manifest versioning for **13.3.8**.

### Fixed
- Avoided duplicate Reach automation when the old standalone Reach Status module remains active.
- Hardened Reach Status sync around stale or transient token actors.

---

## [0.2.20] - Final 0.2.x release
### Added
- Inline **Defend** flow on attack cards, using Conan’s native defensive roll workflow.
- Linked defense-roll summary block with:
  - Doom spent / paid context
  - reaction result
  - navigation back to the originating attack roll
- Cleaner **Roll Damage** UI integrated into the attack-card flow.
- Compact, icon-driven card controls for:
  - target sync
  - Defend
  - go to defense roll
  - go to attack roll
  - Roll Damage
  - Apply / Undo
  - Apply All / Undo All
- Large inline damage summary presentation on attack cards.
- **Undo All** support for fully applied multi-target attacks.
- Safer UI fusion for reaction-related Doom chat output.

### Changed
- Reworked attack-card layout to keep the highest-frequency combat actions directly on the original card.
- Reworked standalone damage-card presentation so Mini QoL only keeps the useful controls there.
- Reworked **Defend** into a non-blocking, inline, card-driven flow instead of a modal-heavy confirmation flow.
- Refined reaction state handling so unresolved Defend prompts do not auto-resolve on unrelated later actions.
- Refined combat-card visual language around damage state, reaction state, and icon-based navigation.
- Promoted this build as the closing release for the **0.2.x** combat-chat workflow line.

### Fixed
- Fixed cases where canceled or unresolved Defense rolls could leave the attack card in an incorrect state.
- Fixed cases where unrelated later rolls could incorrectly resolve a prior Defend prompt.
- Fixed reaction Doom chat duplication so the system’s separate Doom-paid / Doom-spent cards no longer clutter the flow for reaction rolls.
- Fixed multiple alignment and layout regressions on target rows and inline controls.
- Fixed standalone damage-card duplication and redundant damage presentation.
- Fixed Apply/Undo state presentation across repeated attack-card updates.
- Fixed several reaction continuation edge cases around card refresh and linked chat navigation.

### UX
- Significantly reduced popup noise during combat.
- Improved visibility of damage, reaction state, and per-target actions directly on the chat cards.
- Improved readability and consistency of attack, defense, and damage cards in both English and Spanish.

---

## [0.2.0]
### Added
- Mini QoL support for **native Conan damage cards**, including damage rolls launched from Actions and other system damage workflows.
- Inline **Damage Details** on attack and damage chat cards, including:
  - Damage Type
  - Number of dice
  - Effects generated
  - Momentum / Doom spent on damage
  - Weapon quality / effect tags when present
- Inline **Momentum Spends** reference block on successful attack cards.
- Inline **Break Guard** helper on eligible attack results.
- Safer **target sync toggle** on chat cards.
- Runtime safeguard for the Conan system `damageRoll()` macro zero-spend counter edge case.
- Auto-fit for the native attack dialog after Mini QoL injects Reach-related UI.

### Changed
- Promoted the module to **0.2.0** as the next combat automation milestone after the first stable 0.1.x release.
- Reworked **Break Guard** from popup confirmation into an inline helper on the attack card.
- Reworked target management into a single icon-based target sync control.
- Refined attack-card layout so target controls no longer crowd Apply/Undo.

### Fixed
- Fixed native **Roll Damage** cards so they also receive Mini QoL controls.
- Fixed target sync behavior so stored targets are not accidentally overwritten by a new canvas selection.
- Fixed duplicated tooltip display on the target sync control.
- Fixed the Conan system `damageRoll()` macro edge case that could throw `Error updating Counter: Invalid Value Type` when no Momentum or Doom was spent.
- Fixed several Reach-handling edge cases around Guard and dialog preview.

---

## [0.1.0]
### Added
- First stable combat-focused release milestone.
- Chat workflow block for successful attacks with damage:
  - Roll Damage
  - Apply Damage per target
  - Undo Damage per target
- Conan Combat Dice rolling
- Target capture from current selection
- Basic Conan-aware soak handling for PCs, NPCs, and mental damage
- Persistent chat UI based on message flags
- Initial Sacrificial Armor / Shield support

---

## [0.0.x]
### Added
- Combat workflow foundation.
- Early Apply/Undo state tracking.
- Initial hit-location-aware damage handling.
- Early reaction, Reach, and Guard support.

---

## Versioning notes
- `v0.0.x`: combat workflow foundation
- `v0.1.x`: first stable combat QoL milestone
- `v0.2.x`: mature combat chat workflow, native-card support, inline reactions, and major UI cleanup
- `v0.3.x`: planned metacurrency-aware combat flow and broader automation