import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Api } from "teleproto";
import { sendCode, signInUser } from "teleproto/client/auth";
import { TelegramBridge } from "../src/telegram-bridge";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("login state timeout");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function setup() {
  const bridge = new TelegramBridge(join(tmpdir(), `tg-login-${randomUUID()}.json`)) as any;
  const requests: any[] = [];
  const logs: string[] = [];
  let clientCount = 0;
  const client = {
    connect: async () => undefined,
    disconnect: async () => undefined,
    removeEventHandler: () => undefined,
    addEventHandler: () => undefined,
    session: { save: () => "test-session" },
    getMe: async () => ({ firstName: "Test" }),
    invoke: async (request: any) => {
      requests.push(request);
      if (request instanceof Api.auth.SignIn) return new Api.auth.Authorization({ user: new Api.UserEmpty({ id: 1 as any }) });
      return new Api.auth.SentCode({
        phoneCodeHash: request instanceof Api.auth.ResendCode ? "second-secret-hash" : "first-secret-hash",
        type: request instanceof Api.auth.ResendCode ? new Api.auth.SentCodeTypeSms({ length: 5 }) : new Api.auth.SentCodeTypeApp({ length: 5 }),
        nextType: new Api.auth.CodeTypeSms(),
        timeout: 30,
      });
    },
  };
  (client as any).sendCode = (...args: any[]) => (sendCode as any)(client, ...args);
  (client as any).signInUser = (...args: any[]) => (signInUser as any)(client, ...args);
  bridge.ctx = { log: async (_level: string, message: string) => { logs.push(message); } };
  bridge.fetchTelegramCredentials = async () => ({ apiId: 1, apiHash: "test", relayUrl: "wss://example.test", accessToken: "test" });
  bridge.createTelegramClient = () => { clientCount++; return client; };
  return { bridge, requests, logs, client, clientCount: () => clientCount };
}

test("resend preserves the login connection and signs in with the latest code hash", async () => {
  const { bridge, requests, logs, clientCount } = setup();
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  assert.equal(bridge.publicState().codeNextDelivery, "sms");
  assert.ok(bridge.publicState().codeResendWaitSeconds > 0);
  await assert.rejects(bridge.resendLoginCode(), /сек/);
  assert.equal(requests.length, 1);
  bridge.loginCode.resendAvailableAt = Date.now() - 1;
  await bridge.resendLoginCode();
  const resend = requests.find((request) => request instanceof Api.auth.ResendCode);
  assert.equal(resend.phoneCodeHash, "first-secret-hash");
  assert.equal(clientCount(), 1);
  assert.equal(bridge.publicState().codeDelivery, "sms");
  bridge.submitCode("12345");
  await until(() => bridge.publicState().connected);
  const signIn = requests.find((request) => request instanceof Api.auth.SignIn);
  assert.equal(signIn.phoneCodeHash, "second-secret-hash");
  assert.equal(signIn.phoneCode, "12345");
  assert.equal(logs.some((line) => /secret-hash|12345/.test(line)), false);
});

test("pressing begin again for the same pending phone never restarts the code request", async () => {
  const { bridge, requests, clientCount } = setup();
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  await bridge.beginLogin("+7 999 123-45-67");
  assert.equal(clientCount(), 1);
  assert.equal(requests.length, 1);
  assert.equal(bridge.publicState().authStage, "awaiting_code");
  await bridge.stop();
});

test("a failed resend retains the existing code and login attempt", async () => {
  const { bridge, client } = setup();
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  assert.ok(bridge.loginCode, "login attempt must retain the code request");
  bridge.loginCode.resendAvailableAt = Date.now() - 1;
  const invoke = client.invoke;
  client.invoke = async (request: any) => {
    if (request instanceof Api.auth.ResendCode) throw new Error("SEND_CODE_UNAVAILABLE");
    return invoke(request);
  };
  await assert.rejects(bridge.resendLoginCode(), /SEND_CODE_UNAVAILABLE/);
  assert.equal(bridge.publicState().authStage, "awaiting_code");
  assert.equal(bridge.loginCode.phoneCodeHash, "first-secret-hash");
  bridge.submitCode("12345");
  await until(() => bridge.publicState().connected);
});

test("a wrong code can be corrected within the same attempt", async () => {
  const { bridge, client, clientCount } = setup();
  const invoke = client.invoke;
  client.invoke = async (request: any) => {
    if (request instanceof Api.auth.SignIn && request.phoneCode === "00000") throw new Error("PHONE_CODE_INVALID");
    return invoke(request);
  };
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  bridge.submitCode("00000");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  assert.ok(bridge.publicState().authError);
  bridge.submitCode("12345");
  await until(() => bridge.publicState().connected);
  assert.equal(clientCount(), 1);
});

