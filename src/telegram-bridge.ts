import { randomUUID } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, rename, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginContext } from "astra-plugin-sdk";
import { OggOpusDecoder } from "ogg-opus-decoder";
import { Api, TelegramClient } from "teleproto";
import { NewMessage } from "teleproto/events";
import { Logger, LogLevel } from "teleproto/extensions/Logger";
import { StringSession } from "teleproto/sessions";

import { parseCommandsBundle } from "./commands-bundle";
import { telegramDeploymentConfig } from "./deployment-config";
import {
  applyTemplate,
  type ChatInfo,
  defaultState,
  extractReplyAfterCommandWord,
  extractSpeechText,
  isFinalSpeech,
  matchReplyCommand,
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

interface PendingOutgoingMessage {
  peer: any;
  recipient: string;
  text: string;
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
  /** Where Telegram said it put the login code, once it has said so. */
  codeDelivery: "" | "app" | "sms" | "call";
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
  private codeDelivery: "" | "app" | "sms" | "call" = "";
  private loginAttempt = 0;
  private codeWatchdog?: NodeJS.Timeout;
  private lastActivity = "Плагин запущен";
  private pendingReply?: PendingReply;
  private pendingOutgoingMessage?: PendingOutgoingMessage;
  private outgoingSendInProgress = false;
  private awaitingReplyText = false;
  private recentSpeech?: RecentSpeech;
  private captureRequestedUntil = 0;
  private voiceItems = new Map<string, VoiceItem>();
  private cleanupTimer?: NodeJS.Timeout;
  private sessionInvalidated = false;
  private readonly telegramLogSeen = new Map<string, number>();
  private readonly detachedScope = new AsyncResource("astra-telegram-detached");
  private messageQueue: Promise<void> = Promise.resolve();
  private triggerQueue: Promise<void> = Promise.resolve();
  private readonly messageHandler = (event: any): Promise<void> => {
    const task = this.messageQueue.then(() => this.onTelegramMessage(event));
    this.messageQueue = task.catch(() => undefined);
    return task;
  };
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
      preferences: {
        ...this.state.preferences,
        selectedChatIds: [...this.state.preferences.selectedChatIds],
        selectedChatNames: { ...this.state.preferences.selectedChatNames },
      },
      maxSelectedChats: MAX_SELECTED_CHATS,
      lastActivity: this.lastActivity,
      codeDelivery: this.codeDelivery,
      replyTarget,
    };
  }

  outgoingCommandPhrase(): string {
    return this.state.preferences.sendCommandPhrase;
  }

  async monitorAllChats(): Promise<{ chats: ChatInfo[]; preferences: Preferences }> {
    const chats = await this.listChats();
    if (!chats.length) throw new Error("Telegram не вернул ни одного чата");
    const selected = chats.slice(0, MAX_SELECTED_CHATS);
    const preferences = await this.savePreferences({
      ...this.state.preferences,
      enabled: true,
      selectedChatIds: selected.map((chat) => chat.id),
      selectedChatNames: Object.fromEntries(selected.map((chat) => [chat.id, chat.title])),
    });
    this.lastActivity = chats.length > selected.length
      ? `Мониторим ${selected.length} чатов из ${chats.length} — достигнут лимит`
      : `Мониторим все чаты: ${selected.length}`;
    return { chats, preferences };
  }

  /**
   * Persist just the privacy toggle.
   *
   * The UI iframe has an opaque origin, so `localStorage` throws there and the
   * flag cannot live in the page. It is a preference like any other, but it gets
   * its own call rather than riding on `savePreferences`: the toggle is pressed
   * while the template fields may hold unsaved edits, and a full save would
   * write those too.
   */
  async setHideIdentity(value: unknown): Promise<PublicState> {
    this.state.preferences.hideIdentity = value === true;
    await this.persistState();
    return this.publicState();
  }

  /**
   * Write the ready-made Astra commands out as an importable file.
   *
   * A plugin cannot create a command itself. `CommandService.Create` exists, but
   * it is on the daemon's client-facing surface, reachable only through the SDK's
   * `DaemonClient` — which the SDK builds only for a plugin declaring the
   * `client` capability, and that permission is refused outright to any plugin
   * not installed from the catalogue. Declaring it to write two commands would
   * also ask the user to consent to this plugin acting as their chat front-end.
   * So the button prepares the file and Astra's own import does the writing.
   */
  async exportCommandsFile(): Promise<{ path: string; names: string[] }> {
    const bundle = parseCommandsBundle();
    const target = join(this.commandsDirectory(), "tg-astra-commands.astra");
    await writeFile(target, bundle.text, { encoding: "utf8", mode: 0o600 });
    this.lastActivity = `Файл команд готов: ${target}`;
    await this.log("info", `Prepared Astra command bundle at ${target}`);
    return { path: target, names: bundle.names };
  }

  private commandsDirectory(): string {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const candidates = [
      home ? join(home, "Downloads") : "",
      home ? join(home, "Desktop") : "",
      home,
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return tmpdir();
  }

  async beginLogin(phoneValue: unknown): Promise<PublicState> {
    const phone = String(phoneValue ?? "").trim().replace(/[\s()-]/g, "");
    if (!/^\+\d{7,15}$/.test(phone)) {
      throw new Error("Телефон укажите в международном формате, например +79991234567");
    }

    // Pressing the button again restarts the login rather than being refused.
    // A first attempt that produced no code leaves this plugin sitting in
    // `sending_code` or `awaiting_code` with nothing the user can do about it,
    // and "вход уже выполняется" is not an answer when no code ever arrived.
    const attempt = ++this.loginAttempt;
    this.cancelLoginAttempt("Вход начат заново");

    this.lastActivity = "Получаем параметры Telegram с сервера";
    const credentials = await this.fetchTelegramCredentials();
    if (attempt !== this.loginAttempt) return this.publicState();

    this.state.phone = phone;
    this.state.session = "";
    this.authError = "";
    this.passwordHint = "";
    this.codeDelivery = "";
    this.authStage = "sending_code";
    this.sessionInvalidated = false;
    this.codeInput = undefined;
    this.passwordInput = undefined;
    this.lastActivity = "Запрашиваем у Telegram код подтверждения";
    this.armCodeWatchdog(attempt);

    this.authTask = this.detachedScope.runInAsyncScope(() => this.performLogin(credentials, phone, attempt));
    void this.authTask.catch((error: unknown) => {
      if (attempt === this.loginAttempt && this.authStage !== "error") this.failAuth(error, attempt);
    });
    return this.publicState();
  }

  /**
   * Abandon whatever the previous attempt was waiting for.
   *
   * The deferreds are rejected rather than left hanging, so teleproto's own
   * `signInUser` loop unwinds instead of holding a socket open behind the new
   * attempt — two live logins on one account is how a session gets invalidated.
   */
  private cancelLoginAttempt(reason: string): void {
    this.clearCodeWatchdog();
    this.codeInput?.reject(new Error(reason));
    this.passwordInput?.reject(new Error(reason));
    this.codeInput = undefined;
    this.passwordInput = undefined;
    void this.disconnectClient();
  }

  /**
   * Say something when Telegram never answers the code request.
   *
   * Without this the panel reads "Запрашиваем код" for as long as the user is
   * willing to wait, which is indistinguishable from a code that was sent and
   * lost.
   */
  private armCodeWatchdog(attempt: number): void {
    this.clearCodeWatchdog();
    this.codeWatchdog = setTimeout(() => {
      this.codeWatchdog = undefined;
      if (attempt !== this.loginAttempt || this.authStage !== "sending_code") return;
      this.authStage = "error";
      this.authError = "Telegram не ответил на запрос кода за 60 секунд. Проверьте соединение и попробуйте снова.";
      this.lastActivity = this.authError;
      void this.log("warn", "Telegram did not answer auth.sendCode within 60s");
    }, 60_000);
    this.codeWatchdog.unref();
  }

  private clearCodeWatchdog(): void {
    if (this.codeWatchdog) clearTimeout(this.codeWatchdog);
    this.codeWatchdog = undefined;
  }

  private async performLogin(
    credentials: TelegramCredentials,
    phone: string,
    attempt: number,
  ): Promise<void> {
    await this.disconnectClient();
    await this.persistState();
    if (attempt !== this.loginAttempt) return;
    const client = this.createTelegramClient("", credentials);
    this.client = client;
    await client.connect();
    if (attempt !== this.loginAttempt) {
      await this.disconnectClient();
      return;
    }

    await client
      .signInUser(
        { apiId: credentials.apiId, apiHash: credentials.apiHash },
        {
          phoneNumber: phone,
          phoneCode: async (isCodeViaApp?: boolean) => {
            if (attempt !== this.loginAttempt) throw new Error("Вход отменён");
            this.clearCodeWatchdog();
            this.codeDelivery = isCodeViaApp ? "app" : "sms";
            this.codeInput = deferred<string>();
            this.authStage = "awaiting_code";
            this.lastActivity = isCodeViaApp
              ? "Telegram отправил код в приложение Telegram на другом устройстве"
              : `Telegram отправил код по SMS на ${phone}`;
            await this.log("info", `Telegram sent the login code via ${isCodeViaApp ? "the Telegram app" : "SMS"}`);
            return this.codeInput.promise;
          },
          password: async (hint?: string) => {
            if (attempt !== this.loginAttempt) throw new Error("Вход отменён");
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
            if (attempt !== this.loginAttempt) return true;
            const raw = errorText(error).toUpperCase();
            const canRetry = raw.includes("PHONE_CODE_INVALID") || raw.includes("PASSWORD_HASH_INVALID");
            if (canRetry) {
              this.authError = friendlyTelegramError(error);
              this.lastActivity = `Ошибка входа: ${this.authError}`;
              return false;
            }
            this.failAuth(error, attempt);
            return true;
          },
        },
      )
      .then(async () => this.finishAuthorization(client))
      .catch((error: unknown) => {
        if (attempt === this.loginAttempt && this.authStage !== "error") this.failAuth(error, attempt);
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
    this.state.preferences.selectedChatNames = {};
    this.accountName = "";
    this.authStage = "logged_out";
    this.authError = "";
    this.sessionInvalidated = false;
    this.pendingReply = undefined;
    this.pendingOutgoingMessage = undefined;
    this.outgoingSendInProgress = false;
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
    const dialogs = await this.guardSession(() => client.getDialogs({ limit: MAX_SELECTED_CHATS }));
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
    return {
      ...preferences,
      selectedChatIds: [...preferences.selectedChatIds],
      selectedChatNames: { ...preferences.selectedChatNames },
    };
  }

  /**
   * Resolve an explicitly requested Telegram recipient and create a short-lived
   * draft. This method never sends: the second tool must receive a separate,
   * explicit confirmation from the user before `confirmOutgoingMessage` can do
   * any Telegram write.
   */
  async prepareOutgoingMessage(
    requestValue: unknown,
    recipientValue: unknown,
    messageValue: unknown,
  ): Promise<string> {
    const request = String(requestValue ?? "").trim();
    const recipientQuery = String(recipientValue ?? "").trim();
    const text = String(messageValue ?? "").trim();
    const commandPhrase = this.state.preferences.sendCommandPhrase;

    if (matchReplyCommand(request, commandPhrase).kind === "none") {
      this.pendingOutgoingMessage = undefined;
      return `Используйте фразу «${commandPhrase}».`;
    }
    if (!recipientQuery) return "Кому отправить сообщение?";
    if (!text) return "Что отправить?";
    if (text.length > 4096) return "Сообщение длиннее 4096 символов.";

    const client = this.requireConnected();
    const dialogs = await this.guardSession(() => client.getDialogs({ limit: MAX_SELECTED_CHATS }));
    const matches = dialogs
      .filter((dialog: any) => Boolean(dialog?.inputEntity))
      .map((dialog: any) => ({
        dialog,
        title: dialogTitle(dialog),
        score: scoreTelegramRecipient(recipientQuery, dialog),
      }))
      .filter((candidate) => candidate.score >= 70)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "ru"));

    const best = matches[0];
    if (!best) {
      this.pendingOutgoingMessage = undefined;
      return `Не найден чат «${recipientQuery}». Уточните имя или @username.`;
    }

    const ambiguous = matches.filter(
      (candidate) => candidate !== best && (
        candidate.score === best.score || (best.score < 100 && best.score - candidate.score <= 2)
      ),
    );
    if (ambiguous.length) {
      this.pendingOutgoingMessage = undefined;
      const options = [best, ...ambiguous]
        .slice(0, 5)
        .map((candidate) => `«${candidate.title}»`)
        .join(", ");
      return `Найдено несколько чатов: ${options}. Кому отправить?`;
    }

    this.pendingOutgoingMessage = {
      peer: best.dialog.inputEntity,
      recipient: best.title,
      text,
      expiresAt: Date.now() + 2 * 60_000,
    };
    this.lastActivity = `Подготовлен черновик для «${best.title}»`;
    const preview = speechPreview(text, 240);
    return `Отправить в чат «${best.title}»: «${preview}»?`;
  }

  async confirmOutgoingMessage(confirmedValue: unknown): Promise<string> {
    this.cleanupExpired();
    const pending = this.pendingOutgoingMessage;
    if (!pending) return "Нет сообщения для подтверждения.";

    if (confirmedValue !== true) {
      this.pendingOutgoingMessage = undefined;
      this.lastActivity = `Отправка сообщения для «${pending.recipient}» отменена`;
      return "Отправка отменена.";
    }
    if (this.outgoingSendInProgress) return "Сообщение уже отправляется.";

    this.outgoingSendInProgress = true;
    try {
      const client = this.requireConnected();
      await this.guardSession(() => client.sendMessage(pending.peer, { message: pending.text }));
      if (this.pendingOutgoingMessage === pending) this.pendingOutgoingMessage = undefined;
      this.lastActivity = `Сообщение отправлено в чат «${pending.recipient}»`;
      await this.log("info", `Confirmed AI-tool message sent to Telegram chat ${pending.recipient}`);
      return `Отправлено в чат «${pending.recipient}».`;
    } finally {
      this.outgoingSendInProgress = false;
    }
  }

  async playVoice(voiceIdValue: unknown): Promise<string> {
    const voiceId = String(voiceIdValue ?? "").trim();
    let item = this.voiceItems.get(voiceId);
    if (!item) {
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
      const code = sessionInvalidationCode(errorText(error));
      if (code) {
        await this.handleInvalidatedSession(code);
        return;
      }
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
    this.clearCodeWatchdog();
    this.state.session = String(client.session.save());
    const me: any = await client.getMe();
    this.accountName = displayName(me, this.state.phone);
    this.authStage = "connected";
    this.authError = "";
    this.passwordHint = "";
    this.sessionInvalidated = false;
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
    }
  }

  private createTelegramClient(session: string, credentials: TelegramCredentials): TelegramClient {
    return new TelegramClient(
      new StringSession(session),
      credentials.apiId,
      credentials.apiHash,
      {
        connectionRetries: 5,
        // Without this, teleproto writes its own colour-coded lines straight to
        // stdout, which the daemon captures verbatim as this plugin's log. It is
        // also the only place some failures surface at all: the update loop
        // catches its own errors and retries forever, so a session Telegram has
        // already invalidated is visible here and nowhere else.
        baseLogger: this.createTelegramLogger(),
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

  private createTelegramLogger(): Logger {
    const logger = new Logger(LogLevel.WARN);
    logger.handler = (record) => {
      const message = String(record.message ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      if (!message) return;

      const invalidation = sessionInvalidationCode(message);
      if (invalidation) {
        void this.handleInvalidatedSession(invalidation);
        return;
      }

      // The update loop repeats one warning on every retry, so an unhandled
      // failure would otherwise fill the log with the same line for hours.
      const now = Date.now();
      const lastSeen = this.telegramLogSeen.get(message);
      if (lastSeen !== undefined && now - lastSeen < 5 * 60_000) return;
      this.telegramLogSeen.set(message, now);
      if (this.telegramLogSeen.size > 50) {
        for (const [key, seenAt] of this.telegramLogSeen) {
          if (now - seenAt > 5 * 60_000) this.telegramLogSeen.delete(key);
        }
      }
      void this.log(record.level === LogLevel.ERROR ? "error" : "warn", `Telegram: ${message}`);
    };
    return logger;
  }

  /**
   * Telegram has thrown the session away; stop pretending otherwise.
   *
   * `updates.getDifference` is retried by teleproto's own update manager, which
   * swallows the error and re-arms a timer, so an invalidated session produces
   * one warning a minute forever while `publicState()` still reports a healthy
   * connection. The auth key cannot be revived, so the only honest answer is to
   * drop it and ask for a new login.
   */
  private async handleInvalidatedSession(code: string): Promise<void> {
    if (this.sessionInvalidated) return;
    this.sessionInvalidated = true;

    await this.disconnectClient();
    this.state.session = "";
    this.accountName = "";
    this.authStage = "error";
    this.authError = invalidatedSessionMessage(code);
    this.lastActivity = this.authError;
    this.pendingReply = undefined;
    this.pendingOutgoingMessage = undefined;
    this.outgoingSendInProgress = false;
    this.awaitingReplyText = false;
    this.recentSpeech = undefined;
    this.captureRequestedUntil = 0;
    this.voiceItems.clear();
    await this.log("warn", `Telegram invalidated the session (${code}); stored session cleared, re-login required`);
    try {
      await this.persistState();
    } catch (error) {
      await this.log("warn", `Could not clear the invalidated Telegram session on disk: ${errorText(error)}`);
    }
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
      await this.queueRootTrigger({
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
      const code = sessionInvalidationCode(errorText(error));
      if (code) {
        await this.handleInvalidatedSession(code);
        return;
      }
      const message = `Не удалось обработать Telegram-сообщение: ${errorText(error)}`;
      this.lastActivity = message;
      await this.log("error", message);
    }
  }

  private async sendReply(text: string, pending: PendingReply): Promise<void> {
    const client = this.requireConnected();
    await this.guardSession(() => client.sendMessage(pending.peer, { message: text }));
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
    void this.queueRootTrigger({
      announcement: confirmation,
      sender: pending.sender,
      chat: pending.chat,
      message: text,
      kind: "reply_confirmation",
      voice_id: "",
    }).catch((error) => {
      void this.log("warn", `Telegram reply was sent, but Astra confirmation failed: ${errorText(error)}`);
    });
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

  /**
   * Run one Telegram call and notice a session Telegram has thrown away.
   *
   * The error still propagates — the caller has its own reporting — but the
   * plugin stops claiming to be connected instead of failing every later call
   * with the same opaque message.
   */
  private async guardSession<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const code = sessionInvalidationCode(errorText(error));
      if (code) await this.handleInvalidatedSession(code);
      throw error;
    }
  }

  private failAuth(error: unknown, attempt?: number): void {
    if (attempt !== undefined && attempt !== this.loginAttempt) return;
    this.clearCodeWatchdog();
    this.authStage = "error";
    this.authError = friendlyTelegramError(error);
    this.lastActivity = `Ошибка входа: ${this.authError}`;
    void this.log("warn", `Telegram authorization failed: ${errorText(error)}`);
  }

  private queueRootTrigger(payload: Record<string, unknown>): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return Promise.reject(new Error("Astra ещё не подключила контекст плагина"));
    const task = this.detachedScope.runInAsyncScope(() =>
      this.triggerQueue.then(async () => {
        // Fire on the next event-loop turn. In particular, a confirmation queued
        // by speech_recognized must not call back into Astra before that inbound
        // event RPC has returned.
        await new Promise<void>((resolve) => setImmediate(resolve));
        try {
          await ctx.fireTrigger("telegram_message", payload);
        } catch (error) {
          // Astra may cancel a trigger after accepting it when the user interrupts
          // speech or a newer command supersedes the current one. Telegram work is
          // already complete at this point, so this is not a message-processing
          // failure and must not poison the queue or produce repeated error logs.
          if (!isGrpcCancelled(error)) throw error;
        }
      }),
    );
    this.triggerQueue = task.catch(() => undefined);
    return task;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    if (this.pendingReply && this.pendingReply.expiresAt <= now) {
      this.pendingReply = undefined;
      this.awaitingReplyText = false;
      this.recentSpeech = undefined;
      this.captureRequestedUntil = 0;
    }
    if (this.pendingOutgoingMessage && this.pendingOutgoingMessage.expiresAt <= now) {
      this.pendingOutgoingMessage = undefined;
      this.outgoingSendInProgress = false;
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
    }
  }

  private async log(level: "debug" | "info" | "warn" | "error", message: string): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.log(level, message);
    } catch {
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

function dialogTitle(dialog: any): string {
  return String(
    dialog?.title ||
    dialog?.name ||
    displayName(dialog?.entity, "Без названия"),
  ).trim() || "Без названия";
}

function scoreTelegramRecipient(queryValue: string, dialog: any): number {
  const query = normalizeRecipient(queryValue);
  if (!query) return 0;

  const entity = dialog?.entity;
  const fullName = [entity?.firstName, entity?.lastName].filter(Boolean).join(" ").trim();
  const username = String(entity?.username || "").trim();
  const aliases = [dialogTitle(dialog), dialog?.name, fullName, entity?.firstName, entity?.lastName, username]
    .map((value) => normalizeRecipient(String(value || "")))
    .filter(Boolean);

  let best = 0;
  for (const alias of new Set(aliases)) {
    if (alias === query) {
      best = Math.max(best, normalizeRecipient(username) === query ? 110 : 100);
      continue;
    }
    if (alias.startsWith(query) || query.startsWith(alias)) best = Math.max(best, 88);
    if (alias.includes(query) || query.includes(alias)) best = Math.max(best, 80);

    const longest = Math.max(alias.length, query.length);
    if (longest > 0) {
      const similarity = 1 - levenshteinDistance(alias, query) / longest;
      if (similarity >= 0.72) best = Math.max(best, Math.round(60 + similarity * 25));
    }
  }
  return best;
}

function normalizeRecipient(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/^@/u, "")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function speechPreview(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

function friendlyTelegramError(error: unknown): string {
  const raw = errorText(error);
  const upper = raw.toUpperCase();
  if (upper.includes("PHONE_CODE_INVALID")) return "Неверный код подтверждения";
  if (upper.includes("PHONE_CODE_EXPIRED")) return "Код подтверждения истёк — запросите новый";
  if (upper.includes("PASSWORD_HASH_INVALID")) return "Неверный пароль двухэтапной аутентификации";
  if (upper.includes("PHONE_NUMBER_INVALID")) return "Telegram не принял этот номер телефона";
  if (upper.includes("API_ID_INVALID")) return "Telegram не принял API ID или API Hash";
  const flood = /FLOOD_WAIT_(\d+)/.exec(upper);
  if (flood) return `Telegram ограничил частые входы: следующая попытка через ${formatWait(Number(flood[1]))}`;
  if (upper.includes("FLOOD_WAIT")) return "Telegram временно ограничил частые попытки входа; попробуйте позже";
  if (upper.includes("PHONE_NUMBER_BANNED")) return "Telegram заблокировал этот номер";
  if (upper.includes("SEND_CODE_UNAVAILABLE")) {
    return "Telegram отказался присылать код на этот номер сейчас — попробуйте позже или войдите в официальном приложении";
  }
  if (upper.includes("PHONE_PASSWORD_FLOOD")) return "Слишком много попыток входа; Telegram просит подождать";
  if (upper.includes("AUTH_RESTART")) return "Telegram просит начать вход заново — нажмите «Продолжить» ещё раз";
  if (upper.includes("AUTH_USER_CANCEL")) return "Вход отменён";
  const invalidation = sessionInvalidationCode(raw);
  if (invalidation) return invalidatedSessionMessage(invalidation);
  return raw;
}

function formatWait(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "несколько секунд";
  if (seconds < 60) return `${Math.ceil(seconds)} сек.`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} мин.`;
  return `${Math.ceil(minutes / 60)} ч.`;
}

/**
 * Name the error that means "this session is gone", or return `""`.
 *
 * Matched on text rather than on an error class because the loudest source is
 * teleproto's own log line — the update manager catches the error, formats it
 * into a string and retries, so the object never reaches this plugin.
 */
function sessionInvalidationCode(text: string): string {
  const upper = text.toUpperCase();
  for (const code of [
    "AUTH_KEY_DUPLICATED",
    "AUTH_KEY_UNREGISTERED",
    "AUTH_KEY_INVALID",
    "SESSION_REVOKED",
    "SESSION_EXPIRED",
    "USER_DEACTIVATED_BAN",
    "USER_DEACTIVATED",
  ]) {
    if (upper.includes(code)) return code;
  }
  // The duplicate-session error is also recognisable by its own sentence, which
  // is what teleproto prints when it formats the error rather than the code.
  if (upper.includes("CONCURRENT USAGE OF THE CURRENT SESSION")) return "AUTH_KEY_DUPLICATED";
  return "";
}

function invalidatedSessionMessage(code: string): string {
  if (code === "AUTH_KEY_DUPLICATED") {
    return "Telegram закрыл сессию: она использовалась из двух подключений одновременно. Войдите в Telegram заново.";
  }
  if (code === "SESSION_REVOKED") {
    return "Сессия отключена в настройках Telegram. Войдите заново.";
  }
  if (code === "USER_DEACTIVATED" || code === "USER_DEACTIVATED_BAN") {
    return "Telegram заблокировал этот аккаунт — плагин не может к нему подключиться.";
  }
  return "Сессия Telegram больше не действительна. Войдите заново.";
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isGrpcCancelled(error: unknown): boolean {
  if (error && typeof error === "object" && Number((error as { code?: unknown }).code) === 1) {
    return true;
  }
  return /(?:^|\s)(?:1\s+)?CANCELLED(?::|\s)|Call cancelled/i.test(errorText(error));
}
