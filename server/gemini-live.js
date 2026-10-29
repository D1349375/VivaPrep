// One WebSocket connection to the Gemini Live API. The API key stays on the
// server: the browser talks to the VivaPrep backend, which relays audio here.
export const liveEndpoint = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const reasonMessages = {
  timeout: "即時對談連線逾時",
  quota: "即時對談額度已用完",
  auth: "即時對談服務驗證失敗",
  disabled: "即時對談未啟用",
  unavailable: "即時對談服務暫時無法使用",
  disconnected: "即時對談連線中斷",
};

export class LiveError extends Error {
  constructor(reason, detail = "") {
    super(reasonMessages[reason] || reasonMessages.unavailable);
    this.name = "LiveError";
    this.reason = reason;
    this.code = "LIVE_" + String(reason).toUpperCase();
    // Close reasons can quote request details; keep only a short, key-free excerpt for logs.
    this.detail = String(detail || "").replace(/key=[^&\s]+/gi, "key=***").slice(0, 160);
  }
}

export function liveReasonMessage(reason) { return reasonMessages[reason] || reasonMessages.unavailable; }

// Observed: an invalid key closes with 1007 "API key not valid"; quota errors
// carry RESOURCE_EXHAUSTED or 429 in the close reason.
export function classifyLiveClose(code, reason) {
  const text = String(reason || "");
  if (/RESOURCE_EXHAUSTED|quota|429|rate.?limit|exceeded/i.test(text)) return "quota";
  if (/API key|PERMISSION_DENIED|UNAUTHENTICATED|unauthori[sz]ed|forbidden|401|403/i.test(text)) return "auth";
  return code === 1000 ? "disconnected" : "unavailable";
}

export class GeminiLiveConnection {
  #socket;
  #closedByUs = false;
  // Messages right after setupComplete (the resumption handle) can arrive in
  // the same tick, before the caller attaches handlers; they wait here.
  #pending = [];
  #messageHandler = null;
  #closeHandler = null;
  #closeError = null;

  get onmessage() { return this.#messageHandler; }
  set onmessage(handler) {
    this.#messageHandler = handler;
    while (handler && this.#pending.length) handler(this.#pending.shift());
  }
  get onclose() { return this.#closeHandler; }
  set onclose(handler) {
    this.#closeHandler = handler;
    if (handler && this.#closeError) handler(this.#closeError);
  }

  // Resolves once the server sends setupComplete; rejects with a LiveError.
  static open({ endpoint = liveEndpoint, apiKey, setup, timeoutMs = 5000, WebSocketImpl = globalThis.WebSocket }) {
    return new Promise((resolve, reject) => {
      if (!apiKey) { reject(new LiveError("disabled", "missing key")); return; }
      const connection = new GeminiLiveConnection();
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        connection.close();
        reject(error);
      };
      const timer = setTimeout(() => fail(new LiveError("timeout", `no setupComplete within ${timeoutMs} ms`)), timeoutMs);
      let socket;
      try { socket = new WebSocketImpl(endpoint, { headers: { "x-goog-api-key": apiKey } }); }
      catch (error) { fail(new LiveError("unavailable", error.message)); return; }
      connection.#socket = socket;
      socket.binaryType = "arraybuffer";
      socket.onopen = () => socket.send(JSON.stringify({ setup }));
      socket.onerror = () => {};
      socket.onmessage = (event) => {
        let message;
        try { message = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8")); }
        catch { return; }
        if (!settled) {
          if (!message.setupComplete) return;
          settled = true;
          clearTimeout(timer);
          resolve(connection);
          return;
        }
        if (connection.#messageHandler) connection.#messageHandler(message);
        else connection.#pending.push(message);
      };
      socket.onclose = (event) => {
        const reason = classifyLiveClose(event.code, event.reason);
        if (!settled) { fail(new LiveError(reason, `${event.code} ${event.reason || ""}`)); return; }
        if (connection.#closedByUs) return;
        connection.#closeError = new LiveError(reason, `${event.code} ${event.reason || ""}`);
        connection.#closeHandler?.(connection.#closeError);
      };
    });
  }

  get open() { return this.#socket?.readyState === 1 && !this.#closedByUs; }

  send(message) {
    if (!this.open) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
  }

  sendAudio(pcm16) {
    return this.send({ realtimeInput: { audio: { data: Buffer.from(pcm16).toString("base64"), mimeType: "audio/pcm;rate=16000" } } });
  }

  // Adds text to the model context; turnComplete=true asks the model to respond now.
  sendText(text, turnComplete) {
    return this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete } });
  }

  close() {
    this.#closedByUs = true;
    try { this.#socket?.close(1000, "done"); } catch { /* already closed */ }
  }
}
