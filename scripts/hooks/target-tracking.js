import { MODULE_ID } from "../constants.js";
import { scheduleCurrentUserTargetSnapshotSync } from "../state/user-target-store.js";

let _targetTrackingHooksRegistered = false;

export function registerTargetTrackingHooks() {
  if (_targetTrackingHooksRegistered) return;
  _targetTrackingHooksRegistered = true;

  Hooks.on("targetToken", (user) => {
    if (!user || user.id !== game.user?.id) return;
    scheduleCurrentUserTargetSnapshotSync();
  });

  Hooks.on("canvasReady", () => {
    scheduleCurrentUserTargetSnapshotSync({ force: true });
  });

  Hooks.once("ready", () => {
    scheduleCurrentUserTargetSnapshotSync({ force: true });
    console.debug?.(`[${MODULE_ID}] target tracking active`);
  });
}