test("password protected login retains the password retry flow", async () => {
  const { bridge, client } = setup();
  const invoke = client.invoke;
  client.invoke = async (request: any) => {
    if (request instanceof Api.auth.SignIn) throw new Error("SESSION_PASSWORD_NEEDED");
    return invoke(request);
  };
  (client as any).signInWithPassword = async (_credentials: any, options: any) => {
    assert.equal(await options.password("hint"), "wrong");
    assert.equal(await options.onError(new Error("PASSWORD_HASH_INVALID")), false);
    assert.equal(await options.password("hint"), "correct");
  };
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  bridge.submitCode("12345");
  await until(() => bridge.publicState().authStage === "awaiting_password");
  bridge.submitPassword("wrong");
  await until(() => bridge.publicState().authStage === "awaiting_password");
  bridge.submitPassword("correct");
  await until(() => bridge.publicState().connected);
});

test("a resend that authorizes directly does not submit another sign-in", async () => {
  const { bridge, client, requests } = setup();
  const invoke = client.invoke;
  client.invoke = async (request: any) => request instanceof Api.auth.ResendCode
    ? new Api.auth.SentCodeSuccess({ authorization: new Api.auth.Authorization({ user: new Api.UserEmpty({ id: 1 as any }) }) })
    : invoke(request);
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  bridge.loginCode.resendAvailableAt = Date.now() - 1;
  await bridge.resendLoginCode();
  await bridge.authTask;
  assert.equal(bridge.publicState().connected, true);
  assert.equal(requests.some((request) => request instanceof Api.auth.SignIn), false);
});

test("a successful resend with unsupported delivery invalidates the old login code", async () => {
  const { bridge, client } = setup();
  const invoke = client.invoke;
  client.invoke = async (request: any) => request instanceof Api.auth.ResendCode
    ? new Api.auth.SentCode({ phoneCodeHash: "rotated-hash", type: new Api.auth.SentCodeTypeEmailCode({ emailPattern: "x***@example.test", length: 5 }) })
    : invoke(request);
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  bridge.loginCode.resendAvailableAt = Date.now() - 1;
  await assert.rejects(bridge.resendLoginCode(), /не поддерживается/);
  assert.equal(bridge.publicState().authStage, "error");
  assert.throws(() => bridge.submitCode("12345"));
  assert.equal(bridge.loginCode, undefined);
});

test("AUTH_RESTART retries once on the same connection", async () => {
  const { bridge, client, clientCount } = setup();
  const invoke = client.invoke;
  let sends = 0;
  client.invoke = async (request: any) => {
    if (request instanceof Api.auth.SendCode && ++sends === 1) throw new Error("AUTH_RESTART");
    return invoke(request);
  };
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage !== "sending_code");
  assert.equal(bridge.publicState().authStage, "awaiting_code");
  assert.equal(sends, 2);
  assert.equal(clientCount(), 1);
  await bridge.stop();
});

test("FLOOD_WAIT from Telegram enforces its retry delay", async () => {
  const { bridge, client } = setup();
  const invoke = client.invoke;
  client.invoke = async (request: any) => {
    if (request instanceof Api.auth.ResendCode) throw new Error("FLOOD_WAIT_60");
    return invoke(request);
  };
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  bridge.loginCode.resendAvailableAt = Date.now() - 1;
  await assert.rejects(bridge.resendLoginCode(), /FLOOD_WAIT/);
  assert.ok(bridge.publicState().codeResendWaitSeconds > 0);
  await bridge.stop();
});

test("QR login displays an image and authorizes without requesting a phone code", async () => {
  const { bridge, client, requests, logs } = setup();
  assert.equal(typeof bridge.beginQrLogin, "function");
  let approve!: () => void;
  const approved = new Promise<void>((resolve) => { approve = resolve; });
  (client as any).getMe = async () => ({ firstName: "QR Test", phone: "79991234567" });
  (client as any).signInUserWithQrCode = async (_credentials: any, options: any) => {
    await options.qrCode({ token: Buffer.from("private-qr-token"), expires: Math.floor(Date.now() / 1000) + 30 });
    await approved;
  };
  await bridge.beginQrLogin();
  await until(() => bridge.publicState().authStage === "awaiting_qr");
  assert.match(bridge.publicState().qrLogin.image, /^data:image\/png;base64,/);
  assert.ok(bridge.publicState().qrLogin.expiresAt > Date.now());
  assert.equal(bridge.publicState().connected, false);
  approve();
  await until(() => bridge.publicState().connected);
  assert.equal(bridge.publicState().phone, "+79991234567");
  assert.equal(bridge.publicState().qrLogin, null);
  assert.equal(requests.some((request) => request instanceof Api.auth.SendCode), false);
  assert.equal(logs.some((line) => line.includes("private-qr-token") || line.includes("tg://login")), false);
});

