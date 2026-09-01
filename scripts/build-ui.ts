import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderAppHtml, renderPlayerHtml } from "../src/ui";

const outputDirectory = resolve(process.cwd(), "ui");

async function main(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(resolve(outputDirectory, "index.html"), renderAppHtml(), "utf8"),
    writeFile(resolve(outputDirectory, "player.html"), renderPlayerHtml(), "utf8"),
  ]);
}

void main();
