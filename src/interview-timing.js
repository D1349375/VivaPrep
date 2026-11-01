// Response time starts at the end of actual playback, never at question creation.
export class InterviewTiming {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.phase = "idle";
    this.sequence = null;
    this.lastActivityAt = 0;
    this.waitMs = 8000;
  }

  question(event, expectsAudio) {
    this.sequence = event.seq;
    this.waitMs = event.phase === "follow_up" ? 12000 : 8000;
    this.phase = expectsAudio ? "preparing" : "listening";
    this.lastActivityAt = expectsAudio ? 0 : this.now();
  }

  speaking(sequence) {
    if (sequence !== this.sequence) return false;
    this.phase = "speaking";
    this.lastActivityAt = 0;
    return true;
  }

  listen(sequence = this.sequence) {
    if (sequence !== this.sequence) return false;
    this.phase = "listening";
    this.lastActivityAt = this.now();
    return true;
  }

  activity() { this.lastActivityAt = this.now(); }
  pause(phase) { this.phase = phase; }

  countsTowardPractice() { return ["speaking", "listening", "capturing"].includes(this.phase); }

  remainingMs({ unavailable = false, draft = "" } = {}) {
    if (this.phase !== "listening" || unavailable || draft.trim()) return null;
    return Math.max(0, this.waitMs - (this.now() - this.lastActivityAt));
  }
}
