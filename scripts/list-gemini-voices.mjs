// Lists Gemini Extended Voice Library candidates for the three professors.
// Usage: GEMINI_API_KEY=... node scripts/list-gemini-voices.mjs
// Then set GEMINI_TTS_VOICE_TECHNICAL / _PORTFOLIO / _LOGIC to the chosen voice id.
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("請先設定 GEMINI_API_KEY。");
  process.exit(1);
}

async function list(params) {
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/voices");
  for (const [key, value] of Object.entries({ page_size: 50, ...params })) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: { "x-goog-api-key": apiKey } });
  if (!response.ok) return { error: `${response.status} ${await response.text().catch(() => "")}`.slice(0, 300) };
  return response.json();
}

for (const languageCode of ["cmn-TW", "zh-TW", "cmn-CN"]) {
  for (const gender of ["male", "female"]) {
    const result = await list({ language_code: languageCode, gender });
    const voices = result.voices || [];
    console.log(`\n== ${languageCode} / ${gender}: ${result.error || `${voices.length} voices`}`);
    for (const voice of voices) console.log([voice.id || voice.name, voice.display_name || voice.displayName, voice.accent, voice.pitch, voice.description].filter(Boolean).join(" | "));
  }
}
