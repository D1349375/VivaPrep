import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { AgentError } from "./agent-provider.js";

export class LocalWhisper {
  constructor({ pythonPath, modelPath }) {
    this.pythonPath = pythonPath;
    this.modelPath = modelPath;
    this.child = null;
    this.ready = null;
    this.pending = new Map();
    this.sequence = 0;
  }

  initialize() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, ["-u", fileURLToPath(new URL("./whisper-worker.py", import.meta.url)), this.modelPath], { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      this.child = child;
      let settled = false;
      const timer = setTimeout(() => fail(), 120000);
      const fail = () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new AgentError("LOCAL_SPEECH_UNAVAILABLE", "本機 Whisper 未能載入；請檢查語音模型安裝。")); }
        if (this.child !== child) return;
        this.child = null;
        this.ready = null;
        for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new AgentError("TRANSCRIPTION_FAILED", "語音辨識中斷，請重試或用文字回答。", 422)); }
        this.pending.clear();
        child.kill();
      };
      child.stdin.on("error", fail);
      child.stderr.resume(); // Never log recordings, transcript, or model context.
      child.once("error", fail);
      child.once("close", fail);
      const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
      lines.on("line", (line) => {
        if (line.length > 100000) { fail(); return; }
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.type === "ready") { settled = true; clearTimeout(timer); resolve(); return; }
        if (message.type === "startup_error") { fail(); return; }
        const request = this.pending.get(message.id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(message.id);
        if (message.error || !message.transcript?.trim()) { this.lastFailure=message.reason || "EMPTY_TRANSCRIPT"; request.reject(new AgentError("TRANSCRIPTION_FAILED", "沒有辨識到清楚的回答，請重試或用文字回答。", 422)); }
        else request.resolve(message.transcript);
      });
    });
    return this.ready;
  }

  async transcribe(buffer, context = {}) {
    await this.initialize();
    if (this.pending.size >= 4) throw new AgentError("SPEECH_BUSY", "語音辨識忙碌中，請稍候重試。", 429);
    const id = ++this.sequence;
    // Supply vocabulary only, rather than a sentence that STT might hallucinate.
    const text=(context.claims || []).join(" ") + " " + (context.question || "");
    const terms = text.match(/[A-Za-z][A-Za-z0-9+#._-]{1,30}/g) || [];
    const vocabulary = [...new Set([...terms,"程式","伺服器","資料庫","搜尋","專題","資工",...["模板注入","演算法","資安","驗證","備審"].filter(term=>text.includes(term))])].slice(0,20).join("、");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AgentError("LOCAL_SPEECH_TIMEOUT", "語音辨識逾時，請重試或用文字回答。", 504));
        this.close();
      }, 90000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, audio: buffer.toString("base64"), vocabulary }) + "\n");
    });
  }

  close() { this.child?.kill(); }
}
