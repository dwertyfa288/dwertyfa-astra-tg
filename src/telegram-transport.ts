import WebSocket, { type RawData } from "ws";

import type { SocketFactory, SocketInterface } from "teleproto/extensions/SocketInterface";
import type { ProxyInterface } from "teleproto/network/connection/TCPMTProxy";

const MAX_BUFFERED_BYTES = 64 * 1024 * 1024;
const TELEGRAM_WEB_HOST = /^(?:pluto|venus|aurora|vesta|flora)(?:-1)?\.web\.telegram\.org$/i;

export interface TelegramTransportConfig {
  relayUrl: string;
  accessToken: string;
  onMode?: (mode: "direct_wss" | "server_relay") => void;
}

export function createTelegramTransport(config: TelegramTransportConfig): SocketFactory {
  const relayUrl = config.relayUrl;
  const accessToken = config.accessToken;
  const reportMode = config.onMode;

  class AutomaticTelegramWebSocket implements SocketInterface {
    static readonly isWebSocket = true;

    private socket?: WebSocket;
    private chunks: Buffer[] = [];
    private headOffset = 0;
    private available = 0;
    private closed = true;
    private failure?: Error;
    private wakeReader?: () => void;

    constructor(_proxy?: ProxyInterface, _keepAliveInterval?: number) {}

    async connect(_port: number, targetHost: string, testServers = false): Promise<this> {
      if (!TELEGRAM_WEB_HOST.test(targetHost)) {
        throw new Error(`Telegram WSS отказался от неизвестного адреса: ${targetHost}`);
      }

      this.reset();
      const telegramPath = testServers ? "/apiws_test" : "/apiws";
      try {
        const direct = await openWebSocket(
          `wss://${targetHost}:443${telegramPath}`,
          undefined,
          4_500,
        );
        this.attach(direct);
        reportMode?.("direct_wss");
        return this;
      } catch {
        const endpoint = new URL(relayUrl);
        endpoint.searchParams.set("target", targetHost);
        endpoint.searchParams.set("test", testServers ? "1" : "0");
        const relay = await openWebSocket(
          endpoint.toString(),
          { authorization: `Bearer ${accessToken}` },
          10_000,
        );
        this.attach(relay);
        reportMode?.("server_relay");
        return this;
      }
    }

    async readExactly(number: number): Promise<Buffer> {
      if (!Number.isSafeInteger(number) || number < 0) throw new Error("Некорректный размер чтения WSS");
      const parts: Buffer[] = [];
      let remaining = number;
      while (remaining > 0) {
        const part = await this.read(remaining);
        parts.push(part);
        remaining -= part.length;
      }
      return parts.length === 1 ? parts[0] : Buffer.concat(parts);
    }

    async read(number: number): Promise<Buffer> {
      while (this.available === 0) {
        if (this.failure) throw this.failure;
        if (this.closed) throw new Error("Telegram WSS-соединение закрыто");
        await new Promise<void>((resolve) => {
          this.wakeReader = resolve;
        });
      }
      return this.consume(Math.min(number, this.available));
    }

    async readAll(): Promise<Buffer> {
      while (this.available === 0) {
        if (this.failure) throw this.failure;
        if (this.closed) throw new Error("Telegram WSS-соединение закрыто");
        await new Promise<void>((resolve) => {
          this.wakeReader = resolve;
        });
      }
      return this.consume(this.available);
    }

    write(data: Buffer): void {
      const socket = this.socket;
      if (!socket || this.closed || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Telegram WSS-соединение не готово");
      }
      socket.send(data, { binary: true });
    }

    async close(): Promise<void> {
      const socket = this.socket;
      this.socket = undefined;
      this.closed = true;
      this.wakeReader?.();
      this.wakeReader = undefined;
      if (!socket || socket.readyState === WebSocket.CLOSED) return;
      socket.close(1000);
      socket.terminate();
    }

    toString(): string {
      return "AutomaticTelegramWebSocket";
    }

    private reset(): void {
      this.socket?.terminate();
      this.socket = undefined;
      this.chunks = [];
      this.headOffset = 0;
      this.available = 0;
      this.closed = false;
      this.failure = undefined;
      this.wakeReader = undefined;
    }

    private attach(socket: WebSocket): void {
      this.socket = socket;
      this.closed = false;
      socket.on("message", (data: RawData, isBinary: boolean) => {
        if (!isBinary) {
          this.fail(new Error("Telegram WSS вернул текст вместо бинарного потока"));
          return;
        }
        const chunk = rawDataBuffer(data);
        if (this.available + chunk.length > MAX_BUFFERED_BYTES) {
          this.fail(new Error("Буфер Telegram WSS переполнен"));
          return;
        }
        this.chunks.push(chunk);
        this.available += chunk.length;
        this.wakeReader?.();
        this.wakeReader = undefined;
      });
      socket.on("error", (error) => this.fail(error));
      socket.on("close", () => this.fail(new Error("Telegram WSS-соединение закрыто")));
    }

    private fail(error: Error): void {
      if (this.failure) return;
      this.failure = error;
      this.closed = true;
      this.wakeReader?.();
      this.wakeReader = undefined;
    }

    private consume(number: number): Buffer {
      if (number <= 0) return Buffer.alloc(0);
      const head = this.chunks[0];
      if (head && head.length - this.headOffset >= number) {
        const output = head.subarray(this.headOffset, this.headOffset + number);
        this.headOffset += number;
        this.available -= number;
        if (this.headOffset === head.length) {
          this.chunks.shift();
          this.headOffset = 0;
        }
        return output;
      }

      const output = Buffer.allocUnsafe(number);
      let written = 0;
      while (written < number) {
        const chunk = this.chunks[0];
        const take = Math.min(chunk.length - this.headOffset, number - written);
        chunk.copy(output, written, this.headOffset, this.headOffset + take);
        written += take;
        this.headOffset += take;
        if (this.headOffset === chunk.length) {
          this.chunks.shift();
          this.headOffset = 0;
        }
      }
      this.available -= number;
      return output;
    }
  }

  return AutomaticTelegramWebSocket;
}

async function openWebSocket(
  url: string,
  headers: Record<string, string> | undefined,
  handshakeTimeout: number,
): Promise<WebSocket> {
  const socket = new WebSocket(url, "binary", {
    headers,
    handshakeTimeout,
    maxPayload: MAX_BUFFERED_BYTES,
    perMessageDeflate: false,
    followRedirects: false,
  });

  return new Promise<WebSocket>((resolve, reject) => {
    const opened = () => {
      cleanup();
      resolve(socket);
    };
    const failed = (error: Error) => {
      cleanup();
      socket.terminate();
      reject(error);
    };
    const closed = () => failed(new Error(`WSS-соединение ${url} закрылось во время подключения`));
    const cleanup = () => {
      socket.off("open", opened);
      socket.off("error", failed);
      socket.off("close", closed);
    };
    socket.once("open", opened);
    socket.once("error", failed);
    socket.once("close", closed);
  });
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}
