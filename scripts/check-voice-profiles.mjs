import assert from "node:assert/strict";
import { SpeechAdapter, voiceProfiles } from "../server/speech-adapter.js";

assert.equal(voiceProfiles.technical.gender, "Male");
assert.equal(voiceProfiles.portfolio.gender, "Female");
assert.equal(voiceProfiles.logic.gender, "Male");
assert.notEqual(voiceProfiles.technical.geminiVoice, voiceProfiles.logic.geminiVoice, "Two male professors still sound different");
assert.notEqual(voiceProfiles.technical.rate, voiceProfiles.logic.rate);

// Gemini TTS: each speaker gets its own voice and style; env overrides win.
const requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  requests.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ output_audio: { data: Buffer.from("RIFF....WAVE").toString("base64"), mime_type: "audio/wav" } }), { status: 200 });
};
try {
  const speech = new SpeechAdapter({ mode: "gemini", apiKey: "test-key", ttsModel: "gemini-3.8-flash-tts", voice: "Kore", speakerVoices: { logic: "voice_custom_logic" }, maxAudioBytes: 1e6 });
  for (const speakerId of ["technical", "portfolio", "logic", undefined]) await speech.synthesize("合成測試題目", { speakerId });
  const voices = requests.map((body) => body.generation_config.speech_config[0].voice);
  assert.deepEqual(voices, [voiceProfiles.technical.geminiVoice, voiceProfiles.portfolio.geminiVoice, "voice_custom_logic", "Kore"]);
  assert.equal(requests[1].input[0].content[0].annotations[0].style, voiceProfiles.portfolio.style);
  assert.equal(requests[0].input[0].content[0].text, "合成測試題目", "Style stays out of the spoken transcript");
  // Local recognition + Gemini voices: the default once a key is configured.
  requests.length = 0;
  const hybrid = new SpeechAdapter({ mode: "windows-sapi", ttsMode: "gemini", apiKey: "test-key", ttsModel: "gemini-3.8-flash-tts", voice: "Kore", maxAudioBytes: 1e6 });
  if (process.platform === "win32") {
    assert.equal(hybrid.status().processingLocation, "local", "Recordings stay local");
    assert.equal(hybrid.status().ttsLocation, "cloud");
    const audio = await hybrid.synthesize("合成測試題目", { speakerId: "portfolio" });
    assert.equal(audio.provider, "gemini");
    assert.equal(requests.length, 1);
  }
  const noKey = new SpeechAdapter({ mode: "windows-sapi", ttsMode: "gemini", apiKey: "", maxAudioBytes: 1e6 });
  assert.equal(noKey.usesGeminiTts, false, "Without a key the professors use local voices");

  if (process.platform === "win32") {
    // No model-processing consent: question text never goes to Google.
    requests.length = 0;
    const local = await hybrid.synthesize("你好，可以先簡單介紹一下自己嗎？", { speakerId: "technical", allowCloud: false });
    assert.notEqual(local.provider, "gemini");
    assert.equal(requests.length, 0);
    // Gemini failure falls back to the local voice instead of going silent.
    globalThis.fetch = async () => new Response("{}", { status: 503 });
    const fallback = await hybrid.synthesize("你好，可以先簡單介紹一下自己嗎？", { speakerId: "logic" });
    assert.equal(fallback.provider, "local-fallback");
    assert.equal(fallback.buffer.toString("ascii", 0, 4), "RIFF");
  }
} finally {
  globalThis.fetch = realFetch;
}

// Windows OneCore voices, when present: male professors use a male voice.
if (process.platform === "win32" && process.argv.includes("--local")) {
  const speech = new SpeechAdapter({ mode: "windows-sapi", maxAudioBytes: 8e6 });
  const sizes = {};
  for (const speakerId of ["technical", "portfolio", "logic"]) {
    const audio = await speech.synthesize("你好，可以先簡單介紹一下自己嗎？", { speakerId });
    assert.equal(audio.buffer.toString("ascii", 0, 4), "RIFF");
    sizes[speakerId] = audio.buffer.length;
  }
  assert.notEqual(sizes.technical, sizes.logic, "Different speaking rates produce different audio");
}

console.log("PASS: per-professor Gemini voice and style, env overrides, default voice fallback, Gemini TTS beside local recognition, consent gate and local fallback" + (process.argv.includes("--local") ? ", and local Windows voices" : ""));
