import { join } from "node:path";
import { tmpdir } from "node:os";

import { action, plugin, s, tool, UiContrib } from "astra-plugin-sdk";

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

  tools: {
    prepare_telegram_message: tool({
      get description() {
        return `Молча подготовить сообщение в Telegram, только когда реплика пользователя после слова «Астра» начинается с фразы «${bridge.outgoingCommandPhrase()}»: не пиши ничего до вызова tool, а после вызова ответь ровно текстом результата без вступлений, пояснений и пересказа действий.`;
      },
      input: s.object({
        request_text: s.string({
          description: "Полная исходная реплика пользователя дословно, включая фразу вроде «напиши»; не пересказывай и не сокращай её",
          minLength: 1,
          maxLength: 6000,
        }),
        recipient: s.string({
          description: "Имя получателя, название Telegram-чата или @username без слов команды и без текста сообщения",
          minLength: 1,
          maxLength: 160,
        }),
        message: s.string({
          description: "Только текст, который пользователь просит отправить",
          minLength: 1,
          maxLength: 4096,
        }),
      }),
      run: ({ request_text, recipient, message }) =>
        bridge.prepareOutgoingMessage(request_text, recipient, message),
    }),
    confirm_telegram_message: tool({
      description: "Молча подтвердить или отменить последний Telegram-черновик только отдельным следующим ходом после явного ответа пользователя «да» или «нет»; не пиши ничего до вызова tool, никогда не подтверждай в ходе создания черновика, а после вызова ответь ровно текстом результата без дополнений.",
      input: s.object({
        confirmed: s.boolean({
          description: "true только при явном согласии пользователя отправить показанный черновик; false при отказе",
        }),
      }),
      run: ({ confirmed }) => bridge.confirmOutgoingMessage(confirmed),
    }),
  },

  actions: {
    capture_reply_command: action({
      label: "Перехватить ответ Telegram",
      fields: [],
      params: s.object({}),
      run: () => bridge.captureReplyCommand(),
    }),
    play_voice_message: action({
      label: "Проиграть голосовое Telegram",
      fields: [],
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
      monitorAllChats: async () => {
        const result = await bridge.monitorAllChats();
        return { chats: result.chats, state: bridge.publicState() };
      },
      setHideIdentity: async (params) => ({
        state: await bridge.setHideIdentity(asRecord(params).hidden),
      }),
      exportCommandsFile: async () => bridge.exportCommandsFile(),
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
