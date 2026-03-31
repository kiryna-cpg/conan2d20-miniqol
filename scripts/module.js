import { TEMPLATE_PATHS, MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { registerSocket } from "./socket.js";
import { registerChatHooks } from "./hooks/chat.js";
import { registerReachHooks } from "./hooks/reach.js";
import { registerCombatStateHooks } from "./hooks/combat-state.js";
import { registerSkillRollerBridge } from "./hooks/skill-roller-bridge.js";
import { registerTargetTrackingHooks } from "./hooks/target-tracking.js";
import {
  openNativeSkillRoll,
  openNativeDefenseRoll,
  openNativeWeaponAttack
} from "./adapter/system-rolls.js";
import { resolveWithinReach } from "./adapter/engagement.js";
import { consumeReactionRollUiFusionForUser } from "./state/reaction-roll-ui-store.js";

function buildPublicApi() {
  return {
    openNativeSkillRoll,
    openNativeDefenseRoll,
    openNativeWeaponAttack,
    resolveWithinReach
  };
}

function patchConanMomentumTrackerZeroDiff() {
  const tracker = globalThis.conan?.apps?.MomentumTrackerV2;
  if (!tracker?.changeCounter) return false;
  if (tracker.__c2mqZeroDiffPatched === true) return true;

  const originalChangeCounter = tracker.changeCounter.bind(tracker);

  tracker.changeCounter = async function patchedChangeCounter(diff, type) {
    const numericDiff = Number(diff);

    // Conan system macro damageRoll() can call changeCounter(-0, ...)
    // when no Momentum/Doom was spent. The system tracker rejects 0 as invalid.
    // From MiniQoL we safely no-op only that exact case.
    if ((type === "momentum" || type === "doom") && Number.isFinite(numericDiff) && numericDiff === 0) {
      return game.settings?.get?.("conan2d20", type) ?? 0;
    }

    return originalChangeCounter(diff, type);
  };

  Object.defineProperty(tracker, "__c2mqZeroDiffPatched", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  console.info(`[${MODULE_ID}] patched MomentumTrackerV2.changeCounter for zero-diff safety`);
  return true;
}

function patchConanReactionDoomChatFusion() {
  const actorProto =
    CONFIG.Actor?.documentClass?.prototype ??
    game.actors?.documentClass?.prototype ??
    null;

  if (!actorProto?.payDoom || !actorProto?.spendDoom) return false;
  if (actorProto.__c2mqReactionDoomChatFusionPatched === true) return true;

  const originalPayDoom = actorProto.payDoom;
  const originalSpendDoom = actorProto.spendDoom;

  actorProto.payDoom = async function patchedPayDoom(doomSpend, ...args) {
    const numericSpend = Number(doomSpend ?? 0) || 0;
    if (numericSpend <= 0) {
      return originalPayDoom.call(this, doomSpend, ...args);
    }

    const fused = consumeReactionRollUiFusionForUser(game.user?.id ?? null);
    if (!fused) {
      return originalPayDoom.call(this, doomSpend, ...args);
    }

    const tracker = globalThis.conan?.apps?.MomentumTrackerV2 ?? null;
    if (!tracker?.changeCounter) {
      return originalPayDoom.call(this, doomSpend, ...args);
    }

    await tracker.changeCounter(Number(`${numericSpend}`), "doom");
    return;
  };

  actorProto.spendDoom = async function patchedSpendDoom(doomSpend, ...args) {
    const numericSpend = Number(doomSpend ?? 0) || 0;
    if (numericSpend <= 0) {
      return originalSpendDoom.call(this, doomSpend, ...args);
    }

    const fused = consumeReactionRollUiFusionForUser(game.user?.id ?? null);
    if (!fused) {
      return originalSpendDoom.call(this, doomSpend, ...args);
    }

    const tracker = globalThis.conan?.apps?.MomentumTrackerV2 ?? null;
    if (!tracker?.changeCounter) {
      return originalSpendDoom.call(this, doomSpend, ...args);
    }

    const newValue = game.settings.get("conan2d20", "doom") - numericSpend;
    if (newValue < 0) {
      throw new Error("Doom spend would exceed available doom points.");
    }

    await tracker.changeCounter(-numericSpend, "doom");
    return;
  };

  Object.defineProperty(actorProto, "__c2mqReactionDoomChatFusionPatched", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  console.info(`[${MODULE_ID}] patched ConanActor Doom chat fusion for reaction rolls`);
  return true;
}

function exposePublicApi() {
  const api = buildPublicApi();

  const mod = game.modules?.get(MODULE_ID);
  if (mod) {
    try {
      mod.api = api;
    } catch (_e) {
      // Ignore package assignment failures and keep global aliases below.
    }
  }

  game.conan2d20MiniQol = api;
  globalThis.Conan2d20MiniQol = api;

  return api;
}

Hooks.once("init", async () => {
  registerSettings();
  registerSocket();

  if (typeof loadTemplates === "function") {
    await loadTemplates(TEMPLATE_PATHS);
  }

  registerCombatStateHooks();
  registerTargetTrackingHooks();
  registerSkillRollerBridge();
  registerChatHooks();
  registerReachHooks();
});

Hooks.once("setup", () => {
  exposePublicApi();
});

Hooks.once("ready", () => {
  exposePublicApi();
  patchConanMomentumTrackerZeroDiff();
  patchConanReactionDoomChatFusion();

  console.info(`[${MODULE_ID}] ready - chat hooks active`);

  setTimeout(() => {
    try {
      patchConanMomentumTrackerZeroDiff();
      patchConanReactionDoomChatFusion();
      ui.chat?.render?.(true);
    } catch (_e) {
      // Ignore chat re-render failures.
    }
  }, 0);

  Hooks.once("renderChatLog", () => {
    try {
      ui.chat?.render?.(true);
    } catch (_e) {
      // Ignore chat re-render failures.
    }
  });
});