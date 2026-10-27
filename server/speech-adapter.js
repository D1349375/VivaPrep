import { AgentError } from "./agent-provider.js";
import { spawn } from "node:child_process";
import { LocalWhisper } from "./local-whisper.js";

// One voice per professor so the panel is distinguishable by ear.
// Gemini prebuilt voices are chosen by their documented character; confirm
// gender and accent by listening, and override per speaker with
// GEMINI_TTS_VOICE_TECHNICAL / _PORTFOLIO / _LOGIC (see scripts/list-gemini-voices.mjs).
// Local voices are Windows OneCore zh-TW voices (Zhiwei male, Yating/Hanhan female).
export const voiceProfiles = {
  technical: { name: "林教授", gender: "Male", geminiVoice: "Charon", localVoices: ["Zhiwei"], rate: 0.9, pitch: "-6%",
    style: "資深大學教授在面試中提問：沉穩、清楚、語速適中，咬字精準，不誇張。" },
  portfolio: { name: "陳教授", gender: "Female", geminiVoice: "Sulafat", localVoices: ["Yating", "Hanhan"], rate: 0.95, pitch: "+0%",
    style: "大學教授在面試中提問：溫和、有耐心，語氣親切但專業，語速稍慢。" },
  logic: { name: "周教授", gender: "Male", geminiVoice: "Puck", localVoices: ["Zhiwei"], rate: 1.1, pitch: "+6%",
    style: "較年輕的大學教授在面試中追問：好奇、輕快，像自然對話一樣延伸問題。" },
};

export class SpeechAdapter {
  constructor({ mode, ttsMode = "local", apiKey, sttModel, ttsModel, voice, speakerVoices = {}, maxAudioBytes, powerShellPath = "powershell.exe", ffmpegPath = "ffmpeg.exe", pythonPath, whisperModelPath }) {
    this.mode = mode;
    this.ttsMode = ttsMode;
    this.apiKey = apiKey;
    this.sttModel = sttModel;
    this.ttsModel = ttsModel;
    this.voice = voice;
    this.speakerVoices = speakerVoices;
    this.maxAudioBytes = maxAudioBytes;
    this.powerShellPath = powerShellPath;
    this.ffmpegPath = ffmpegPath;
    this.whisper = mode === "whisper-local" ? new LocalWhisper({ pythonPath, modelPath: whisperModelPath }) : null;
  }

  async initialize() { if (this.whisper) await this.whisper.initialize(); }
  close() { this.whisper?.close(); }

  // Gemini TTS is used whenever a key is configured, also beside local recognition.
  get usesGeminiTts() { return Boolean(this.apiKey) && (this.mode === "gemini" || this.ttsMode === "gemini"); }

  status() {
    const localVoices = "Windows zh-TW voices (per professor)";
    const tts = this.usesGeminiTts
      ? { ttsModel: this.ttsModel, ttsLocation: "cloud", ttsFallback: process.platform === "win32" ? localVoices : null }
      : { ttsModel: localVoices, ttsLocation: "local", ttsFallback: null };
    if (this.whisper) return { available: true, provider: "whisper-local", sttModel: "Whisper small / CPU int8", ...tts, processingLocation: "local" };
    if (this.mode === "windows-sapi" && process.platform === "win32") {
      return {
        available: true,
        provider: "windows-sapi-local",
        sttModel: "Windows Speech Recognition (zh-TW)",
        ...tts,
        processingLocation: "local",
      };
    }
    return {
      available: this.mode === "gemini" && Boolean(this.apiKey),
      provider: this.mode === "gemini" ? "gemini" : "off",
      sttModel: this.mode === "gemini" ? this.sttModel : null,
      ...(this.mode === "gemini" ? tts : { ttsModel: null, ttsLocation: null, ttsFallback: null }),
      processingLocation: this.mode === "gemini" ? "cloud" : null,
    };
  }

