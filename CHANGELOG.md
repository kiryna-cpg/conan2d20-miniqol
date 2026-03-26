# Changelog
All notable changes to this project will be documented in this file.

This project follows a lightweight versioning style.

## [Unreleased]
### Added
- Optional integration hooks for a future abstract zones / engagement provider (planned).

### Changed
- Momentum spend reminders may be expanded with more contextual combat options (planned).

---

## [0.1.0] - Current
### Added
- Mini QoL support for **native Conan damage cards**, including damage rolls launched from Actions and other system damage workflows.
- Full **Momentum Spends** reference block on attack cards, showing the standard combat spend list in a compact tooltip-driven format.
- Safer **target sync toggle** on chat cards:
  - if stored targets exist, clicking the target icon clears them
  - if no stored targets exist, clicking the icon captures the current canvas targets
- Runtime safeguard from Mini QoL for the Conan system `damageRoll()` macro zero-spend counter edge case.

### Changed
- Promoted the module to **0.1.0** as the first combat-focused release milestone.
- Reworked target management into a single **icon-based target sync control** in the card header.
- Reworked **Break Guard** presentation to use the Conan **Guard Broken** icon inline.
- Refined attack-card layout so target controls no longer crowd **Pending / Apply / Undo**.
- Shortened and reorganized the README for release-facing documentation.

### Fixed
- Fixed native **Roll Damage** cards so they also receive Mini QoL controls.
- Fixed target sync behavior so stored targets are not accidentally overwritten by a new canvas selection.
- Fixed duplicated tooltip display on the target sync control.
- Fixed the Conan system `damageRoll()` macro edge case that could throw `Error updating Counter: Invalid Value Type` when no Momentum or Doom was spent.
- Fixed the inline phoenix sigil display in chat presentation.

---

## [0.0.4]
### Added
- Inline **Damage Details** on attack chat cards, including:
  - Damage Type
  - Number of dice
  - Effects generated
  - Momentum/Doom spent on damage
  - Weapon quality / effect tags when present
- Inline **Momentum Spends** helper on successful attack cards.
- Inline **Break Guard** helper/button on eligible attack results.
- **Remove Target** control on attack chat cards to remove an incorrectly selected target before applying damage.
- Target list remains visible on the attack card even before damage is rolled.

### Changed
- Reworked **Break Guard** flow from popup confirmation to an inline helper on the attack card.
- Updated the existing Break Guard setting so it now controls inline helper visibility instead of a modal dialog.
- Improved attack card readability by moving more combat context directly into chat instead of spawning extra dialogs.
- Improved target management directly from the attack card.

### Fixed
- Fixed `autoApplyEnabled is not defined` error during reaction resolution.
- Fixed a regression where skill rollers could open at **D0** instead of their intended default / configured difficulty.
- Fixed reaction Momentum/Doom escalation reset so it resets correctly on **new rounds**.
- Fixed `Threaten` incorrectly generating **Hit Location**.
- Fixed invalid `Retaliate` prompts caused by defensive / non-eligible contexts.
- Fixed canceled **Defense** rolls leaving the original attack unresolved in chat.
- Fixed **Ranged Attacks** not triggering **Retaliate** when enemies were actually within Reach.
- Fixed reaction eligibility filtering so invalid offensive / defensive contexts are excluded more reliably.
- Fixed hit-location-sensitive workflows so they only apply where appropriate.

### UX
- Reduced intrusive combat popups by moving key post-hit decisions into the chat card itself.
- Improved post-roll readability with expandable damage details and contextual Momentum reminders.

---

## [0.0.3]
### Added
- **Reach / Guard** combat helpers for melee-like attacks:
  - Reach-aware difficulty assistance
  - Reach preview note in the native skill roller
  - Ignore Reach penalty when the defender has **Guard Broken** or **Prone**
- Optional **Break Guard** support for successful attacks that generate **2+ Momentum**.
- Optional **Hit Location** support stored per target and reused for Conan armor soak workflows.
- Expanded **Sacrificial Armor / Shield** support:
  - Uses Conan system real armor coverage (`item.system.coverage.value`)
  - Sacrificed armor loses coverage for the struck location first
  - Shields / items are marked broken when sacrificed
  - Undo restores both actor state and sacrificed item state
- Automated **reaction pipeline** for Conan combat:
  - **Defend**
  - **Protect** (optional, world setting, disabled by default)
  - Initial **Retaliate** support
- Native roll routing helpers so reactions use Conan system dialogs:
  - native skill rolls
  - native defense rolls
  - native weapon attack rolls
- Reaction-aware Momentum/Doom bank handling for PCs and NPCs.

### Changed
- Improved combat message state so reaction resolution and damage workflow can continue on the original attack card.
- Refined Reach handling to align more closely with Conan combat assumptions instead of treating proximity as a flat same-zone shortcut.
- Protect automation was moved behind a dedicated **world setting** and left disabled by default.

### Fixed
- Fixed Sacrificial Armor to use real Conan system coverage instead of simplified assumptions.
- Fixed sacrificial item restoration on Undo so broken/coverage state is restored correctly.
- Fixed reaction continuation flow so attack resolution can proceed after defensive reactions.
- Fixed multiple reaction / routing edge cases around native dialog bridging.

---

## [0.0.2]
### Added
- Stable Apply/Undo workflow:
  - **Undo Damage** per target from chat
  - **Apply Damage locking**: an attack message can be applied only once per target unless undone
- Persistent chat UI:
  - Mini QoL block remains visible after reload
- Sacrificial Armor / Shield (optional):
  - sacrificed items are marked **broken**
  - Undo restores the item state

### Fixed
- Fixed `applied` / `hitLocation` storage in message flags for token UUID keys.
- Fixed Apply/Undo detection in UI so Apply re-enables correctly after Undo.

---

## [0.0.1] - Initial public iteration
### Added
- Chat workflow block for successful attacks with damage:
  - Roll Damage
  - Apply Damage per target
- Conan Combat Dice rolling
- Target capture from current selection
- Basic Conan-aware soak handling for PCs, NPCs, and mental damage

---

## Versioning notes
- `v0.0.x`: combat workflow foundation
- `v0.1.x`: first stable combat QoL milestone
- future releases: broader integration layers, optional engagement/zones support, and more contextual helpers