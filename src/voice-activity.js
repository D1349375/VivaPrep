// Speech start/end detection on microphone RMS levels.
// A fixed threshold mistook fan or room noise for speech, so the recording
// never ended. The noise floor here is the quietest level of the last few
// seconds (steady noise never dips, speech always has gaps), with separate
// start and continue thresholds so soft voices still register.

const FLOOR_WINDOW_MS = 4000;
const DEFAULT_FLOOR = 0.004;

export class VoiceActivityDetector {
  constructor({ startMs = 200, endSilenceMs = 1600, minStart = 0.02, minContinue = 0.014, startRatio = 3, continueRatio = 2 } = {}) {
    Object.assign(this, { startMs, endSilenceMs, minStart, minContinue, startRatio, continueRatio });
    this.history = [];
    this.noiseFloor = 0;
    this.smoothed = 0;
    this.reset();
  }

  // Per answer. The level history is kept, since the room does not change.
  reset() {
    this.aboveMs = 0;
    this.speaking = false;
    this.lastLoudAt = 0;
  }

  get startThreshold() { return Math.max(this.minStart, this.noiseFloor * this.startRatio); }
  get continueThreshold() { return Math.max(this.minContinue, this.noiseFloor * this.continueRatio); }

  // Feed one level reading on every animation frame, recording or not.
  // Returns "start" or "end" while listening for an answer, else null.
  update(rms, now, deltaMs, { listening = true } = {}) {
    const delta = Math.max(0, Math.min(100, deltaMs));
    if (!this.history.length) this.smoothed = rms;
    else this.smoothed += (rms - this.smoothed) * (1 - Math.exp(-delta / 80));
    this.history.push([now, this.smoothed]);
    while (this.history.length && now - this.history[0][0] > FLOOR_WINDOW_MS) this.history.shift();
    const quietest = this.history.reduce((min, [, level]) => Math.min(min, level), Infinity);
    // Until a second and a half of history exists, assume a quiet room.
    const floor = Math.min(0.05, now - this.history[0][0] < 1500 ? Math.min(DEFAULT_FLOOR, quietest) : quietest);
    // While someone speaks, keep the floor from before: four seconds of speech
    // without a gap would otherwise become the "noise" and end the answer mid-sentence.
    this.noiseFloor = this.speaking ? Math.min(this.noiseFloor, floor) : floor;
    if (!listening) { this.reset(); return null; }
    if (!this.speaking) {
      if (this.smoothed >= this.startThreshold) this.aboveMs += delta;
      else this.aboveMs = Math.max(0, this.aboveMs - delta * 2);
      if (this.aboveMs < this.startMs) return null;
      this.speaking = true;
      this.lastLoudAt = now;
      return "start";
    }
    if (this.smoothed >= this.continueThreshold) this.lastLoudAt = now;
    if (now - this.lastLoudAt < this.endSilenceMs) return null;
    this.reset();
    return "end";
  }
}
