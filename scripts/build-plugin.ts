import { readFile } from "node:fs/promises";
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

async function main(): Promise<void> {
  const local = await readLocalDeployment();
  const credentialsUrl = String(process.env.ASTRA_TELEGRAM_CREDENTIALS_URL ?? local.credentialsUrl ?? "").trim();
  const credentialsToken = String(process.env.ASTRA_TELEGRAM_CREDENTIALS_TOKEN ?? local.credentialsToken ?? "").trim();

  if (Boolean(credentialsUrl) !== Boolean(credentialsToken)) {
    throw new Error("Укажите одновременно credentialsUrl и credentialsToken");
  }

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
      __ASTRA_TELEGRAM_CREDENTIALS_URL__: JSON.stringify(credentialsUrl),
      __ASTRA_TELEGRAM_CREDENTIALS_TOKEN__: JSON.stringify(credentialsToken),
    },
  });

  process.stdout.write(
    credentialsUrl
      ? "Deployment endpoint embedded; end users only enter their phone number.\n"
      : "Deployment endpoint not embedded; runtime environment fallback remains enabled.\n",
  );
}

void main();
