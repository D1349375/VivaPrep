// Turns microphone samples into 16 kHz, 16-bit PCM chunks of 100 ms for Gemini Live.
const TARGET_RATE = 16000;
const CHUNK_SAMPLES = 1600;

class LiveCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE;
    this.position = 0;
    this.chunk = new Int16Array(CHUNK_SAMPLES);
    this.filled = 0;
    this.energy = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    // Linear interpolation covers contexts that do not run at 16 kHz.
    for (; this.position < channel.length; this.position += this.step) {
      const index = Math.floor(this.position);
      const next = channel[Math.min(index + 1, channel.length - 1)];
      const value = channel[index] + (next - channel[index]) * (this.position - index);
      const clipped = Math.max(-1, Math.min(1, value));
      this.chunk[this.filled++] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
      this.energy += clipped * clipped;
      if (this.filled === CHUNK_SAMPLES) {
        const pcm = this.chunk.buffer.slice(0);
        this.port.postMessage({ pcm, rms: Math.sqrt(this.energy / CHUNK_SAMPLES) }, [pcm]);
        this.filled = 0;
        this.energy = 0;
      }
    }
    this.position -= channel.length;
    return true;
  }
}

registerProcessor("live-capture", LiveCaptureProcessor);
