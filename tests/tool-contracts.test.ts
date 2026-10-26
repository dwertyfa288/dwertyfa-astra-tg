import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { Harness } from "astra-plugin-sdk/testing";

import { app } from "../src/index";

test("plugin exposes separate tools for preparing and confirming a broadcast", async () => {
  const harness = await Harness.create(app).start();
  const names = await harness.toolNames();

  assert.ok(names.includes("prepare_telegram_message"));
  assert.ok(names.includes("confirm_telegram_message"));
  assert.ok(names.includes("prepare_telegram_broadcast"));
  assert.ok(names.includes("confirm_telegram_broadcast"));
  assert.ok(names.includes("get_telegram_contacts"));
  assert.ok(names.includes("get_telegram_reply_context"));
  assert.ok(names.includes("reply_to_telegram"));

  await harness.assertSchemaAccepts("get_telegram_contacts", { offset: 100 });
  await harness.assertSchemaRejects("get_telegram_contacts", { offset: -1 });
  await harness.assertSchemaAccepts("reply_to_telegram", { incoming_id: "incoming", message: "Привет" });
  await harness.assertSchemaAccepts("reply_to_telegram", { message: "Привет" });
  await harness.assertSchemaRejects("reply_to_telegram", {});

  await harness.assertSchemaAccepts("prepare_telegram_broadcast", {
    request_text: "Астра, отправь Андрюхе и всем из папки Друзья привет",
    recipients: ["Андрюхе"],
    folders: ["Друзья"],
    message: "Привет",
  });
  await harness.shutdown();
});

test("release metadata agrees on version 0.1.22", () => {
  const root = join(import.meta.dirname, "..");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const manifest = readFileSync(join(root, "plugin.toml"), "utf8");
  const manifestVersion = /^version\s*=\s*"([^"]+)"/mu.exec(manifest)?.[1];

  assert.equal(packageJson.version, "0.1.22");
  assert.equal(packageLock.version, "0.1.22");
  assert.equal(packageLock.packages[""].version, "0.1.22");
  assert.equal(manifestVersion, "0.1.22");
});

test("manifest requests Astra chat access for ambiguous saved auto-replies", () => {
  const manifest = readFileSync(join(import.meta.dirname, "..", "plugin.toml"), "utf8");
  const permission = /^send_chat_message\s*=\s*\{\s*reason\s*=\s*"([^"]+)"\s*\}/mu.exec(manifest);

  assert.equal(
    permission?.[1],
    "Chooses one of your saved auto-replies when an incoming Telegram message matches multiple rules",
  );
});
