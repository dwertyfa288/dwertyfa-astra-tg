export interface BroadcastDialog {
  key: string;
  title: string;
  username?: string;
  peer: unknown;
  kind?: "user" | "group" | "channel";
  contact?: boolean;
  bot?: boolean;
  archived?: boolean;
  muted?: boolean;
  unreadCount?: number;
}

export interface BroadcastFolder {
  title: string;
  memberKeys: string[];
}

export interface BroadcastFolderRule {
  title: string;
  contacts?: boolean;
  nonContacts?: boolean;
  groups?: boolean;
  broadcasts?: boolean;
  bots?: boolean;
  excludeMuted?: boolean;
  excludeRead?: boolean;
  excludeArchived?: boolean;
  pinnedPeerKeys: string[];
  includePeerKeys: string[];
  excludePeerKeys: string[];
}

export type BroadcastPlan =
  | { ok: true; targets: BroadcastDialog[] }
  | { ok: false; message: string };

export function planBroadcast(input: {
  recipientQueries: string[];
  folderQueries: string[];
  dialogs: BroadcastDialog[];
  folders: BroadcastFolder[];
  maxRecipients: number;
}): BroadcastPlan {
  const selected = new Map<string, BroadcastDialog>();
  const dialogsByKey = new Map(input.dialogs.map((dialog) => [dialog.key, dialog]));

  for (const query of input.recipientQueries) {
    const matches = input.dialogs
      .map((candidate) => ({
        candidate,
        score: Math.max(
          scoreName(query, [candidate.title]),
          normalizeName(query) === normalizeName(candidate.username ?? "") ? 110 : scoreName(query, [candidate.username]),
        ),
      }))
      .filter((match) => match.score >= 70)
      .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title, "ru"));
    const best = matches[0];
    if (!best) {
      return {
        ok: false,
        message: `Не найден чат «${query}». Уточните название или @username.`,
      };
    }
    const ambiguous = matches.filter((match, index) =>
      index > 0 && (match.score === best.score || (best.score < 100 && best.score - match.score <= 2)));
    if (ambiguous.length) {
      const names = [best, ...ambiguous]
        .slice(0, 5)
        .map((match) => `«${match.candidate.title}»`)
        .join(", ");
      return {
        ok: false,
        message: `Найдено несколько чатов для «${query}»: ${names}. Уточните название или @username.`,
      };
    }
    selected.set(best.candidate.key, best.candidate);
  }

  for (const query of input.folderQueries) {
    const matches = input.folders
      .map((candidate) => ({ candidate, score: scoreName(query, [candidate.title]) }))
      .filter((match) => match.score >= 70)
      .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title, "ru"));
    const best = matches[0];
    if (!best) {
      return {
        ok: false,
        message: `Не найдена папка «${query}». Уточните название папки.`,
      };
    }
    const ambiguous = matches.filter((match, index) =>
      index > 0 && (match.score === best.score || (best.score < 100 && best.score - match.score <= 2)));
    if (ambiguous.length) {
      const names = [best, ...ambiguous]
        .slice(0, 5)
        .map((match) => `«${match.candidate.title}»`)
        .join(", ");
      return {
        ok: false,
        message: `Найдено несколько папок для «${query}»: ${names}. Уточните название папки.`,
      };
    }
    for (const key of best.candidate.memberKeys) {
      const dialog = dialogsByKey.get(key);
      if (dialog) selected.set(dialog.key, dialog);
    }
  }

  const targets = [...selected.values()];
  if (targets.length > input.maxRecipients) {
    return {
      ok: false,
      message: `В рассылке ${targets.length} чатов. Максимум — ${input.maxRecipients}. Уменьшите список.`,
    };
  }
  return { ok: true, targets };
}

export function expandFolderMembers(
  folder: BroadcastFolderRule,
  dialogs: BroadcastDialog[],
): string[] {
  const explicit = new Set([...folder.pinnedPeerKeys, ...folder.includePeerKeys]);
  const excluded = new Set(folder.excludePeerKeys);

  return dialogs
    .filter((dialog) => {
      if (excluded.has(dialog.key)) return false;
      if (explicit.has(dialog.key)) return true;
      if (folder.excludeMuted && dialog.muted) return false;
      if (folder.excludeRead && Number(dialog.unreadCount ?? 0) === 0) return false;
      if (folder.excludeArchived && dialog.archived) return false;
      if (dialog.kind === "group") return folder.groups === true;
      if (dialog.kind === "channel") return folder.broadcasts === true;
      if (dialog.kind !== "user") return false;
      if (dialog.bot) return folder.bots === true;
      return dialog.contact ? folder.contacts === true : folder.nonContacts === true;
    })
    .map((dialog) => dialog.key);
}

export async function runBroadcastQueue(input: {
  targets: BroadcastDialog[];
  minDelayMs: number;
  maxDelayMs: number;
  random: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  send: (target: BroadcastDialog) => Promise<void>;
  floodWaitMilliseconds: (error: unknown) => number | undefined;
}): Promise<{
  sent: BroadcastDialog[];
  failed: Array<{ target: BroadcastDialog; error: string }>;
}> {
  const sent: BroadcastDialog[] = [];
  const failed: Array<{ target: BroadcastDialog; error: string }> = [];

  for (let index = 0; index < input.targets.length; index += 1) {
    const target = input.targets[index];
    while (true) {
      try {
        await input.send(target);
        sent.push(target);
        break;
      } catch (error) {
        const floodWait = input.floodWaitMilliseconds(error);
        if (floodWait !== undefined) {
          await input.sleep(Math.max(0, floodWait));
          continue;
        }
        failed.push({ target, error: error instanceof Error ? error.message : String(error) });
        break;
      }
    }
    if (index < input.targets.length - 1) {
      const low = Math.min(input.minDelayMs, input.maxDelayMs);
      const high = Math.max(input.minDelayMs, input.maxDelayMs);
      await input.sleep(Math.round(low + (high - low) * input.random()));
    }
  }

  return { sent, failed };
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е")
    .replace(/^@/u, "")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreName(queryValue: string, aliases: Array<string | undefined>): number {
  const query = normalizeName(queryValue);
  if (!query) return 0;
  let best = 0;
  for (const aliasValue of aliases) {
    const alias = normalizeName(String(aliasValue ?? ""));
    if (!alias) continue;
    if (alias === query) best = Math.max(best, 100);
    if (alias.startsWith(query) || query.startsWith(alias)) best = Math.max(best, 88);
    if (alias.includes(query) || query.includes(alias)) best = Math.max(best, 80);
    const longest = Math.max(alias.length, query.length);
    const similarity = longest ? 1 - levenshteinDistance(alias, query) / longest : 0;
    if (similarity >= 0.72) best = Math.max(best, Math.round(60 + similarity * 25));
  }
  return best;
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
