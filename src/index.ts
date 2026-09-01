/**
 * Telegram for Astra.
 *
 * Telegram is monitored by this process. Astra's own voice is reached through
 * a declared trigger and the built-in Speak action, so the user's active TTS
 * provider remains the single source of speech.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";

import { action, plugin, s, UiContrib } from "astra-plugin-sdk";

import { extractSpeechText, isFinalSpeech } from "./model";
import { TelegramBridge } from "./telegram-bridge";

const underNodeTest = Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.some((arg) => arg === "--test");
const pluginDirectory = process.env.ASTRA_PLUGIN_DIR || process.cwd();
const statePath = underNodeTest
  ? join(tmpdir(), `astra-telegram-test-${process.pid}.json`)
  : join(pluginDirectory, "telegram-state.json");

export const bridge = new TelegramBridge(statePath);

export const app = plugin({
  id: "dwertyfa-astra-tg",

  actions: {
    capture_reply_command: action({
      label: "Перехватить ответ Telegram",
      fields: [],
      params: s.object({}),
      // A separate Astra text-phrase command uses this action to consume
      // “ответь …” before the regular assistant starts an unrelated AI turn.
      // It pairs the action call with the speech_recognized event and sends the
      // words after the command word to Telegram.
      run: () => bridge.captureReplyCommand(),
    }),
    play_voice_message: action({
      label: "Проиграть голосовое Telegram",
      fields: [],
      // Keep voice_id optional for commands created by older plugin versions.
      // Current versions use the plugin's own FIFO queue and need no field.
      params: s.object({ voice_id: s.string().optional() }),
      run: ({ voice_id }) => bridge.playVoice(voice_id),
    }),
  },

  triggers: {
    telegram_message: {
      label: "Новое сообщение Telegram",
      fields: [],
    },
  },

  ui: {
    contributions: [
      {
        ...UiContrib.page("telegram-settings", "Telegram", "index.html", {
          iconSvg: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3.5 11.2 19.7 4.8c.8-.3 1.5.3 1.3 1.2l-2.8 13c-.2.9-.9 1.1-1.6.7l-4.2-3.1-2.1 2c-.2.3-.4.4-.8.4l.3-4.3 7.9-7.1c.3-.3-.1-.5-.6-.2l-9.7 6.1-4.2-1.3c-.9-.3-.9-.9.3-1.4Z"/></svg>',
        }),
        transparent: true,
      },
      UiContrib.effect("player.html", { id: "telegram-voice-player", audio: true }),
    ],
    onCall: {
      getState: () => bridge.publicState(),
      listChats: async () => ({ chats: await bridge.listChats() }),
      beginLogin: async (params) => {
        const value = asRecord(params);
        return { state: await bridge.beginLogin(value.phone) };
      },
      submitCode: async (params) => ({ state: await bridge.submitCode(asRecord(params).code) }),
      submitPassword: async (params) => ({ state: await bridge.submitPassword(asRecord(params).password) }),
      logout: async () => {
        await bridge.logout();
        return { ok: true };
      },
      savePreferences: async (params) => {
        await bridge.savePreferences(asRecord(params));
        return { state: bridge.publicState() };
      },
      nextVoice: async (params) => ({ item: await bridge.nextVoice(asRecord(params).waitMs) }),
      voiceChunk: (params) => {
        const value = asRecord(params);
        return bridge.voiceChunk(value.id, value.offset);
      },
      acknowledgeVoice: (params) => {
        const value = asRecord(params);
        bridge.acknowledgeVoice(
          String(value.id ?? ""),
          value.played !== false,
          String(value.error ?? ""),
        );
        return { ok: true };
      },
    },
  },

  events: {
    subscribe: ["speech_recognized"],
    on: async (eventType, payload) => {
      if (eventType !== "speech_recognized") return;
      // Keep these two cheap guards here as well as in TelegramBridge: the
      // permission exposes private transcripts, so irrelevant partials should
      // travel no farther through the plugin than necessary.
      if (!isFinalSpeech(payload) || !extractSpeechText(payload)) return;
      await bridge.onSpeechRecognized(payload);
    },
  },

  onStart: async (ctx) => {
    bridge.start(ctx);
    await ctx.log("info", "Telegram plugin is ready; Telegram restoration continues in background");
  },

  onShutdown: async () => {
    await bridge.stop();
  },

  healthCheck: () => {
    const state = bridge.publicState();
    return {
      healthy: true,
      status: state.connected
        ? `Telegram connected; ${state.preferences.selectedChatIds.length} selected chat(s)`
        : `Telegram ${state.authStage}`,
    };
  },
});

export {
  applyTemplate,
  extractReplyAfterCommandWord,
  matchReplyCommand,
  normalizeSpeech,
  sanitizePreferences,
} from "./model";
export { decodeOggOpusToWav, pcmFloatToWav } from "./telegram-bridge";

if (require.main === module) app.run();

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}
