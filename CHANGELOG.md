# Changelog
All notable changes to this project will be documented in this file.

This project follows a lightweight versioning style until v0.2.

## [Unreleased]
### Added
- Optional homebrew rules toggle(s) based on provided documents (planned).

### Changed
- Reach/Guard automation may be expanded to integrate system-native dialogs (planned).

---

## [0.0.2] - Current
### Added
- Stable Apply/Undo workflow:
  - **Undo Damage** per target from chat.
  - **Apply Damage locking**: an attack message can be applied **only once per target** unless undone.
- Persistent chat UI:
  - MiniQoL block remains visible after reload (chat re-render + flag bootstrap).
- Sacrificial Armor / Shield (optional):
  - When used, the sacrificed item is marked **broken** (`item.system.broken = true`).
  - Undo restores the item to unbroken.

### Fixed
- Fixed `applied`/`hitLocation` storage in message flags:
  - Token UUIDs contain dots (`Scene.X.Token.Y`) which caused Foundry to expand object keys into nested objects.
  - MiniQoL now stores and reads target keys using a safe encoding and normalizes legacy/nested data.
- Fixed Apply/Undo detection in UI:
  - Correctly reflects applied state and re-enables Apply after Undo.

---

## [0.0.1] - Initial public iteration
### Added
- Chat workflow block for successful attacks with damage:
  - Roll Damage button
  - Apply Damage per target
- Combat Dice rolling (d6 mapping to Conan CD).
- Target handling:
  - Capture targets from current selection
  - “Use current targets” action for post-roll targeting
- Soak support (RAW-aligned schema):
  - PCs: location-based soak from `system.armor.<loc>.soak`
  - NPCs: flat soak from `system.armor`
  - Mental soak from `system.health.courage`

---

## Versioning notes
- v0.0.x: combat workflow focus (damage roll/apply/undo, persistence)
- v0.2+: quality/effects automation, expanded rules coverage (optional)