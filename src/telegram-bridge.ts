import { randomUUID } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginContext } from "astra-plugin-sdk";
import { OggOpusDecoder } from "ogg-opus-decoder";
import { Api, TelegramClient } from "teleproto";
import { NewMessage } from "teleproto/events";
import { StringSession } from "teleproto/sessions";

import { telegramDeploymentConfig } from "./deployment-config";
import {
  applyTemplate,
  type ChatInfo,
  defaultState,
  extractReplyAfterCommandWord,
  extractSpeechText,
  isFinalSpeech,
  MAX_SELECTED_CHATS,
  MAX_VOICE_BYTES,
  type PersistedState,
  type Preferences,
  sanitizePreferences,
} from "./model";
import { createTelegramTransport } from "./telegram-transport";

type AuthStage =
  | "logged_out"
  | "restoring"
  | "sending_code"
  | "awaiting_code"
  | "verifying_code"
  | "awaiting_password"
  | "verifying_password"
  | "connected"
  | "error";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
  settled: boolean;
}

interface PendingReply {
  peer: any;
  sender: string;
  chat: string;
  expiresAt: number;
}

interface RecentSpeech {
  text: string;
  recognizedAt: number;
}

interface TelegramCredentials {
  apiId: number;
  apiHash: string;
  relayUrl: string;
  accessToken: string;
}

interface VoiceItem {
  id: string;
  data: Buffer;
  mime: string;
  createdAt: number;
  ready: boolean;
  claimedAt: number;
}

export interface PublicState {
  authStage: AuthStage;
  authError: string;
  passwordHint: string;
  phone: string;
  accountName: string;
  connected: boolean;
  monitoring: boolean;
  preferences: Preferences;
  maxSelectedChats: number;
  lastActivity: string;
  replyTarget: null | { sender: string; chat: string; secondsLeft: number };
}

export class TelegramBridge {
  private readonly statePath: string;
  private state: PersistedState = defaultState();
  private stateNeedsRewrite = false;
  private ctx?: PluginContext;
  private client?: TelegramClient;
  private telegramCredentials?: TelegramCredentials;
  private authTask?: Promise<void>;
  private codeInput?: Deferred<string>;
  private passwordInput?: Deferred<string>;
  private authStage: AuthStage = "logged_out";
  private authError = "";
  private passwordHint = "";
  private accountName = "";
  private lastActivity = "Плагин запущен";
  private pendingReply?: PendingReply;
  private awaitingReplyText = false;
  private recentSpeech?: RecentSpeech;
  private captureRequestedUntil = 0;
  private voiceItems = new Map<string, VoiceItem>();
  private cleanupTimer?: NodeJS.Timeout;
  private readonly detachedScope = new AsyncResource("astra-telegram-detached");
  private readonly messageHandler = async (event: any) => this.onTelegramMessage(event);
  private readonly messageBuilder = new NewMessage({ incoming: true });

  constructor(statePath: string) {
    this.statePath = statePath;
    this.loadState();
  }

