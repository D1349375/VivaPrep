import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";

// Minimal server side of RFC 6455 for the Live voice relay (and the fake Live
// server in the offline checks). Node ships a WebSocket client but no server,
// and the project has no dependency for one.
const handshakeGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function rejectUpgrade(socket, status, message) {
  const body = String(message || "");
  socket.end(`HTTP/1.1 ${status} ${status === 404 ? "Not Found" : status === 403 ? "Forbidden" : "Bad Request"}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

export function acceptWebSocket(request, socket, head, { maxPayload = 1024 * 1024 } = {}) {
  const key = request.headers["sec-websocket-key"];
  if (String(request.headers.upgrade || "").toLowerCase() !== "websocket" || !key) { rejectUpgrade(socket, 400, "WebSocket upgrade required"); return null; }
  const accept = createHash("sha1").update(key + handshakeGuid).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  return new ServerWebSocket(socket, head, { maxPayload });
}

export class ServerWebSocket extends EventEmitter {
  #socket;
  #buffer = Buffer.alloc(0);
  #fragments = [];
  #fragmentOpcode = 0;
  #maxPayload;

  constructor(socket, head, { maxPayload }) {
    super();
    this.#socket = socket;
    this.#maxPayload = maxPayload;
    this.readyState = 1;
    socket.on("data", (chunk) => this.#receive(chunk));
    socket.on("close", () => this.#finish(1006, ""));
    socket.on("error", () => this.#finish(1006, ""));
    if (head?.length) this.#receive(head);
  }

  send(data) {
    if (this.readyState !== 1) return false;
    const binary = typeof data !== "string";
    this.#write(binary ? 0x2 : 0x1, binary ? Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data) : Buffer.from(data, "utf8"));
    return true;
  }

  close(code = 1000, reason = "") {
    if (this.readyState !== 1) return;
    this.readyState = 2;
    const text = Buffer.from(String(reason).slice(0, 120), "utf8");
    const payload = Buffer.alloc(2 + text.length);
    payload.writeUInt16BE(code, 0);
    text.copy(payload, 2);
    this.#write(0x8, payload);
    this.#socket.end();
    this.#finish(code, String(reason));
  }

  terminate() { this.#socket.destroy(); this.#finish(1006, ""); }

  #finish(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit("close", code, reason);
  }

  #write(opcode, payload) {
    const length = payload.length;
    const header = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    if (length < 126) header[1] = length;
    else if (length < 65536) { header[1] = 126; header.writeUInt16BE(length, 2); }
    else { header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
    this.#socket.write(Buffer.concat([header, payload]));
  }

  #receive(chunk) {
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : chunk;
    while (this.readyState === 1 && this.#buffer.length >= 2) {
      const first = this.#buffer[0], second = this.#buffer[1];
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f, offset = 2;
      if (length === 126) { if (this.#buffer.length < 4) return; length = this.#buffer.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (this.#buffer.length < 10) return; length = Number(this.#buffer.readBigUInt64BE(2)); offset = 10; }
      // Browsers must mask client frames; an unmasked or oversized frame ends the connection.
      if (!masked) return this.close(1002, "unmasked frame");
      if (length > this.#maxPayload) return this.close(1009, "message too large");
      if (this.#buffer.length < offset + 4 + length) return;
      const mask = this.#buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(this.#buffer.subarray(offset + 4, offset + 4 + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index & 3];
      this.#buffer = this.#buffer.subarray(offset + 4 + length);
      this.#frame(first & 0x80, first & 0x0f, payload);
    }
  }

  #frame(fin, opcode, payload) {
    if (opcode === 0x8) {
      const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
      const reason = payload.subarray(2).toString("utf8");
      if (this.readyState === 1) { this.readyState = 2; this.#write(0x8, payload.subarray(0, 2)); this.#socket.end(); }
      this.#finish(code, reason);
      return;
    }
    if (opcode === 0x9) { this.#write(0xA, payload); return; }
    if (opcode === 0xA) return;
    if (opcode === 0x1 || opcode === 0x2) { this.#fragmentOpcode = opcode; this.#fragments = []; }
    else if (opcode !== 0x0 || !this.#fragmentOpcode) return this.close(1002, "unexpected frame");
    this.#fragments.push(payload);
    if (this.#fragments.reduce((sum, part) => sum + part.length, 0) > this.#maxPayload) return this.close(1009, "message too large");
    if (!fin) return;
    const data = Buffer.concat(this.#fragments);
    const binary = this.#fragmentOpcode === 0x2;
    this.#fragments = []; this.#fragmentOpcode = 0;
    this.emit("message", binary ? data : data.toString("utf8"), binary);
  }
}
