# Changelog

All notable changes to this project will be documented in this file.

## [0.4.2] - 2026-05-15
### Changed
- Updated release metadata for Foundry VTT v14 and Conan 2d20 system 2.5.0.
- Updated README and manifest links for the v14 release line.
- Replaced deprecated global `loadTemplates` access with the v14 namespaced Handlebars helper.

### Fixed
- Fixed chat rendering for player users when Apply/Undo request permissions are evaluated.
- Fixed Mini QoL chat rendering to use `renderChatMessageHTML` and HTMLElement-safe handling.
- Hardened integrated Reach Status sync around deleted or transient token actors.

## [0.4.1] - 2026-05-15
### Fixed
- Fixed v14 chat hook compatibility for Mini QoL card injection.
- Fixed player-side `allowPlayerRequests` lookup during chat rendering.
- Replaced deprecated global `renderTemplate` access with the v14 namespaced Handlebars helper.

## [0.4.0] - 2026-05-15
### Added
- Integrated the standalone Reach Status module into Mini QoL.
- Added automatic Reach status icons for `Reach 1`, `Reach 2`, `Reach 3`, and `No Reach`.
- Added Reach Status settings for enabling icon sync and controlling automatic Reach 1 icon display.
- Added compatibility reading for legacy `conan2d20-reach-status` flags.

### Changed
- Mini QoL is now the owner of Reach/Guard assistance and Reach Status automation for v14.
- Updated compatibility target to Foundry VTT v14 and Conan 2d20 system 2.5.0.

### Fixed
- Avoided duplicate Reach automation when the old standalone Reach Status module remains active.

## [0.3.x]
### Added
- Combat QoL workflow for damage, reactions, Reach/Guard assistance, Sacrificial Armor, and Momentum helper flows.

## [0.2.x]
### Added
- Native Conan attack and damage chat-card enhancements.
- Inline Defend and damage application flows.

## [0.1.x]
### Added
- Initial combat-focused chat workflow.
