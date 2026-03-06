import { TEMPLATE_PATHS, MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { registerSocket } from "./socket.js";
import { registerChatHooks } from "./hooks/chat.js";
import { registerReachHooks } from "./hooks/reach.js";

function registerStatusEffects() {
  // Minimal Guard tracking: a single "No Guard" toggle.
  // When active on a target, Reach difficulty penalties are skipped.
  const id = "c2mq-no-guard";
  const existing = new Set((CONFIG.statusEffects ?? []).map(e => e.id));
  if (existing.has(id)) return;

  const label = game.i18n.localize("C2MQ.Status.NoGuard");
  CONFIG.statusEffects = (CONFIG.statusEffects ?? []).concat([
    {
      id,
      name: label,
      label,
      img: "icons/svg/shield.svg",
      hud: true
    }
  ]);
}

Hooks.once("init", async () => {
  registerSettings();
  registerSocket();

  // Preload templates
  if (typeof loadTemplates === "function") {
    await loadTemplates(TEMPLATE_PATHS);
  }

  registerStatusEffects();

  // Register chat hooks as early as possible so we don't miss the initial ChatLog render.
  registerChatHooks();

  // Reach rules (difficulty adjustment) hook.
  registerReachHooks();
});

Hooks.once("ready", () => {
  console.info(`[${MODULE_ID}] ready - chat hooks active`);

  // Force a chat re-render on next tick. On some setups ChatLog renders before modules register hooks.
  setTimeout(() => {
    try { ui.chat?.render?.(true); } catch (_e) {}
  }, 0);

  // Also re-render once the ChatLog renders (covers cases where the sidebar renders after ready).
  Hooks.once("renderChatLog", () => {
    try { ui.chat?.render?.(true); } catch (_e) {}
  });
});