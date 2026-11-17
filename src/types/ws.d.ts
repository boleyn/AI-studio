declare module "ws" {
  import type { EventEmitter } from "node:events";
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;
    readonly bufferedAmount: number;
    send(data: string | Buffer, cb?: (err?: Error) => void): void;
    ping(): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options?: { noServer?: boolean; maxPayload?: number });
    handleUpgrade(
      req: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      cb: (ws: WebSocket) => void,
    ): void;
  }
}
