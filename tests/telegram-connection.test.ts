import assert from "node:assert/strict";
import dns from "node:dns";
import test from "node:test";
import { WebSocketServer } from "ws";
import { createTelegramTransport } from "../src/telegram-transport";
import * as model from "../src/model";

test("phone input normalizes Russian domestic and international formats", () => {
  const normalize = (model as any).normalizeTelegramPhone;
  assert.equal(typeof normalize, "function");
  const cases = [
    ["89991234567", "+79991234567"],
    ["8 (999) 123-45-67", "+79991234567"],
    ["79991234567", "+79991234567"],
    ["+79991234567", "+79991234567"],
    [" +7\u00a0999\u00a0123 45 67 ", "+79991234567"],
    ["+44 7911 123456", "+447911123456"],
  ];
  for (const [input, expected] of cases) assert.equal(normalize(input), expected);
  for (const input of ["8999", "8abcdefghij", "+7+9991234567", "", "+1234567890123456"]) {
    assert.throws(() => normalize(input));
  }
});

test("Telegram traffic uses the configured relay without a direct connection attempt", async (t) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const directHosts: string[] = [];
  const originalLookup = dns.lookup;
  t.mock.method(dns, "lookup", ((host: string, options: any, callback: any) => {
    if (host.endsWith(".telegram.org")) {
      directHosts.push(host);
      const done = typeof options === "function" ? options : callback;
      queueMicrotask(() => done(Object.assign(new Error("blocked direct path"), { code: "ENOTFOUND" })));
      return;
    }
    return (originalLookup as any)(host, options, callback);
  }) as any);
  let route = "";
  let requestPath = "";
  let authorization = "";
  server.on("connection", (socket, request) => {
    requestPath = request.url ?? "";
    authorization = request.headers.authorization ?? "";
    socket.on("message", (data) => socket.send(data));
  });
  const Factory = createTelegramTransport({
    relayUrl: `ws://127.0.0.1:${address.port}/relay`,
    accessToken: "local-test-token",
    onMode: (mode) => { route = mode; },
  });
  const socket = new Factory();
  try {
    await socket.connect(443, "venus.web.telegram.org", false);
    socket.write(Buffer.from("transport-probe"));
    assert.equal((await socket.readExactly(15)).toString(), "transport-probe");
    assert.equal(route, "server_relay");
    assert.equal(authorization, "Bearer local-test-token");
    assert.equal(requestPath, "/relay?target=venus.web.telegram.org&test=0");
    assert.deepEqual(directHosts, []);
  } finally {
    await socket.close();
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
