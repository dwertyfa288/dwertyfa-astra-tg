import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

import WebSocket, { WebSocketServer } from "ws";

const port = readInteger("PORT", 8787, 1, 65_535);
const telegramApiId = readInteger("TELEGRAM_API_ID", 0, 1, Number.MAX_SAFE_INTEGER);
const telegramApiHash = String(process.env.TELEGRAM_API_HASH ?? "").trim();
const bearerToken = String(process.env.CREDENTIALS_BEARER_TOKEN ?? "").trim();
const publicRelayUrl = String(process.env.PUBLIC_RELAY_URL ?? "").trim();
const rateLimitPerMinute = readInteger("RATE_LIMIT_PER_MINUTE", 30, 1, 10_000);
const maxRelayConnectionsPerIp = readInteger("MAX_RELAY_CONNECTIONS_PER_IP", 12, 1, 100);
const maxRelayQueueBytes = readInteger("MAX_RELAY_QUEUE_BYTES", 1_048_576, 65_536, 16_777_216);
const telegramHostPattern = /^(?:pluto|venus|aurora|vesta|flora)(?:-1)?\.web\.telegram\.org$/i;
const rateLimits = new Map();
const activeRelays = new Map();

if (!/^[a-f\d]{32}$/i.test(telegramApiHash)) {
  throw new Error("TELEGRAM_API_HASH must contain exactly 32 hexadecimal characters");
}
if (bearerToken.length < 32) {
  throw new Error("CREDENTIALS_BEARER_TOKEN must contain at least 32 characters");
}
validatePublicRelayUrl(publicRelayUrl);

const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024 * 1024,
  perMessageDeflate: false,
});

const server = createServer((request, response) => {
  harden(response);
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { ok: true });
  }
  if (request.method !== "GET" || url.pathname !== "/v1/astra-telegram/bootstrap") {
    return json(response, 404, { error: "not_found" });
  }

  const clientAddress = remoteAddress(request);
  if (!allowRequest(clientAddress)) {
    response.setHeader("Retry-After", "60");
    return json(response, 429, { error: "rate_limited" });
  }
  if (!authorized(request.headers.authorization)) {
    return json(response, 401, { error: "unauthorized" });
  }

  return json(response, 200, {
    api_id: telegramApiId,
    api_hash: telegramApiHash,
    relay_url: publicRelayUrl,
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== "/v1/astra-telegram/relay") {
    rejectUpgrade(socket, 404, "Not Found");
    return;
  }

  const clientAddress = remoteAddress(request);
  if (!allowRequest(clientAddress)) {
    rejectUpgrade(socket, 429, "Too Many Requests");
    return;
  }
  if (!authorized(request.headers.authorization)) {
    rejectUpgrade(socket, 401, "Unauthorized");
    return;
  }

  const target = String(url.searchParams.get("target") ?? "").toLowerCase();
  const test = url.searchParams.get("test") === "1";
  if (!telegramHostPattern.test(target)) {
    rejectUpgrade(socket, 400, "Invalid Telegram target");
    return;
  }
  if ((activeRelays.get(clientAddress) ?? 0) >= maxRelayConnectionsPerIp) {
    rejectUpgrade(socket, 429, "Relay connection limit reached");
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (client) => {
    activeRelays.set(clientAddress, (activeRelays.get(clientAddress) ?? 0) + 1);
    bridgeTelegramWebSocket(client, target, test, clientAddress);
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Astra Telegram service listening on 127.0.0.1:${port}\n`);
});

function bridgeTelegramWebSocket(client, target, test, clientAddress) {
  const targetUrl = `wss://${target}:443/apiws${test ? "_test" : ""}`;
  const upstream = new WebSocket(targetUrl, "binary", {
    handshakeTimeout: 10_000,
    maxPayload: 64 * 1024 * 1024,
    perMessageDeflate: false,
    followRedirects: false,
  });
  const pending = [];
  let pendingBytes = 0;
  let finished = false;

  const finish = (code = 1011, reason = "relay_closed") => {
    if (finished) return;
    finished = true;
    activeRelays.set(clientAddress, Math.max(0, (activeRelays.get(clientAddress) ?? 1) - 1));
    if (activeRelays.get(clientAddress) === 0) activeRelays.delete(clientAddress);
    closeWebSocket(client, code, reason);
    closeWebSocket(upstream, code, reason);
  };

  client.on("message", (data, isBinary) => {
    if (!isBinary) {
      finish(1003, "binary_required");
      return;
    }
    const payload = rawDataBuffer(data);
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(payload, { binary: true });
      return;
    }
    pendingBytes += payload.length;
    if (pendingBytes > maxRelayQueueBytes) {
      finish(1009, "relay_queue_limit");
      return;
    }
    pending.push(payload);
  });

  upstream.on("open", () => {
    for (const payload of pending) upstream.send(payload, { binary: true });
    pending.length = 0;
    pendingBytes = 0;
  });
  upstream.on("message", (data, isBinary) => {
    if (!isBinary || client.readyState !== WebSocket.OPEN) {
      if (!isBinary) finish(1003, "upstream_binary_required");
      return;
    }
    client.send(rawDataBuffer(data), { binary: true });
  });

  client.on("error", () => finish());
  upstream.on("error", () => finish(1011, "telegram_upstream_error"));
  client.on("close", () => finish(1000, "client_closed"));
  upstream.on("close", () => finish(1000, "telegram_closed"));
}

function closeWebSocket(socket, code, reason) {
  if (socket.readyState === WebSocket.CLOSED) return;
  try {
    socket.close(code, reason.slice(0, 120));
  } catch {
    socket.terminate();
  }
}

function rawDataBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function harden(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

function authorized(header) {
  const authorization = String(header ?? "");
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return secretEquals(suppliedToken, bearerToken);
}

function allowRequest(key) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + 60_000 });
    if (rateLimits.size > 10_000) {
      for (const [address, value] of rateLimits) {
        if (value.resetAt <= now) rateLimits.delete(address);
      }
    }
    return true;
  }
  current.count += 1;
  return current.count <= rateLimitPerMinute;
}

function remoteAddress(request) {
  const forwarded = String(request.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

function rejectUpgrade(socket, status, message) {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\n` +
    "Connection: close\r\n" +
    "Content-Type: text/plain; charset=utf-8\r\n" +
    `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

function secretEquals(supplied, expected) {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function validatePublicRelayUrl(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error("PUBLIC_RELAY_URL must be a valid WSS URL");
  }
  const local = endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost";
  if (endpoint.protocol !== "wss:" && !(local && endpoint.protocol === "ws:")) {
    throw new Error("PUBLIC_RELAY_URL must use wss://");
  }
}

function readInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