  start(ctx: PluginContext): void {
    this.ctx = ctx;
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 30_000);
    this.cleanupTimer.unref();
    if (this.state.session) {
      this.authStage = "restoring";
    }
    void this.initializeStateAndSession();
  }

  async stop(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    this.codeInput?.reject(new Error("Plugin stopped"));
    this.passwordInput?.reject(new Error("Plugin stopped"));
    this.codeInput = undefined;
    this.passwordInput = undefined;
    this.telegramCredentials = undefined;
    await this.disconnectClient();
  }

  publicState(): PublicState {
    this.cleanupExpired();
    const now = Date.now();
    const replyTarget = this.pendingReply && this.pendingReply.expiresAt > now
      ? {
          sender: this.pendingReply.sender,
          chat: this.pendingReply.chat,
          secondsLeft: Math.max(0, Math.ceil((this.pendingReply.expiresAt - now) / 1000)),
        }
      : null;
    return {
      authStage: this.authStage,
      authError: this.authError,
      passwordHint: this.passwordHint,
      phone: this.state.phone,
      accountName: this.accountName,
      connected: this.authStage === "connected" && Boolean(this.client),
      monitoring:
        this.authStage === "connected" &&
        this.state.preferences.enabled &&
        this.state.preferences.selectedChatIds.length > 0,
      preferences: { ...this.state.preferences, selectedChatIds: [...this.state.preferences.selectedChatIds] },
      maxSelectedChats: MAX_SELECTED_CHATS,
      lastActivity: this.lastActivity,
      replyTarget,
    };
  }

  async beginLogin(phoneValue: unknown): Promise<PublicState> {
    const phone = String(phoneValue ?? "").trim().replace(/[\s()-]/g, "");
    if (!/^\+\d{7,15}$/.test(phone)) {
      throw new Error("Телефон укажите в международном формате, например +79991234567");
    }
    if (["sending_code", "awaiting_code", "verifying_code", "awaiting_password", "verifying_password"].includes(this.authStage)) {
      throw new Error("Вход в Telegram уже выполняется");
    }
    this.lastActivity = "Получаем параметры Telegram с сервера";
    const credentials = await this.fetchTelegramCredentials();

    this.state.phone = phone;
    this.state.session = "";
    this.authError = "";
    this.passwordHint = "";
    this.authStage = "sending_code";
    this.codeInput = undefined;
    this.passwordInput = undefined;
    this.lastActivity = "Подключаемся к Telegram";

    this.authTask = this.detachedScope.runInAsyncScope(() => this.performLogin(credentials, phone));
    void this.authTask.catch((error: unknown) => {
      if (this.authStage !== "error") this.failAuth(error);
    });
    return this.publicState();
  }

  private async performLogin(credentials: TelegramCredentials, phone: string): Promise<void> {
    await this.disconnectClient();
    await this.persistState();
    const client = this.createTelegramClient("", credentials);
    this.client = client;
    await client.connect();

    await client
      .signInUser(
        { apiId: credentials.apiId, apiHash: credentials.apiHash },
        {
          phoneNumber: phone,
          phoneCode: async () => {
            this.codeInput = deferred<string>();
            this.authStage = "awaiting_code";
            this.lastActivity = "Telegram отправил код подтверждения";
            return this.codeInput.promise;
          },
          password: async (hint?: string) => {
            this.passwordHint = hint ?? "";
            this.passwordInput = deferred<string>();
            this.authStage = "awaiting_password";
            this.lastActivity = "Telegram запросил пароль двухэтапной аутентификации";
            return this.passwordInput.promise;
          },
          firstAndLastNames: async () => {
            throw new Error("Новый Telegram-аккаунт нужно сначала создать в официальном приложении");
          },
          onError: async (error: Error) => {
            const raw = errorText(error).toUpperCase();
            const canRetry = raw.includes("PHONE_CODE_INVALID") || raw.includes("PASSWORD_HASH_INVALID");
            if (canRetry) {
              this.authError = friendlyTelegramError(error);
              this.lastActivity = `Ошибка входа: ${this.authError}`;
              return false;
            }
            this.failAuth(error);
            return true;
          },
        },
      )
      .then(async () => this.finishAuthorization(client))
      .catch((error: unknown) => {
        if (this.authStage !== "error") this.failAuth(error);
      });
  }

  submitCode(codeValue: unknown): PublicState {
    const code = String(codeValue ?? "").trim().replace(/\s/g, "");
    if (this.authStage !== "awaiting_code" || !this.codeInput || this.codeInput.settled) {
      throw new Error("Сейчас код подтверждения не ожидается");
    }
    if (!/^\d{3,8}$/.test(code)) throw new Error("Код Telegram должен состоять из цифр");
    this.authStage = "verifying_code";
    this.authError = "";
    this.codeInput.resolve(code);
    return this.publicState();
  }

  submitPassword(passwordValue: unknown): PublicState {
    const password = String(passwordValue ?? "");
    if (this.authStage !== "awaiting_password" || !this.passwordInput || this.passwordInput.settled) {
      throw new Error("Сейчас пароль Telegram не ожидается");
    }
    if (!password) throw new Error("Введите пароль двухэтапной аутентификации");
    this.authStage = "verifying_password";
    this.authError = "";
    this.passwordInput.resolve(password);
    return this.publicState();
  }

  async logout(): Promise<void> {
    const client = this.client;
    if (client) {
      try {
        await client.invoke(new Api.auth.LogOut());
      } catch (error) {
        await this.log("warn", `Telegram logout returned an error: ${errorText(error)}`);
      }
    }
    await this.disconnectClient();
    this.state.session = "";
    this.state.preferences.selectedChatIds = [];
    this.accountName = "";
    this.authStage = "logged_out";
    this.authError = "";
    this.pendingReply = undefined;
    this.awaitingReplyText = false;
    this.recentSpeech = undefined;
    this.captureRequestedUntil = 0;
    this.codeInput = undefined;
    this.passwordInput = undefined;
    this.lastActivity = "Вы вышли из Telegram";
    await this.persistState();
  }

  async listChats(): Promise<ChatInfo[]> {
    const client = this.requireConnected();
    const dialogs = await client.getDialogs({ limit: 200 });
    return dialogs
      .filter((dialog: any) => Boolean(dialog?.id))
      .map<ChatInfo>((dialog: any) => ({
        id: dialog.id.toString(),
        title: String(dialog.title || "Без названия"),
        kind: dialog.isUser ? "user" : dialog.isGroup ? "group" : "channel",
        unreadCount: Number(dialog.unreadCount || 0),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }

  async savePreferences(value: Partial<Preferences>): Promise<Preferences> {
    const requestedChatIds = Array.isArray(value.selectedChatIds)
      ? new Set(value.selectedChatIds.map(String).filter(Boolean)).size
      : 0;
    if (requestedChatIds > MAX_SELECTED_CHATS) {
      throw new Error(`Можно выбрать не больше ${MAX_SELECTED_CHATS} чатов`);
    }
    const preferences = sanitizePreferences(value);
    this.state.preferences = preferences;
    this.lastActivity = preferences.enabled ? "Настройки мониторинга сохранены" : "Мониторинг приостановлен";
    await this.persistState();
    return { ...preferences, selectedChatIds: [...preferences.selectedChatIds] };
  }

  async playVoice(voiceIdValue: unknown): Promise<string> {
    const voiceId = String(voiceIdValue ?? "").trim();
    let item = this.voiceItems.get(voiceId);
    if (!item) {
      // Astra currently leaves `{voice_id}` untouched in dynamic plugin action
      // parameters. Falling back to the oldest queued item also keeps commands
      // created with previous plugin versions working without manual edits.
      item = [...this.voiceItems.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
    }
    if (!item) return "";
    const itemId = item.id;

    if (voiceId !== itemId) {
      await this.log("info", "Astra did not resolve voice_id; playing the next queued Telegram voice message");
    }

    if (process.platform === "win32") {
      try {
        this.lastActivity = "Воспроизводим голосовое сообщение";
        await playVoiceOnWindows(item.data, item.mime);
        this.voiceItems.delete(itemId);
        this.lastActivity = "Голосовое сообщение воспроизведено";
        return "";
      } catch (error) {
        await this.log("warn", `Native voice playback failed, using UI fallback: ${errorText(error)}`);
      }
    }

    item.ready = true;
    item.claimedAt = 0;
    this.lastActivity = "Голосовое сообщение передано резервному проигрывателю";
    return "";
  }

  async nextVoice(waitMsValue: unknown = 0): Promise<null | { id: string; mime: string; size: number }> {
    const requestedWait = Number(waitMsValue);
    const waitMs = Number.isFinite(requestedWait) ? Math.min(25_000, Math.max(0, Math.round(requestedWait))) : 0;
    const deadline = Date.now() + waitMs;

    do {
      const now = Date.now();
      const item = [...this.voiceItems.values()].find(
        (candidate) => candidate.ready && (candidate.claimedAt === 0 || now - candidate.claimedAt > 30_000),
      );
      if (item) {
        item.claimedAt = now;
        return { id: item.id, mime: item.mime, size: item.data.length };
      }
      if (now >= deadline) return null;
      await delay(Math.min(250, deadline - now));
    } while (true);
  }

  voiceChunk(idValue: unknown, offsetValue: unknown): {
    id: string;
    mime: string;
    data: string;
    nextOffset: number;
    done: boolean;
  } {
    const id = String(idValue ?? "");
    const offset = Math.max(0, Math.floor(Number(offsetValue) || 0));
    const item = this.voiceItems.get(id);
    if (!item) throw new Error("Голосовое сообщение уже недоступно");
    const end = Math.min(item.data.length, offset + 128 * 1024);
    return {
      id,
      mime: item.mime,
      data: item.data.subarray(offset, end).toString("base64"),
      nextOffset: end,
      done: end >= item.data.length,
    };
  }

  voiceData(id: string): VoiceItem | undefined {
    return this.voiceItems.get(id);
  }

  acknowledgeVoice(id: string, played: boolean, playbackError = ""): void {
    const item = this.voiceItems.get(id);
    if (!item) return;
    if (played) {
      this.voiceItems.delete(id);
      this.lastActivity = "Голосовое сообщение воспроизведено";
    } else {
      item.claimedAt = 0;
      const detail = playbackError.trim().slice(0, 160);
      this.lastActivity = detail
        ? `Не удалось проиграть голосовое: ${detail}`
        : "Проигрыватель не смог запустить голосовое сообщение";
      void this.log("warn", this.lastActivity);
    }
  }

  async onSpeechRecognized(payload: Record<string, unknown>): Promise<void> {
    if (!isFinalSpeech(payload)) return;
    const spoken = extractSpeechText(payload);
    if (!spoken) return;
    this.cleanupExpired();
    const pending = this.pendingReply;
    if (!pending) return;

    if (this.awaitingReplyText) {
      await this.sendReply(spoken, pending);
      return;
    }

    this.recentSpeech = { text: spoken, recognizedAt: Date.now() };
    if (this.captureRequestedUntil >= Date.now()) {
      this.captureRequestedUntil = 0;
      this.recentSpeech = undefined;
      await this.processCapturedReply(spoken, pending);
    }
  }

  async captureReplyCommand(): Promise<string> {
    this.cleanupExpired();
    const pending = this.pendingReply;
    if (!pending) return "";

    const recent = this.recentSpeech;
    if (recent && Date.now() - recent.recognizedAt <= 5_000) {
      this.recentSpeech = undefined;
      this.captureRequestedUntil = 0;
      await this.processCapturedReply(recent.text, pending);
    } else {
      // Depending on scheduler order, the command action can arrive a moment
      // before the speech_recognized event for the same utterance.
      this.captureRequestedUntil = Date.now() + 5_000;
    }
    return "";
  }

  private async processCapturedReply(spoken: string, pending: PendingReply): Promise<void> {
    const reply = extractReplyAfterCommandWord(spoken);
    if (reply) {
      await this.sendReply(reply, pending);
      return;
    }
    this.awaitingReplyText = true;
    this.lastActivity = `Ожидаю текст ответа для ${pending.sender}`;
  }

  private async restoreSession(): Promise<void> {
    try {
      const credentials = await this.fetchTelegramCredentials();
      const client = this.createTelegramClient(this.state.session, credentials);
      this.client = client;
      await client.connect();
      if (!(await client.isUserAuthorized())) {
        await this.disconnectClient();
        this.state.session = "";
        this.authStage = "logged_out";
        this.lastActivity = "Сессия Telegram истекла — войдите снова";
        await this.persistState();
        return;
      }
      await this.finishAuthorization(client);
    } catch (error) {
      this.authStage = "error";
      this.authError = `Не удалось восстановить Telegram: ${friendlyTelegramError(error)}`;
      this.lastActivity = this.authError;
      await this.log("warn", this.authError);
    }
  }

  private async initializeStateAndSession(): Promise<void> {
    if (this.stateNeedsRewrite) {
      try {
        await this.persistState();
        this.stateNeedsRewrite = false;
      } catch (error) {
        await this.log("warn", `Не удалось очистить старый файл состояния: ${errorText(error)}`);
      }
    }
    if (this.state.session) await this.restoreSession();
  }

  private async finishAuthorization(client: TelegramClient): Promise<void> {
    if (this.client !== client) return;
    this.state.session = String(client.session.save());
    const me: any = await client.getMe();
    this.accountName = displayName(me, this.state.phone);
    this.authStage = "connected";
    this.authError = "";
    this.passwordHint = "";
    this.codeInput = undefined;
    this.passwordInput = undefined;
    this.lastActivity = `Telegram подключён: ${this.accountName}`;
    client.addEventHandler(this.messageHandler, this.messageBuilder);
    await this.persistState();
    await this.log("info", `Telegram account connected: ${this.accountName}`);
  }

  private async disconnectClient(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    try {
      client.removeEventHandler(this.messageHandler, this.messageBuilder);
      await client.disconnect();
    } catch {
      // The transport may already be gone. There is nothing left to release.
    }
  }

  private createTelegramClient(session: string, credentials: TelegramCredentials): TelegramClient {
    return new TelegramClient(
      new StringSession(session),
      credentials.apiId,
      credentials.apiHash,
      {
        connectionRetries: 5,
        networkSocket: createTelegramTransport({
          relayUrl: credentials.relayUrl,
          accessToken: credentials.accessToken,
          onMode: (mode) => {
            const label = mode === "server_relay"
              ? "защищённый WSS-релей"
              : "прямой защищённый WSS";
            void this.log("info", `Telegram transport connected through ${label}`);
          },
        }),
      },
    );
  }

  private async onTelegramMessage(event: any): Promise<void> {
    try {
      const message: any = event?.message;
      if (!message || message.out) return;
      const chatId = message.chatId?.toString();
      if (!chatId || !this.state.preferences.enabled) return;
      if (!this.state.preferences.selectedChatIds.includes(chatId)) return;

      const isVoice = Boolean(message.voice);
      const text = String(message.text || "").trim();
      if (!isVoice && !text) return;

      const chatEntity: any = (await message.getChat()) ?? message.chat;
      const senderEntity: any = (await message.getSender()) ?? message.sender;
      const peer = await message.getInputChat();
      if (!peer) throw new Error("Telegram не вернул адрес чата для ответа");
      const chat = displayName(chatEntity, "Telegram");
      const sender = displayName(senderEntity, chat);
      const values = { sender, chat, message: isVoice ? "голосовое сообщение" : text };

      let voiceId = "";
      if (isVoice) {
        const downloaded = await message.downloadMedia({});
        if (!Buffer.isBuffer(downloaded) || downloaded.length === 0) {
          throw new Error("Telegram вернул пустое голосовое сообщение");
        }
        if (downloaded.length > MAX_VOICE_BYTES) {
          throw new Error(`Голосовое больше ${Math.round(MAX_VOICE_BYTES / 1024 / 1024)} МБ`);
        }
        voiceId = randomUUID();
        this.voiceItems.set(voiceId, {
          id: voiceId,
          data: downloaded,
          mime: "audio/ogg",
          createdAt: Date.now(),
          ready: false,
          claimedAt: 0,
        });
      }

      this.pendingReply = {
        peer,
        sender,
        chat,
        expiresAt: Date.now() + this.state.preferences.replyWindowSeconds * 1000,
      };
      this.awaitingReplyText = false;
      this.recentSpeech = undefined;
      this.captureRequestedUntil = 0;
      const announcement = applyTemplate(
        isVoice ? this.state.preferences.voiceTemplate : this.state.preferences.textTemplate,
        values,
      );
      await this.fireRootTrigger({
        announcement,
        sender,
        chat,
        message: values.message,
        kind: isVoice ? "voice" : "text",
        voice_id: voiceId,
      });
      this.lastActivity = isVoice
        ? `Получено голосовое от ${sender}`
        : `Получено сообщение от ${sender}`;
    } catch (error) {
      const message = `Не удалось обработать Telegram-сообщение: ${errorText(error)}`;
      this.lastActivity = message;
      await this.log("error", message);
    }
  }

  private async sendReply(text: string, pending: PendingReply): Promise<void> {
    const client = this.requireConnected();
    await client.sendMessage(pending.peer, { message: text });
    this.pendingReply = undefined;
    this.awaitingReplyText = false;
    this.recentSpeech = undefined;
    this.captureRequestedUntil = 0;
    this.lastActivity = `Ответ отправлен в чат «${pending.chat}»`;
    await this.log("info", `Voice reply sent to Telegram chat ${pending.chat}`);

    const confirmation = applyTemplate(this.state.preferences.replyConfirmationTemplate, {
      sender: pending.sender,
      chat: pending.chat,
      message: text,
    });
    if (!confirmation) return;
    try {
      await this.fireRootTrigger({
        announcement: confirmation,
        sender: pending.sender,
        chat: pending.chat,
        message: text,
        kind: "reply_confirmation",
        voice_id: "",
      });
    } catch (error) {
      await this.log("warn", `Telegram reply was sent, but Astra confirmation failed: ${errorText(error)}`);
    }
  }

  private async fetchTelegramCredentials(): Promise<TelegramCredentials> {
    if (this.telegramCredentials) return this.telegramCredentials;

    const deployment = telegramDeploymentConfig();
    const rawUrl = deployment.credentialsUrl;
    const token = deployment.accessToken;
    if (!rawUrl || !token) {
      throw new Error(
        "Сервис Telegram для плагина не настроен в сборке",
      );
    }

    let endpoint: URL;
    try {
      endpoint = new URL(rawUrl);
    } catch {
      throw new Error("ASTRA_TELEGRAM_CREDENTIALS_URL содержит некорректный адрес");
    }
    const localDevelopment = endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost";
    if (endpoint.protocol !== "https:" && !(localDevelopment && endpoint.protocol === "http:")) {
      throw new Error("Сервер Telegram API должен использовать HTTPS");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      const detail = error instanceof Error && error.name === "AbortError"
        ? "сервер не ответил за 10 секунд"
        : errorText(error);
      throw new Error(`Не удалось получить параметры Telegram API: ${detail}`);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`Сервер Telegram API отклонил запрос: HTTP ${response.status}`);
    }

    const bodyText = await response.text();
    if (bodyText.length > 4096) throw new Error("Сервер Telegram API вернул слишком большой ответ");
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      throw new Error("Сервер Telegram API вернул некорректный JSON");
    }
    const apiId = Number(body.api_id ?? body.apiId);
    const apiHash = String(body.api_hash ?? body.apiHash ?? "").trim();
    const relayUrl = String(body.relay_url ?? body.relayUrl ?? "").trim();
    if (!Number.isSafeInteger(apiId) || apiId <= 0 || !/^[a-f\d]{32}$/i.test(apiHash)) {
      throw new Error("Сервер Telegram API вернул некорректные API ID или API Hash");
    }
    let relayEndpoint: URL;
    try {
      relayEndpoint = new URL(relayUrl);
    } catch {
      throw new Error("Сервер Telegram API вернул некорректный адрес WSS-релея");
    }
    const localRelay = relayEndpoint.hostname === "127.0.0.1" || relayEndpoint.hostname === "localhost";
    if (relayEndpoint.protocol !== "wss:" && !(localRelay && relayEndpoint.protocol === "ws:")) {
      throw new Error("WSS-релей Telegram должен использовать защищённое соединение");
    }

    this.telegramCredentials = { apiId, apiHash, relayUrl: relayEndpoint.toString(), accessToken: token };
    return this.telegramCredentials;
  }

  private requireConnected(): TelegramClient {
    if (!this.client || this.authStage !== "connected") throw new Error("Сначала войдите в Telegram");
    return this.client;
  }

  private failAuth(error: unknown): void {
    this.authStage = "error";
    this.authError = friendlyTelegramError(error);
    this.lastActivity = `Ошибка входа: ${this.authError}`;
    void this.log("warn", `Telegram authorization failed: ${errorText(error)}`);
  }

  private fireRootTrigger(payload: Record<string, unknown>): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return Promise.reject(new Error("Astra ещё не подключила контекст плагина"));
    // Calls coming from Astra's UI carry a short-lived invocation lease, and
    // Telegram callbacks can inherit the lease from the login request. An
    // incoming Telegram notification is an independent root event, so fire it
    // from the async scope created together with the plugin process.
    return this.detachedScope.runInAsyncScope(() => ctx.fireTrigger("telegram_message", payload));
  }

  private cleanupExpired(): void {
    const now = Date.now();
    if (this.pendingReply && this.pendingReply.expiresAt <= now) {
      this.pendingReply = undefined;
      this.awaitingReplyText = false;
      this.recentSpeech = undefined;
      this.captureRequestedUntil = 0;
    }
    for (const [id, item] of this.voiceItems) {
      if (now - item.createdAt > 10 * 60_000) this.voiceItems.delete(id);
    }
    while (this.voiceItems.size > 20) {
      const oldest = [...this.voiceItems.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!oldest) break;
      this.voiceItems.delete(oldest.id);
    }
  }

  private loadState(): void {
    try {
      const decoded = JSON.parse(readFileSync(this.statePath, "utf8")) as Record<string, unknown>;
      const raw = decoded as Partial<PersistedState>;
      this.stateNeedsRewrite =
        decoded.schemaVersion !== 2 ||
        Object.hasOwn(decoded, "apiId") ||
        Object.hasOwn(decoded, "apiHash");
      this.state = {
        schemaVersion: 2,
        phone: typeof raw.phone === "string" ? raw.phone : "",
        session: typeof raw.session === "string" ? raw.session : "",
        preferences: sanitizePreferences(raw.preferences),
      };
    } catch (error: any) {
      if (error?.code !== "ENOENT") this.lastActivity = "Файл состояния повреждён; использованы настройки по умолчанию";
      this.state = defaultState();
    }
  }

  private async persistState(): Promise<void> {
    const temporary = `${this.statePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.statePath);
    try {
      await chmod(this.statePath, 0o600);
    } catch {
      // Windows ACLs are inherited from the user's Astra directory.
    }
  }

  private async log(level: "debug" | "info" | "warn" | "error", message: string): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.log(level, message);
    } catch {
      // Logging must never break Telegram processing.
    }
  }
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const result: Deferred<T> = {
    promise: new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve(value: T) {
      if (result.settled) return;
      result.settled = true;
      resolvePromise(value);
    },
    reject(reason?: unknown) {
      if (result.settled) return;
      result.settled = true;
      rejectPromise(reason);
    },
    settled: false,
  };
  return result;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function playVoiceOnWindows(data: Buffer, mime: string): Promise<void> {
  const isOggOpus = mime.toLocaleLowerCase().includes("ogg") || data.subarray(0, 4).toString("ascii") === "OggS";
  const playableData = isOggOpus ? await decodeOggOpusToWav(data) : data;
  const extension = isOggOpus ? ".wav" : ".audio";
  const voicePath = join(tmpdir(), `astra-telegram-voice-${randomUUID()}${extension}`);
  await writeFile(voicePath, playableData, { mode: 0o600 });
  try {
    await runWindowsMediaPlayer(voicePath);
  } finally {
    try {
      await unlink(voicePath);
    } catch {
      // Windows Media Foundation may release the file a few milliseconds late.
      setTimeout(() => void unlink(voicePath).catch(() => undefined), 2_000).unref();
    }
  }
}

export async function decodeOggOpusToWav(data: Buffer): Promise<Buffer> {
  const decoder = new OggOpusDecoder();
  try {
    await decoder.ready;
    const decoded = await decoder.decodeFile(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
    if (!decoded.channelData.length || decoded.samplesDecoded <= 0) {
      throw new Error("Telegram voice decoded to an empty audio stream");
    }
    return pcmFloatToWav(decoded.channelData, decoded.samplesDecoded, decoded.sampleRate);
  } finally {
    decoder.free();
  }
}

export function pcmFloatToWav(
  channelData: Float32Array[],
  samplesDecoded: number,
  sampleRate: number,
): Buffer {
  const channelCount = channelData.length;
  if (channelCount < 1 || channelCount > 8) throw new Error("Unsupported Telegram voice channel count");
  const samples = Math.min(samplesDecoded, ...channelData.map((channel) => channel.length));
  const bytesPerSample = 2;
  const dataBytes = samples * channelCount * bytesPerSample;
  if (!Number.isSafeInteger(dataBytes) || dataBytes <= 0 || dataBytes > 256 * 1024 * 1024) {
    throw new Error("Decoded Telegram voice is too large to play safely");
  }

  const wav = Buffer.allocUnsafe(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channelCount, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
  wav.writeUInt16LE(channelCount * bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const floatSample = Math.max(-1, Math.min(1, channelData[channelIndex][sampleIndex] || 0));
      const integerSample = Math.round(floatSample < 0 ? floatSample * 0x8000 : floatSample * 0x7fff);
      wav.writeInt16LE(integerSample, offset);
      offset += bytesPerSample;
    }
  }
  return wav;
}

function runWindowsMediaPlayer(voicePath: string): Promise<void> {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const powershell = join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Windows.Media.Playback.MediaPlayer, Windows.Media.Playback, ContentType=WindowsRuntime] | Out-Null
[Windows.Media.Core.MediaSource, Windows.Media.Core, ContentType=WindowsRuntime] | Out-Null
$player = [Windows.Media.Playback.MediaPlayer]::new()
try {
  $player.Source = [Windows.Media.Core.MediaSource]::CreateFromUri([Uri]::new($env:ASTRA_TELEGRAM_VOICE_FILE))
  $player.Play()
  $started = $false
  $completed = $false
  $deadline = [DateTime]::UtcNow.AddHours(3)
  while ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 100
    $session = $player.PlaybackSession
    $state = $session.PlaybackState.ToString()
    $positionMs = $session.Position.TotalMilliseconds
    $durationMs = $session.NaturalDuration.TotalMilliseconds
    if ($state -eq 'Playing') { $started = $true }
    if ($started -and $durationMs -gt 0 -and $positionMs -ge ($durationMs - 150)) {
      $completed = $true
      break
    }
    if ($started -and $state -eq 'None') {
      $completed = $true
      break
    }
  }
  if (-not $started) { throw 'Windows MediaPlayer could not start this audio format' }
  if (-not $completed) { throw 'Voice playback timed out' }
} finally {
  $player.Dispose()
}
`;

  return new Promise((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const child = spawn(
      powershell,
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, ASTRA_TELEGRAM_VOICE_FILE: voicePath },
      },
    );
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Voice playback process timed out"));
    }, 3 * 60 * 60_000 + 30_000);
    timer.unref();
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 4_000) stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error(stderr.trim() || `Windows MediaPlayer exited with code ${code}`));
    });
  });
}

function displayName(entity: any, fallback: string): string {
  if (!entity) return fallback;
  const fullName = [entity.firstName, entity.lastName].filter(Boolean).join(" ").trim();
  return String(fullName || entity.title || entity.username || fallback);
}

function friendlyTelegramError(error: unknown): string {
  const raw = errorText(error);
  const upper = raw.toUpperCase();
  if (upper.includes("PHONE_CODE_INVALID")) return "Неверный код подтверждения";
  if (upper.includes("PHONE_CODE_EXPIRED")) return "Код подтверждения истёк — запросите новый";
  if (upper.includes("PASSWORD_HASH_INVALID")) return "Неверный пароль двухэтапной аутентификации";
  if (upper.includes("PHONE_NUMBER_INVALID")) return "Telegram не принял этот номер телефона";
  if (upper.includes("API_ID_INVALID")) return "Telegram не принял API ID или API Hash";
  if (upper.includes("FLOOD_WAIT")) return "Telegram временно ограничил частые попытки входа; попробуйте позже";
  if (upper.includes("AUTH_USER_CANCEL")) return "Вход отменён";
  return raw;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
