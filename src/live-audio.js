// Browser end of the Gemini Live warm-up: microphone PCM goes to the VivaPrep
// backend over a WebSocket, professor audio (24 kHz PCM) comes back and is
// scheduled on an AudioContext. Web Audio keeps playing in a background tab,
// unlike <audio> elements whose loading Chrome defers while the page is hidden.

const OUTPUT_RATE = 24000;
// While the professor speaks, only a clearly louder voice (barge-in) is sent,
// so speaker echo does not reach Live's turn detection.
export const BARGE_IN_RMS = 0.06;
const ECHO_TAIL_MS = 250;

export function gateChunk({ playing, bargeIn, rms }) {
  if (!playing || bargeIn) return { send: true, bargeIn: playing && bargeIn };
  return rms >= BARGE_IN_RMS ? { send: true, bargeIn: true } : { send: false, bargeIn: false };
}

export class LiveAudioLink {
  constructor({ url, stream, onMessage, onClose, onPlaybackStart, onPlaybackIdle, onChunk, now = () => Date.now() }) {
    Object.assign(this, { url, stream, onMessage, onClose, onPlaybackStart, onPlaybackIdle, onChunk, now });
    this.socket = null;
    this.captureContext = null;
    this.playbackContext = null;
    this.sources = new Set();
    this.nextStartTime = 0;
    this.lastPlaybackEndAt = 0;
    this.bargeIn = false;
    this.closed = false;
  }

  async start() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass || !window.AudioWorkletNode || !window.WebSocket) throw new Error("此瀏覽器不支援即時對談。");
    this.playbackContext = new AudioContextClass({ sampleRate: OUTPUT_RATE });
    this.captureContext = new AudioContextClass({ sampleRate: 16000 });
    await Promise.all([this.playbackContext.resume(), this.captureContext.resume()]);
    await this.captureContext.audioWorklet.addModule("/src/live-capture-worklet.js");
    if (this.closed) return;
    const tracks = this.stream?.getAudioTracks().filter((track) => track.readyState === "live") || [];
    if (!tracks.length) throw new Error("麥克風尚未連接。");
    this.captureNode = new AudioWorkletNode(this.captureContext, "live-capture");
    this.captureSource = this.captureContext.createMediaStreamSource(new MediaStream(tracks));
    this.captureSource.connect(this.captureNode);
    this.captureNode.port.onmessage = ({ data }) => this.#captured(data);
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.binaryType = "arraybuffer";
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("即時對談連線失敗。"));
      socket.onmessage = (event) => {
        if (typeof event.data === "string") { try { this.onMessage?.(JSON.parse(event.data)); } catch { /* Ignore malformed messages. */ } }
        else this.#play(event.data);
      };
      socket.onclose = (event) => { this.socket = null; reject(new Error("即時對談連線失敗。")); if (!this.closed) this.onClose?.(event); };
    });
  }

  // For microphone gating: includes the echo tail right after playback.
  get playing() { return this.sources.size > 0 || this.now() - this.lastPlaybackEndAt < ECHO_TAIL_MS; }
  // For the interview state: only audio still queued. onPlaybackIdle fires when it drains.
  get audioQueued() { return this.sources.size > 0; }

  remainingPlaybackMs() {
    if (!this.playbackContext || !this.sources.size) return 0;
    return Math.max(0, (this.nextStartTime - this.playbackContext.currentTime) * 1000);
  }

  send(message) {
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  #captured({ pcm, rms }) {
    const now = this.now();
    this.onChunk?.(rms, now, this.playing);
    if (this.socket?.readyState !== 1) return;
    const gate = gateChunk({ playing: this.playing, bargeIn: this.bargeIn, rms });
    this.bargeIn = gate.bargeIn;
    if (gate.send) this.socket.send(pcm);
  }

  #play(arrayBuffer) {
    const context = this.playbackContext;
    if (!context || this.closed) return;
    const samples = new Int16Array(arrayBuffer);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) channel[index] = samples[index] / 0x8000;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const idle = this.sources.size === 0;
    // A short lead absorbs network jitter between chunks without adding noticeable delay.
    const startAt = Math.max(context.currentTime + (idle ? 0.03 : 0), this.nextStartTime);
    this.nextStartTime = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size) return;
      this.lastPlaybackEndAt = this.now();
      this.bargeIn = false;
      this.onPlaybackIdle?.();
    };
    source.start(startAt);
    if (idle) this.onPlaybackStart?.(this.now() + (startAt - context.currentTime) * 1000);
  }

  // Barge-in: Live discarded the rest of its answer, so drop what is queued.
  flush() {
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* not started */ } }
    this.sources.clear();
    this.nextStartTime = 0;
    this.lastPlaybackEndAt = this.now();
    this.bargeIn = false;
    this.onPlaybackIdle?.();
  }

  // drain: let an already received farewell finish before releasing audio.
  close({ drain = false } = {}) {
    if (this.closed) return;
    this.closed = true;
    try { this.socket?.close(1000, "done"); } catch { /* already closed */ }
    this.socket = null;
    try { this.captureSource?.disconnect(); this.captureNode?.disconnect(); } catch { /* already disconnected */ }
    if (this.captureNode) this.captureNode.port.onmessage = null;
    this.captureContext?.close().catch(() => {});
    const release = () => this.playbackContext?.close().catch(() => {});
    if (drain && this.sources.size) setTimeout(release, this.remainingPlaybackMs() + 300);
    else { for (const source of this.sources) { source.onended = null; try { source.stop(); } catch { /* not started */ } } this.sources.clear(); release(); }
  }
}
