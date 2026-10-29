import {
  type AutoReplyCampaign,
  type AutoReplyRule,
  normalizeAutoReplyRules,
} from "./auto-responder";

export const MAX_SELECTED_CHATS = 1000;
export const MAX_VOICE_BYTES = 20 * 1024 * 1024;

export function telegramReplyIntent(value: unknown, phrase: string, message: string): "latest" | "context" | undefined {
  const tokens = (text: string) => text.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\p{N}]+/gu) ?? [];
  const request = tokens(String(value ?? ""));
  const prefix = tokens(phrase);
  if (request[0] === "астра" || request[0] === "astra") request.shift();
  if (prefix[0] === "астра" || prefix[0] === "astra") prefix.shift();
  if (!prefix.length || request.length <= prefix.length || !prefix.every((word, index) => request[index] === word)) return undefined;
  return request.slice(prefix.length).join(" ") === tokens(message).join(" ") ? "latest" : "context";
}

export function normalizeTelegramPhone(value: unknown): string {
  let phone = String(value ?? "").trim().replace(/[\s().-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  else if (/^8\d{10}$/.test(phone)) phone = `+7${phone.slice(1)}`;
  else if (/^7\d{10}$/.test(phone)) phone = `+${phone}`;
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new Error("Укажите международный номер: +код страны и номер, например +1 202 555 0123 или +44 7911 123456. Вместо + допустимо 00. Пробелы, скобки, дефисы и точки допустимы. Для номеров +7 также можно начать с 8.");
  }
  return phone;
}

export interface Preferences {
  enabled: boolean;
  selectedChatIds: string[];
  selectedChatNames: Record<string, string>;
  hideIdentity: boolean;
  textTemplate: string;
  voiceTemplate: string;
  replyWindowSeconds: number;
  replyCommandPhrase: string;
  replyConfirmationTemplate: string;
  sendCommandPhrase: string;
  broadcastCommandPhrase: string;
  broadcastDelayMinSeconds: number;
  broadcastDelayMaxSeconds: number;
  autoResponderEnabled: boolean;
  autoReplyRules: AutoReplyRule[];
}

export interface PersistedState {
  schemaVersion: 3;
  phone: string;
  session: string;
  preferences: Preferences;
  autoReplyCampaign?: AutoReplyCampaign;
}

export interface ChatInfo {
  id: string;
  title: string;
  kind: "user" | "group" | "channel";
  unreadCount: number;
}

export interface TemplateValues {
  sender: string;
  chat: string;
  message: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  enabled: true,
  selectedChatIds: [],
  selectedChatNames: {},
  hideIdentity: false,
  textTemplate: "Вам написал {sender}. {message}",
  voiceTemplate: "Вам прислал голосовое сообщение {sender}",
  replyWindowSeconds: 300,
  replyCommandPhrase: "ответь",
  replyConfirmationTemplate: "Ответ отправлен.",
  sendCommandPhrase: "напиши",
  broadcastCommandPhrase: "разошли",
  broadcastDelayMinSeconds: 3,
  broadcastDelayMaxSeconds: 7,
  autoResponderEnabled: false,
  autoReplyRules: [],
};

export function defaultState(): PersistedState {
  return {
    schemaVersion: 3,
    phone: "",
    session: "",
    preferences: { ...DEFAULT_PREFERENCES, selectedChatIds: [], selectedChatNames: {} },
  };
}

export function sanitizePreferences(value: Partial<Preferences> | undefined): Preferences {
  const selected = Array.isArray(value?.selectedChatIds)
    ? [...new Set(value.selectedChatIds.map(String))].slice(0, MAX_SELECTED_CHATS)
    : [];
  const requestedBroadcastDelayMin = clampInteger(
    value?.broadcastDelayMinSeconds,
    1,
    60,
    DEFAULT_PREFERENCES.broadcastDelayMinSeconds,
  );
  const requestedBroadcastDelayMax = clampInteger(
    value?.broadcastDelayMaxSeconds,
    1,
    60,
    DEFAULT_PREFERENCES.broadcastDelayMaxSeconds,
  );
  return {
    enabled: value?.enabled !== false,
    selectedChatIds: selected,
    selectedChatNames: sanitizeChatNames(value?.selectedChatNames, selected),
    hideIdentity: value?.hideIdentity === true,
    textTemplate: cleanText(value?.textTemplate, DEFAULT_PREFERENCES.textTemplate, 500),
    voiceTemplate: cleanText(value?.voiceTemplate, DEFAULT_PREFERENCES.voiceTemplate, 500),
    replyWindowSeconds: clampInteger(value?.replyWindowSeconds, 10, 3600, DEFAULT_PREFERENCES.replyWindowSeconds),
    replyCommandPhrase: cleanText(value?.replyCommandPhrase, DEFAULT_PREFERENCES.replyCommandPhrase, 80),
    replyConfirmationTemplate: cleanOptionalText(
      value?.replyConfirmationTemplate,
      DEFAULT_PREFERENCES.replyConfirmationTemplate,
      500,
    ),
    sendCommandPhrase: cleanText(
      value?.sendCommandPhrase,
      DEFAULT_PREFERENCES.sendCommandPhrase,
      80,
    ),
    broadcastCommandPhrase: cleanText(
      value?.broadcastCommandPhrase,
      DEFAULT_PREFERENCES.broadcastCommandPhrase,
      80,
    ),
    broadcastDelayMinSeconds: Math.min(requestedBroadcastDelayMin, requestedBroadcastDelayMax),
    broadcastDelayMaxSeconds: Math.max(requestedBroadcastDelayMin, requestedBroadcastDelayMax),
    autoResponderEnabled: value?.autoResponderEnabled === true,
    autoReplyRules: normalizeAutoReplyRules(value?.autoReplyRules),
  };
}

function sanitizeChatNames(value: unknown, selectedChatIds: string[]): Record<string, string> {
  const names: Record<string, string> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return names;
  const source = value as Record<string, unknown>;
  for (const id of selectedChatIds) {
    const title = source[id];
    if (typeof title !== "string") continue;
    const trimmed = title.trim().slice(0, 160);
    if (trimmed) names[id] = trimmed;
  }
  return names;
}

export function applyTemplate(template: string, values: TemplateValues): string {
  return template
    .replaceAll("{sender}", values.sender)
    .replaceAll("{chat}", values.chat)
    .replaceAll("{message}", values.message)
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, maxLength);
  return trimmed || fallback;
}

function cleanOptionalText(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}