test("cancelled QR callbacks cannot restore a stale QR or authorize", async () => {
  const { bridge, client } = setup();
  assert.equal(typeof bridge.beginQrLogin, "function");
  let callback: any;
  (client as any).signInUserWithQrCode = async (_credentials: any, options: any) => {
    callback = options.qrCode;
    await callback({ token: Buffer.from("first"), expires: Math.floor(Date.now() / 1000) + 30 });
    await new Promise<void>((_resolve, reject) => options.abortSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  };
  await bridge.beginQrLogin();
  await until(() => bridge.publicState().authStage === "awaiting_qr");
  await bridge.cancelQrLogin();
  await callback({ token: Buffer.from("stale"), expires: Math.floor(Date.now() / 1000) + 30 });
  assert.equal(bridge.publicState().qrLogin, null);
  assert.equal(bridge.publicState().connected, false);
  assert.equal(bridge.publicState().authStage, "logged_out");
});

test("QR login still requests the account 2FA password", async () => {
  const { bridge, client } = setup();
  assert.equal(typeof bridge.beginQrLogin, "function");
  (client as any).signInUserWithQrCode = async (_credentials: any, options: any) => {
    await options.qrCode({ token: Buffer.from("qr-password"), expires: Math.floor(Date.now() / 1000) + 30 });
    assert.equal(await options.password("2FA hint"), "correct-password");
  };
  await bridge.beginQrLogin();
  await until(() => bridge.publicState().authStage === "awaiting_password");
  assert.equal(bridge.publicState().qrLogin, null);
  bridge.submitPassword("correct-password");
  await until(() => bridge.publicState().connected);
});

test("an in-flight QR render cannot hide the 2FA password form", async () => {
  const { bridge, client } = setup();
  let rendered = false;
  (client as any).signInUserWithQrCode = async (_credentials: any, options: any) => {
    const rendering = options.qrCode({ token: Buffer.from("racing-qr"), expires: Math.floor(Date.now() / 1000) + 30 });
    const password = options.password("hint");
    await rendering;
    rendered = true;
    await password;
  };
  await bridge.beginQrLogin();
  await until(() => rendered);
  assert.equal(bridge.publicState().authStage, "awaiting_password");
  assert.equal(bridge.publicState().qrLogin, null);
  await bridge.cancelQrLogin();
});

test("slow QR cancellation cannot overwrite a newer phone login", async () => {
  const { bridge, client } = setup();
  let finishDisconnect!: () => void;
  client.disconnect = () => new Promise<void>((resolve) => { finishDisconnect = resolve; });
  (client as any).signInUserWithQrCode = async (_credentials: any, options: any) => {
    await options.qrCode({ token: Buffer.from("cancel-race"), expires: Math.floor(Date.now() / 1000) + 30 });
    await new Promise<void>((_resolve, reject) => options.abortSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  };
  await bridge.beginQrLogin();
  await until(() => bridge.publicState().authStage === "awaiting_qr");
  const cancelling = bridge.cancelQrLogin();
  await until(() => Boolean(finishDisconnect));
  await bridge.beginLogin("89991234567");
  await until(() => bridge.publicState().authStage === "awaiting_code");
  finishDisconnect();
  await cancelling;
  assert.equal(bridge.publicState().authStage, "awaiting_code");
  client.disconnect = async () => undefined;
  await bridge.stop();
});

test("cancelling QR during account lookup cannot persist the cancelled session", async () => {
  const { bridge, client } = setup();
  let approve!: () => void;
  let finishLookup!: () => void;
  let lookupStarted = false;
  const approved = new Promise<void>((resolve) => { approve = resolve; });
  const lookup = new Promise<void>((resolve) => { finishLookup = resolve; });
  (client as any).getMe = async () => { lookupStarted = true; await lookup; return { firstName: "Cancelled", phone: "79991234567" }; };
  (client as any).signInUserWithQrCode = async (_credentials: any, options: any) => {
    await options.qrCode({ token: Buffer.from("cancel-during-lookup"), expires: Math.floor(Date.now() / 1000) + 30 });
    await approved;
  };
  await bridge.beginQrLogin();
  await until(() => bridge.publicState().authStage === "awaiting_qr");
  approve();
  await until(() => lookupStarted);
  await bridge.cancelQrLogin();
  finishLookup();
  await bridge.authTask;
  assert.equal(bridge.publicState().connected, false);
  assert.equal(bridge.publicState().authStage, "logged_out");
  assert.equal(bridge.state.session, "");
});
