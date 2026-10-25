import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import bigInt from "big-integer";
import { Api } from "teleproto";
import { TelegramBridge } from "../src/telegram-bridge";

function setup() {
  const bridge = new TelegramBridge(join(tmpdir(), `telegram-ai-${randomUUID()}.json`)) as any;
  const sent: any[] = [];
  const dialogs = [1, 2].map((id) => ({
    title: "Andrew",
    entity: { firstName: "Andrew", lastName: id === 1 ? "Smith" : "Jones", username: id === 1 ? "smith" : "jones" },
    inputEntity: new Api.InputPeerUser({ userId: bigInt(id), accessHash: bigInt(id + 100) }),
    isUser: true,
  }));
  bridge.authStage = "connected";
  bridge.client = {
    getDialogs: async () => dialogs,
    sendMessage: async (peer: any, payload: any) => { sent.push({ id: peer.userId.toString(), ...payload }); },
  };
  bridge.state.preferences.selectedChatIds = ["1", "2"];
  bridge.state.preferences.replyConfirmationTemplate = "";
  const incoming = async (id: number, text: string) => {
    const entity = dialogs[id - 1].entity;
    await bridge.onTelegramMessage({ message: {
      id: id * 10,
      out: false, chatId: bigInt(id), text, voice: false,
      getInputChat: async () => dialogs[id - 1].inputEntity,
      getChat: async () => entity,
      getSender: async () => entity,
    } });
  };
  return { bridge, sent, dialogs, incoming };
}

test("AI receives real contact IDs and names without requiring a name match", async () => {
  const { bridge, sent } = setup();
  const contacts = await bridge.telegramContacts();
  assert.deepEqual(contacts.chats.map((chat: any) => [chat.id, chat.name, chat.username]), [
    ["1", "Andrew Smith", "smith"], ["2", "Andrew Jones", "jones"],
  ]);
  const draft = await bridge.prepareOutgoingMessage("Напиши Эндрю привет", "2", "Привет");
  assert.match(draft, /Отправить/);
  await bridge.confirmOutgoingMessage(true);
  assert.deepEqual(sent, [{ id: "2", message: "Привет" }]);
});

test("broadcast resolves selected IDs even when visible names are identical", async () => {
  const { bridge } = setup();
  const result = await bridge.prepareBroadcastMessage("Напиши обоим Эндрю", ["1", "2"], [], "Привет");
  assert.match(result, /в 2 чата/);
  assert.deepEqual(bridge.pendingBroadcast.targets.map((target: any) => target.key), ["1", "2"]);
});

test("quick reply sends immediately to the selected incoming message and cannot send twice", async () => {
  const { bridge, sent, incoming } = setup();
  await incoming(1, "Когда будешь?");
  const first = bridge.telegramReplyContext().messages[0];
  assert.equal(first.message, "Когда будешь?");
  await incoming(2, "Привет");
  await bridge.replyToTelegram(first.id, "Буду через час");
  assert.deepEqual(sent, [{ id: "1", message: "Буду через час" }]);
  assert.equal(bridge.telegramReplyContext().messages.length, 1);
  await bridge.replyToTelegram(first.id, "Буду через час");
  assert.equal(sent.length, 1);
});

test("expired or invented reply IDs and empty messages never send", async () => {
  const { bridge, sent, incoming } = setup();
  await incoming(1, "Привет");
  const context = bridge.telegramReplyContext().messages[0];
  await bridge.replyToTelegram(context.id, " ");
  await bridge.replyToTelegram("invented", "Привет");
  bridge.pendingReply.expiresAt = Date.now() - 1;
  await bridge.replyToTelegram(context.id, "Привет");
  assert.equal(sent.length, 0);
});

test("new incoming during a send keeps its own reply context", async () => {
  const { bridge, sent, incoming } = setup();
  await incoming(1, "Первое");
  const first = bridge.telegramReplyContext().messages[0];
  bridge.client.sendMessage = async () => { await incoming(2, "Второе"); sent.push("sent"); };
  await bridge.replyToTelegram(first.id, "Ответ");
  assert.equal(bridge.telegramReplyContext().messages[0].message, "Второе");
  assert.equal(bridge.publicState().replyTarget.sender, "Andrew Jones");
});

test("concurrent calls for one incoming message send only once", async () => {
  const { bridge, sent, incoming } = setup();
  await incoming(1, "Привет");
  const { id } = bridge.telegramReplyContext().messages[0];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  bridge.client.sendMessage = async () => { await blocked; sent.push("sent"); };
  const first = bridge.replyToTelegram(id, "Привет");
  await bridge.replyToTelegram(id, "Привет");
  release();
  await first;
  assert.equal(sent.length, 1);
});

test("a failed reply can be retried without losing its destination", async () => {
  const { bridge, sent, incoming } = setup();
  await incoming(1, "Привет");
  const { id } = bridge.telegramReplyContext().messages[0];
  const send = bridge.client.sendMessage;
  bridge.client.sendMessage = async () => { throw new Error("network failure"); };
  await assert.rejects(bridge.replyToTelegram(id, "Привет"), /network failure/);
  bridge.client.sendMessage = send;
  await bridge.replyToTelegram(id, "Привет");
  assert.deepEqual(sent, [{ id: "1", message: "Привет" }]);
});

test("unknown numeric contact IDs never fall back to a similar username", async () => {
  const { bridge, dialogs, sent } = setup();
  dialogs[0].entity.username = "user9999";
  const result = await bridge.prepareOutgoingMessage("Напиши ему", "9999", "Привет");
  assert.match(result, /Не найден/);
  await bridge.confirmOutgoingMessage(true);
  assert.equal(sent.length, 0);
});

test("contact pages include the final contact after the first hundred", async () => {
  const { bridge, dialogs } = setup();
  bridge.client.getDialogs = async () => Array.from({ length: 101 }, (_, index) => ({
    ...dialogs[0],
    inputEntity: new Api.InputPeerUser({ userId: bigInt(index + 1), accessHash: bigInt(1) }),
  }));
  const first = await bridge.telegramContacts();
  assert.equal(first.chats.length, 100);
  assert.equal(first.nextOffset, 100);
  const last = await bridge.telegramContacts(first.nextOffset);
  assert.deepEqual(last.chats.map((chat: any) => chat.id), ["101"]);
  assert.equal(last.nextOffset, null);
});

test("reply context distinguishes incoming messages from contacts with identical names", async () => {
  const { bridge, dialogs, incoming, sent } = setup();
  dialogs.forEach((dialog) => { dialog.entity.lastName = ""; });
  await incoming(1, "Первое");
  await incoming(2, "Второе");
  const contexts = bridge.telegramReplyContext().messages;
  assert.deepEqual(contexts.map((item: any) => [item.chat_id, item.sender_username]), [["2", "jones"], ["1", "smith"]]);
  const chosen = contexts.find((item: any) => item.chat_id === "1");
  await bridge.replyToTelegram(chosen.id, "Привет");
  assert.deepEqual(sent, [{ id: "1", message: "Привет" }]);
});
