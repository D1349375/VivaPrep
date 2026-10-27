import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AgentError } from "./agent-provider.js";
import { structuredTextOutput, matchesSchemaShape } from "./structured-output.js";

export function currentQuestionOutput(response) {
  // Parse only text emitted for the current request, never the CLI's cached
  // structured_output. Scan balanced objects because the CLI can add fences.
  const text=String(response || "");
  const objects=[];
  let start=-1,depth=0,quoted=false,escaped=false;
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(start<0) {if(ch==="{"){start=i;depth=1;}continue;}
    if(quoted) {if(escaped)escaped=false;else if(ch==="\\")escaped=true;else if(ch==='"')quoted=false;continue;}
    if(ch==='"')quoted=true;else if(ch==="{")depth++;else if(ch==="}" && --depth===0) {
      try {const object=JSON.parse(text.slice(start,i+1));if(typeof object.candidateQuestion==="string" && typeof object.questionFocus==="string" && typeof object.dialogueAction==="string" && Array.isArray(object.sourceRefs))objects.push(object);}catch{}
      start=-1;
    }
  }
  return objects.at(-1) || null;
}

// One process per interview. User conversations never share a CLI history.
export class CliConversation {
  constructor({ cliPath, modelId, schema, cwd, timeoutMs, onClose, spawnProcess = spawn }) {
    this.closed = false;
    this.queue = [];
    this.current = null;
    this.timeoutMs = timeoutMs;
    this.schema = schema;
    this.isPortfolio = Boolean(schema?.properties?.claims);
    this.onClose = onClose;
    this.child = spawnProcess(cliPath, ["--print=", "--input-format", "stream-json", "--output-format", "stream-json", "--model", modelId, "--effort", "low", "--json-schema", JSON.stringify(schema), "--sandbox", "--disable-slash-commands"], { cwd, env: process.env, shell:false, windowsHide:true, stdio:["pipe","pipe","pipe"] });
    this.child.stderr.resume();
    this.child.stdin.on("error", () => this.close());
    this.child.once("error", () => this.close());
    this.child.once("close", () => this.close());
    createInterface({ input:this.child.stdout, crlfDelay:Infinity }).on("line", line => {
      if (line.length > 2_000_000) { this.close(); return; }
      let message; try { message=JSON.parse(line); } catch { return; }
      const step=message.step_update;
      if (this.current && message.event==="step_update" && step?.tool_name==="finish" && step.tool_info?.parameters) this.current.freshOutput=step.tool_info.parameters;
      if (message.event !== "result" || !this.current) return;
      const request = this.current;
      this.current = null;
      clearTimeout(request.timer);
      // Some CLI versions repeat a previous structured_output when a new turn
      // only prints prose. Accept a fresh finish or this turn's response JSON.
      const output=matchesSchemaShape(request.freshOutput, this.schema) ? request.freshOutput : structuredTextOutput(message.result?.response, this.schema);
      if (message.result?.status === "SUCCESS" && output) request.resolve(output);
      else request.reject(new AgentError(message.result?.status === "SUCCESS" ? "AGENT_INVALID_OUTPUT" : "AGENT_CALL_FAILED", message.result?.status === "SUCCESS" ? "Gemini 本次回覆格式不完整，請稍後重試。" : "Gemini 暫時無法完成要求，請稍後重試。"));
      this.#next();
    });
    this.idleTimer = setInterval(() => { if (!this.current && Date.now()-this.lastUsed>180000) this.close(); },30000);
    this.idleTimer.unref();
    this.lastUsed=Date.now();
  }

  generate(prompt) {
    if (this.closed) return Promise.reject(new AgentError("AGENT_UNAVAILABLE", "考官連線已結束，請重試。"));
    if (this.queue.length>=2) return Promise.reject(new AgentError("AGENT_BUSY", "考官正在處理回答，請稍候。",429));
    return new Promise((resolve,reject) => { this.queue.push({prompt,resolve,reject});this.#next(); });
  }

  #next() {
    if (this.closed || this.current || !this.queue.length) return;
    const request=this.queue.shift();this.current=request;this.lastUsed=Date.now();
    request.timer=setTimeout(() => this.close(new AgentError("AGENT_TIMEOUT", this.isPortfolio ? "Gemini 整理這份備審逾時，請重試未完成的文件。" : "考官回應逾時，請重試或換下一題。",504)),this.timeoutMs);
    this.child.stdin.write(JSON.stringify({event:"user",message:{role:"user",content:[{type:"text",text:request.prompt}]}})+"\n");
  }

  close(error=new AgentError("AGENT_UNAVAILABLE", "考官連線中斷，請重試。")) {
    if (this.closed) return;
    this.closed=true;clearInterval(this.idleTimer);
    for (const request of [this.current,...this.queue].filter(Boolean)) {clearTimeout(request.timer);request.reject(error);}
    this.current=null;this.queue=[];
    this.child.kill();
    if (process.platform==="win32" && this.child.pid) spawn("taskkill.exe",["/PID",String(this.child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"}).once("error",()=>{});
    this.onClose?.();
  }
}
