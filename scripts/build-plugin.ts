import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

interface LocalDeployment {
  credentialsUrl?: string;
  credentialsToken?: string;
}

async function readLocalDeployment(): Promise<LocalDeployment> {
  try {
    return JSON.parse(await readFile(resolve("deployment.local.json"), "utf8")) as LocalDeployment;
  } catch (error: any) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

/**
 * Read `commands/tg_commands.astra` and check it is what it claims to be.
 *
 * A build that bakes a broken bundle would only fail on the user's machine, at
 * the moment they press the button, so the parse happens here.
 */
async function readCommandsBundle(): Promise<string> {
  const path = resolve("commands", "tg_commands.astra");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error("commands/tg_commands.astra не найден — без него кнопка добавления команд не работает");
    }
    throw error;
  }

  const parsed = JSON.parse(text) as { format?: unknown; commands?: unknown };
  if (parsed.format !== "astra-commands") {
    throw new Error("commands/tg_commands.astra: ожидался format = \"astra-commands\"");
  }
  if (!Array.isArray(parsed.commands) || parsed.commands.length === 0) {
    throw new Error("commands/tg_commands.astra не содержит команд");
  }
  return text.trim();
}

async function main(): Promise<void> {
  const local = await readLocalDeployment();
  const credentialsUrl = String(process.env.ASTRA_TELEGRAM_CREDENTIALS_URL ?? local.credentialsUrl ?? "").trim();
  const credentialsToken = String(process.env.ASTRA_TELEGRAM_CREDENTIALS_TOKEN ?? local.credentialsToken ?? "").trim();

  if (Boolean(credentialsUrl) !== Boolean(credentialsToken)) {
    throw new Error("Укажите одновременно credentialsUrl и credentialsToken");
  }

  // The ready-made Astra commands travel inside dist/index.js. `astra-plugin
  // build` packs a fixed file list and `commands/` is not on it, so a file read
  // at runtime would exist only in this checkout and never in an install.
  const commandsBundle = await readCommandsBundle();

  await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: "dist/index.js",
    alias: {
      bufferutil: "./src/empty-module.ts",
      "utf-8-validate": "./src/empty-module.ts",
    },
    define: {
      "process.env.WS_NO_BUFFER_UTIL": '"1"',
      "process.env.WS_NO_UTF_8_VALIDATE": '"1"',
      __ASTRA_TELEGRAM_CREDENTIALS_URL__: JSON.stringify(credentialsUrl),
      __ASTRA_TELEGRAM_CREDENTIALS_TOKEN__: JSON.stringify(credentialsToken),
      __ASTRA_TG_COMMANDS__: JSON.stringify(commandsBundle),
    },
  });

  const bundle = await readFile(resolve("dist/index.js"), "utf8");
  const cleaned = bundle
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/No WebSocket implementation found: run on Node\.js 22\+ or a browser, or set PromisedWebSockets\.webSocketImpl \(e\.g\. require\("ws"\)\.WebSocket\)/g, "No WebSocket implementation found")
    .replace(/require\("bufferutil"\)/g, "null")
    .replace(/require\("utf-8-validate"\)/g, "null");
  await writeFile(resolve("dist/index.js"), cleaned, "utf8");

  process.stdout.write(
    credentialsUrl
      ? "Deployment endpoint embedded; end users only enter their phone number.\n"
      : "Deployment endpoint not embedded; runtime environment fallback remains enabled.\n",
  );
}

void main();