  async transcribe(buffer, mimeType = "audio/webm", context = {}) {
    this.#assertAvailable();
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > this.maxAudioBytes) throw new AgentError("INVALID_AUDIO", "音訊檔案為空或超過大小限制。", 400);
    const supportedTypes = new Set(["audio/webm", "audio/wav", "audio/ogg", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/opus", "audio/flac", "audio/m4a"]);
    if (!supportedTypes.has(String(mimeType).toLowerCase())) throw new AgentError("INVALID_AUDIO", "不支援此錄音格式。", 400);
    if (this.whisper) {
      try { return await this.whisper.transcribe(buffer, context); }
      finally { buffer.fill(0); }
    }
    if (this.mode === "windows-sapi") return this.#transcribeLocally(buffer);
    const file = await this.#uploadAudio(buffer, mimeType);
    try {
      const response = await this.#interact({
        model: this.sttModel,
        input: [{ type: "audio", uri: file.uri, mime_type: mimeType }],
        generation_config: { transcription_config: { mode: "verbatim" } },
      });
      const transcript = response?.output_text
        || response?.outputs?.filter((item) => item?.type === "text").map((item) => item.text || "").join("").trim()
        || response?.steps?.flatMap((step) => step?.content || []).filter((item) => item?.type === "text").map((item) => item.text || "").join("").trim();
      if (!transcript) throw new AgentError("TRANSCRIPTION_FAILED", "語音辨識沒有取得文字，請改用文字輸入。", 422);
      return String(transcript).slice(0, 8000);
    } finally {
      await this.#deleteUploadedFile(file.name);
    }
  }

  voiceFor(speakerId) {
    const profile = voiceProfiles[speakerId];
    return {
      profile,
      geminiVoice: this.speakerVoices[speakerId] || profile?.geminiVoice || this.voice,
      style: profile?.style || "speaking naturally",
    };
  }

  // allowCloud=false keeps a session's text off Google when it has no model-processing consent.
  async synthesize(text, { speakerId, allowCloud = true } = {}) {
    this.#assertAvailable();
    const { profile, geminiVoice, style } = this.voiceFor(speakerId);
    const spoken = String(text).slice(0, 1200);
    const canSpeakLocally = process.platform === "win32";
    if (!this.usesGeminiTts || (!allowCloud && this.mode !== "gemini")) return this.#synthesizeLocally(spoken, profile);
    try {
      return { ...await this.#synthesizeWithGemini(spoken, geminiVoice, style), provider: "gemini" };
    } catch (error) {
      // A demo should keep talking when the network or quota fails.
      if (!canSpeakLocally) throw error;
      return { ...await this.#synthesizeLocally(spoken, profile), provider: "local-fallback", fallbackReason: error.code || "SYNTHESIS_FAILED" };
    }
  }

  async #synthesizeWithGemini(text, geminiVoice, style) {
    const response = await this.#interact({
      model: this.ttsModel,
      input: [{ type: "user_input", content: [{ type: "text", text, annotations: [{ type: "speech_metadata", style }] }] }],
      response_format: { type: "audio", mime_type: "audio/wav", sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: geminiVoice }] },
    });
    const audioContent = response?.steps?.flatMap((step) => step?.content || []).filter((item) => item?.type === "audio").at(-1);
    const encoded = response?.output_audio?.data || audioContent?.data;
    if (!encoded) throw new AgentError("SYNTHESIS_FAILED", "語音合成暫時無法使用。");
    return { buffer: Buffer.from(encoded, "base64"), mimeType: response?.output_audio?.mime_type || audioContent?.mime_type || "audio/wav" };
  }

  async #uploadAudio(buffer, mimeType) {
    const headers = {
      "x-goog-api-key": this.apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    };
    const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
      method: "POST",
      headers,
      body: JSON.stringify({ file: { display_name: "vivaprep-interview-audio" } }),
      signal: AbortSignal.timeout(60000),
    }).catch(() => { throw new AgentError("SPEECH_PROVIDER_FAILED", "Google 語音服務連線失敗。"); });
    if (!start.ok) throw new AgentError("SPEECH_PROVIDER_FAILED", "Google 語音服務無法接收錄音。");
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl) throw new AgentError("SPEECH_PROVIDER_FAILED", "Google 語音服務沒有提供上傳位置。");
    const uploaded = await fetch(uploadUrl, {
      method: "POST",
      headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "Content-Type": mimeType },
      body: buffer,
      signal: AbortSignal.timeout(60000),
    }).catch(() => { throw new AgentError("SPEECH_PROVIDER_FAILED", "錄音上傳未完成。"); });
    const result = await uploaded.json().catch(() => ({}));
    const file = result?.file || result;
    if (!uploaded.ok || !file?.uri || !file?.name) throw new AgentError("SPEECH_PROVIDER_FAILED", "Google 語音服務沒有完成錄音處理。");
    return { uri: file.uri, name: file.name };
  }

  async #deleteUploadedFile(name) {
    if (!name) return;
    await fetch("https://generativelanguage.googleapis.com/v1beta/" + name, {
      method: "DELETE",
      headers: { "x-goog-api-key": this.apiKey },
      signal: AbortSignal.timeout(15000),
    }).catch(() => {});
  }

  #assertAvailable() {
    if ((this.mode !== "gemini" || !this.apiKey) && this.mode !== "windows-sapi" && !this.whisper) throw new AgentError("SPEECH_UNAVAILABLE", "語音服務尚未設定；請改用文字輸入。");
  }

  async #synthesizeLocally(text, profile) {
    const request = { text, voices: profile?.localVoices || [], gender: profile?.gender || "", rate: profile?.rate || 1, pitch: profile?.pitch || "+0%" };
    const encodedRequest = Buffer.from(JSON.stringify(request), "utf8").toString("base64");
    // OneCore voices (WinRT) include a male zh-TW voice; desktop SAPI usually
    // only has Hanhan, so it stays as the fallback.
    const script = `
$ErrorActionPreference = 'Stop'
$request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())) | ConvertFrom-Json
$text = [string]$request.text
function Speak-OneCore {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media.SpeechSynthesis,ContentType=WindowsRuntime] | Out-Null
  [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
  function Await($operation, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); try { $task.Wait(-1) | Out-Null } catch { throw $task.Exception.InnerException }; $task.Result }
  $voices = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -eq 'zh-TW' })
  if ($voices.Count -eq 0) { throw 'No zh-TW OneCore voice.' }
  $voice = $null
  foreach ($name in @($request.voices)) { if (-not $voice) { $voice = $voices | Where-Object { $_.DisplayName -like "*$name*" } | Select-Object -First 1 } }
  if (-not $voice -and $request.gender) { $voice = $voices | Where-Object { [string]$_.Gender -eq $request.gender } | Select-Object -First 1 }
  if (-not $voice) { $voice = $voices[0] }
  $synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  try {
    $synth.Voice = $voice
    $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-TW'><prosody rate='" + [double]$request.rate + "' pitch='" + [string]$request.pitch + "'>" + [Security.SecurityElement]::Escape($text) + "</prosody></speak>"
    $stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $size = [UInt32]$stream.Size
    Await ($reader.LoadAsync($size)) ([UInt32]) | Out-Null
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    return ,$bytes
  } finally { $synth.Dispose() }
}
function Speak-Desktop {
  Add-Type -AssemblyName System.Speech
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $stream = New-Object System.IO.MemoryStream
  try {
    $voice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'zh-TW' } | Select-Object -First 1
    if ($null -eq $voice) { throw 'No enabled zh-TW SAPI voice.' }
    $synth.SelectVoice($voice.VoiceInfo.Name)
    $synth.SetOutputToWaveStream($stream)
    $synth.Speak($text)
    return ,$stream.ToArray()
  } finally { $stream.Dispose(); $synth.Dispose() }
}
try { $audio = Speak-OneCore } catch { $audio = Speak-Desktop }
[Console]::Out.Write([Convert]::ToBase64String($audio))
`;
    const output = await this.#runProcess(this.powerShellPath, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], Buffer.from(encodedRequest, "ascii"), 8 * 1024 * 1024);
    const audio = Buffer.from(output.toString("ascii").trim(), "base64");
    if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
      throw new AgentError("SYNTHESIS_FAILED", "本機繁體中文語音合成沒有產生有效音訊。");
    }
    return { buffer: audio, mimeType: "audio/wav" };
  }

  async #transcribeLocally(buffer) {
    let wav;
    try {
      wav = await this.#runProcess(this.ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1",
      ], buffer, this.maxAudioBytes * 4);
      const recognitionTimeoutSeconds = this.#fixStreamingWaveHeader(wav);
      const script = `
Add-Type -AssemblyName System.Speech
$wave = New-Object System.IO.MemoryStream
[Console]::OpenStandardInput().CopyTo($wave)
$wave.Position = 0
$engine = $null
try {
  $recognizer = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'zh-TW' } | Select-Object -First 1
  if ($null -eq $recognizer) { throw 'No installed zh-TW speech recognizer.' }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine($recognizer)
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $engine.SetInputToWaveStream($wave)
  $recognitionHelper = @'
using System;
using System.Collections.Generic;
using System.Speech.Recognition;
using System.Threading;
public static class VivaPrepSpeechCapture {
  public static string Run(SpeechRecognitionEngine engine, int timeoutSeconds) {
    var results = new List<string>();
    var gate = new object();
    Exception failure = null;
    using (var completed = new ManualResetEvent(false)) {
      EventHandler<SpeechRecognizedEventArgs> onRecognized = (sender, args) => {
        var text = args.Result == null ? null : args.Result.Text;
        if (!String.IsNullOrWhiteSpace(text)) lock (gate) results.Add(text.Trim());
      };
      EventHandler<RecognizeCompletedEventArgs> onCompleted = (sender, args) => {
        failure = args.Error;
        completed.Set();
      };
      engine.SpeechRecognized += onRecognized;
      engine.RecognizeCompleted += onCompleted;
      try {
        engine.RecognizeAsync(RecognizeMode.Multiple);
        if (!completed.WaitOne(TimeSpan.FromSeconds(timeoutSeconds))) {
          engine.RecognizeAsyncStop();
          if (!completed.WaitOne(TimeSpan.FromSeconds(5))) throw new TimeoutException("Recognition did not stop cleanly.");
        }
      } finally {
        engine.SpeechRecognized -= onRecognized;
        engine.RecognizeCompleted -= onCompleted;
      }
    }
    if (failure != null) throw new InvalidOperationException(failure.Message, failure);
    lock (gate) return String.Join(" ", results);
  }
}
'@
  $speechAssembly = [System.Speech.Recognition.SpeechRecognitionEngine].Assembly.Location
  $null = Add-Type -TypeDefinition $recognitionHelper -Language CSharp -ReferencedAssemblies $speechAssembly
  $transcript = [VivaPrepSpeechCapture]::Run($engine, ${recognitionTimeoutSeconds}).Trim()
  if ([string]::IsNullOrWhiteSpace($transcript)) { [Console]::Out.Write('') }
  else { [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($transcript))) }
} finally { if ($null -ne $completed) { $completed.Dispose() }; if ($null -ne $engine) { $engine.Dispose() }; $wave.Dispose() }
`;
      const encoded = await this.#runProcess(this.powerShellPath, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], wav, 256 * 1024, Math.max(60000, (recognitionTimeoutSeconds + 12) * 1000));
      const transcript = Buffer.from(encoded.toString("ascii").trim(), "base64").toString("utf8").trim();
      if (!transcript) throw new AgentError("TRANSCRIPTION_FAILED", "本機語音辨識沒有取得文字，請重錄或改用文字輸入。", 422);
      return transcript.slice(0, 8000);
    } catch (error) {
      if (error instanceof AgentError) throw error;
      throw new AgentError("TRANSCRIPTION_FAILED", "本機繁體中文語音辨識暫時無法處理這段錄音，請改用文字輸入。", 422);
    } finally {
      buffer.fill(0);
      wav?.fill(0);
    }
  }

  #fixStreamingWaveHeader(wav) {
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
      throw new AgentError("INVALID_AUDIO", "錄音轉換後的 WAV 格式無效。", 400);
    }
    wav.writeUInt32LE(wav.length - 8, 4);
    let offset = 12;
    while (offset + 8 <= wav.length) {
      const chunkType = wav.toString("ascii", offset, offset + 4);
      let chunkSize = wav.readUInt32LE(offset + 4);
      if (chunkSize === 0xffffffff) {
        if (chunkType !== "data") throw new AgentError("INVALID_AUDIO", "錄音 WAV 中有不支援的串流區塊。", 400);
        chunkSize = wav.length - offset - 8;
        wav.writeUInt32LE(chunkSize, offset + 4);
      }
      if (chunkType === "data") {
        const bytesPerSecond = wav.readUInt32LE(28);
        if (!bytesPerSecond) throw new AgentError("INVALID_AUDIO", "錄音 WAV 缺少有效取樣資訊。", 400);
        return Math.min(300, Math.max(12, Math.ceil(chunkSize / bytesPerSecond) + 3));
      }
      offset += 8 + chunkSize + (chunkSize & 1);
    }
    throw new AgentError("INVALID_AUDIO", "錄音 WAV 缺少音訊資料區塊。", 400);
  }

  #runProcess(command, args, input, maxOutputBytes, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      } catch {
        reject(new AgentError("LOCAL_SPEECH_UNAVAILABLE", "本機語音引擎目前無法啟動。"));
        return;
      }
      const output = [];
      let outputBytes = 0;
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new AgentError("LOCAL_SPEECH_TIMEOUT", "本機語音處理逾時，請稍候重試。"));
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          child.kill();
          return;
        }
        output.push(chunk);
      });
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-4000); });
      child.once("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new AgentError("LOCAL_SPEECH_UNAVAILABLE", "本機語音引擎目前無法啟動。"));
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0 || outputBytes > maxOutputBytes) {
          const reason = stderr.toLowerCase();
          if (reason.includes("no enabled zh-tw") || reason.includes("no installed zh-tw")) {
            reject(new AgentError("LOCAL_SPEECH_UNAVAILABLE", "這台電腦尚未安裝可用的繁體中文語音元件。"));
          } else reject(new AgentError("LOCAL_SPEECH_FAILED", "本機語音引擎暫時無法完成處理。"));
          return;
        }
        resolve(Buffer.concat(output));
      });
      child.stdin.once("error", () => {});
      child.stdin.end(input);
    });
  }

  async #interact(payload) {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    }).catch(() => { throw new AgentError("SPEECH_PROVIDER_FAILED", "Google 語音服務連線失敗。"); });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new AgentError("SPEECH_PROVIDER_FAILED", "Google 語音服務暫時無法完成要求。");
    return data;
  }
}
