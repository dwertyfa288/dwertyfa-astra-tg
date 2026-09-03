export const MAX_SELECTED_CHATS = 1000;
export const MAX_VOICE_BYTES = 20 * 1024 * 1024;

export interface Preferences {
  enabled: boolean;
  selectedChatIds: string[];
  selectedChatNames: Record<string, string>;
  hideIdentity: boolean;
  textTemplate: string;
  voiceTemplate: string;
  replyWindowSeconds: number;
  replyConfirmationTemplate: string;
}

export interface PersistedState {
  schemaVersion: 2;
  phone: string;
  session: string;
  preferences: Preferences;
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
  replyConfirmationTemplate: "Ответ отправлен.",
};

export function defaultState(): PersistedState {
  return {
    schemaVersion: 2,
    phone: "",
    session: "",
    preferences: { ...DEFAULT_PREFERENCES, selectedChatIds: [], selectedChatNames: {} },
  };
}

export function sanitizePreferences(value: Partial<Preferences> | undefined): Preferences {
  const selected = Array.isArray(value?.selectedChatIds)
    ? [...new Set(value.selectedChatIds.map(String))].slice(0, MAX_SELECTED_CHATS)
    : [];
  return {
    enabled: value?.enabled !== false,
    selectedChatIds: selected,
    selectedChatNames: sanitizeChatNames(value?.selectedChatNames, selected),
    hideIdentity: value?.hideIdentity === true,
    textTemplate: cleanText(value?.textTemplate, DEFAULT_PREFERENCES.textTemplate, 500),
    voiceTemplate: cleanText(value?.voiceTemplate, DEFAULT_PREFERENCES.voiceTemplate, 500),
    replyWindowSeconds: clampInteger(value?.replyWindowSeconds, 10, 3600, DEFAULT_PREFERENCES.replyWindowSeconds),
    replyConfirmationTemplate: cleanOptionalText(
      value?.replyConfirmationTemplate,
      DEFAULT_PREFERENCES.replyConfirmationTemplate,
      500,
    ),
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

export function normalizeSpeech(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/[.!?,;:]+$/u, "")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru-RU");
}

export function matchReplyCommand(
  spoken: string,
  configuredTrigger: string,
): { kind: "none" | "trigger" | "reply"; text: string } {
  const trigger = normalizeSpeech(configuredTrigger);
  if (!trigger) return { kind: "none", text: "" };
  const triggerPattern = trigger
    .split(/\s+/u)
    .map(escapeRegExp)
    .join("\\s+");
  const replyPattern = new RegExp(
    `^${triggerPattern}(?:$|[\\s,.:;!?—-]+([\\s\\S]*))$`,
    "iu",
  );

  const trimmed = spoken.trim();
  const candidates = [trimmed];
  const withoutWakeWord = trimmed.replace(/^(?:астра|astra)[\s,.:;!?—-]+/iu, "").trim();
  if (withoutWakeWord && withoutWakeWord !== trimmed) candidates.push(withoutWakeWord);

  for (const candidate of candidates) {
    const match = candidate.normalize("NFKC").match(replyPattern);
    if (!match) continue;
    const reply = String(match[1] ?? "").trim();
    return reply ? { kind: "reply", text: reply } : { kind: "trigger", text: "" };
  }

  return { kind: "none", text: "" };
}

export function extractReplyAfterCommandWord(spoken: string): string {
  const trimmed = spoken.normalize("NFKC").trim();
  const withoutWakeWord = trimmed.replace(/^(?:астра|astra)[\s,.:;!?—-]+/iu, "").trim();
  const match = withoutWakeWord.match(/^\S+[\s,.:;!?—-]+([\s\S]+)$/u);
  return String(match?.[1] ?? "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSpeechText(payload: Record<string, unknown>): string {
  const candidate = payload.text ?? payload.transcript ?? payload.utterance ?? payload.phrase;
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function isFinalSpeech(payload: Record<string, unknown>): boolean {
  if (typeof payload.is_final === "boolean") return payload.is_final;
  if (typeof payload.isFinal === "boolean") return payload.isFinal;
  if (typeof payload.final === "boolean") return payload.final;
  return true;
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
