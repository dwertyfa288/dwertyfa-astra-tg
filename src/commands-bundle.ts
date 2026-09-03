import { readFileSync } from "node:fs";
import { join } from "node:path";

declare const __ASTRA_TG_COMMANDS__: string | undefined;

/**
 * The ready-made Astra commands, as the JSON text of an `astra-commands` export.
 *
 * Baked into the bundle at build time from `commands/tg_commands.astra` rather
 * than read from the plugin directory at runtime: `astra-plugin build` packs a
 * fixed file list (LICENSE, README, dist, icon, locales, plugin.toml, ui) and a
 * `commands/` folder is not part of it, so an installed plugin would have no
 * such file to read. The disk fallback is for `npm run dev`, where the constant
 * is not defined because esbuild never ran.
 */
export function commandsBundleText(): string {
  const baked = typeof __ASTRA_TG_COMMANDS__ === "string" ? __ASTRA_TG_COMMANDS__ : "";
  if (baked.trim()) return baked;

  const directory = process.env.ASTRA_PLUGIN_DIR || process.cwd();
  try {
    return readFileSync(join(directory, "commands", "tg_commands.astra"), "utf8");
  } catch {
    return "";
  }
}

export interface CommandsBundle {
  text: string;
  names: string[];
}

/**
 * Parse the bundle and name the commands inside it.
 *
 * Validated rather than trusted: the text is handed to the user as a file they
 * will import into Astra, and a truncated or mis-baked constant must fail here
 * with something a user can act on instead of producing a file Astra refuses.
 */
export function parseCommandsBundle(): CommandsBundle {
  const text = commandsBundleText().trim();
  if (!text) {
    throw new Error("Готовые команды не попали в сборку плагина");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Файл готовых команд повреждён");
  }

  const record = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  if (record.format !== "astra-commands") {
    throw new Error("Файл команд не в формате astra-commands");
  }
  const commands = Array.isArray(record.commands) ? record.commands : [];
  if (!commands.length) {
    throw new Error("Файл команд не содержит ни одной команды");
  }

  const names = commands.map((command) => {
    const name = (command as Record<string, unknown> | null)?.name;
    return typeof name === "string" && name.trim() ? name.trim() : "Без названия";
  });

  return { text: `${text}\n`, names };
}
