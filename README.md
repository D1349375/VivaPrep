# VivaPrep

面向大學個人申請的模擬面試與復盤系統。前端透過 REST API 與 SSE 連接教授 Agent、來源檢索、帳號/隱私服務、匿名心得治理和語音 adapter。

## 啟動

需要 Node.js 22.13 或更新版本（使用 Node 內建 `node:sqlite`；此 API 目前仍是實驗／候選穩定狀態）。

```powershell
npm install
npm run dev
```

瀏覽器開啟 `http://localhost:4173`。預設使用本機 mock Agent，不需要 API 金鑰。SQLite 檔案預設位於 `.data/vivaprep.sqlite`，此目錄已加入 `.gitignore`；可用 `VIVAPREP_DATABASE_PATH` 指定其他檔案路徑。

本機資料庫採正規化 SQLite schema（migration version 3），帳號聯絡資料、顯示名稱、MFA secret、進行中場次和個人練習本文使用應用層 AES-256-GCM 加密；密碼採 scrypt，session/action/撤回/MFA 復原 token 只保存雜湊。`.data/application.key` 是本機開發金鑰，與資料庫一樣不得提交版本控制。

訪客不必登入即可練習或匿名分享。登入者可在資料使用設定選擇是否保存之後的練習到私人歷史；分享心得仍是獨立資料，不含帳號或場次外鍵，獨立同意、預覽、人工審核與一次性撤回碼。新分享稿依目前本機政策保存 90 天，撤回會立即停止檢索並清除內容；未保存場次依預設一小時 TTL 清除；保存歷史預設保留 24 個月，可逐筆刪除或匯出；帳號刪除先進入 30 天取消期，期滿清除帳號和私人歷史。

目前執行期資料庫是本機單一服務 SQLite；尚未接上 PostgreSQL/pgvector、跨主機 session、分散式 rate limiter 或雲端工作佇列。因此這版可供本機功能檢視，不代表多實例正式部署已完成。正式環境需配置獨立密鑰、正式郵件 provider、TLS、備份/還原和 PostgreSQL runtime adapter。

## Gemini 教授 Agent 與備審 PDF

預設仍使用不呼叫外部服務的本機 mock。現在先用已登入的 Antigravity CLI，不需 Gemini API key，即可讓 Gemini 參與開場題、逐題追問、停頓接話、面試復盤和備審文字整理：

```powershell
npm run dev:agent
```

需先安裝並登入 Antigravity CLI。CLI 模式解析備審時，PDF 只送到 VivaPrep 後端；伺服器以 PDF.js 在記憶體抽取各頁文字，再把文字分段交給 CLI。原始 PDF 不會交給模型或寫入資料庫。這是文字整理流程，掃描影像、圖表和版面不會做 OCR／視覺解析；沒有可擷取文字的 PDF 需要先做 OCR 或手動輸入主張。文件限制為 8 MB、100 頁及 84,000 個可擷取字元，學生需在資料使用設定允許 PDF 與 Agent 處理，並按下整理後才會解析。頁碼與原文摘錄會回傳供學生核對。

獨立的「備審資料庫」可一次選取或拖放最多五份 PDF，每份 8 MB、合計 24 MB。檔案依序解析，每份最多八個候選主張；成功結果保留檔名、文件 ID、頁碼與摘錄，失敗時只重試未完成的檔案。成功後釋放原檔參照，移除文件會一併移除其主張。面試準備頁只勾選已整理的文件，不重新上傳或分析；最多使用 40 個主張，超過時要求精簡。

在設定開啟「在此瀏覽器保存備審資料庫」後，檔名、人工修改後的主張、頁碼與短摘錄會保存在 IndexedDB，訪客與各帳號分開；不保存 PDF、登入憑證或面試回答，不同步其他裝置。關閉這項設定會刪除保存內容；單份文件或主張也可刪除。未啟用時關閉／重新整理頁面後需重新匯入；尚未完成整理的 PDF 不保存。內容 SHA-256 與解析版本只在瀏覽器內用於重複檔案判斷，不會傳給模型。

PDF 主張改為跨校系的中性經驗整理；校系相關性由面試 Agent 判斷。CLI 整理使用 Flash low 與精簡輸出，同一份文件的分段、同一批文件共用獨立連線；批次依訪客／帳號隔離，完成後釋放，意外中斷時三分鐘閒置清理。只接納當次新的 finish／response JSON，不使用可能過期的 structured_output；能讀取完整的 fenced JSON，截斷輸出仍拒絕。格式或全部摘錄無法核對時只重試該段一次；各段摘錄僅能引用當前文件的當段文字。備審回覆上限 45 秒，面試現場仍為 25 秒。回傳 elapsedMs、chunkCount、retries 與 parserVersion；頁面顯示每份耗時。

開場先選一個談話角度及備審經驗，再由 Gemini 生成問題。同一訪客／帳號與校系在三十分鐘內不連續使用相同開場角度；開場可選約一分鐘簡單自介，也可從興趣、學習經驗或好奇的問題切入。開場角度與角色動作種子分開，不依賴模型隨機性保證換題。

設備頁分開檢查麥克風與選用鏡頭，顯示輸入裝置選單及本機音量表。開始語音場次時會確認有效音訊軌；找不到麥克風時提示原因並留在設備頁。面試中可切換輸入裝置，也可從文字場次在已同意處理後啟用語音。設備試測不錄製或傳送聲音；正式回答依本場語音同意由後端處理。

進入決賽、準備切換到 Gemini API 時，再設定：

```powershell
$env:VIVAPREP_AGENT_MODE = "gemini-api"
$env:GEMINI_API_KEY = "你的 Google AI Studio API key"
$env:GEMINI_MODEL = "gemini-3.8-flash"
npm run dev
```

也可設 `VIVAPREP_AGENT_MODE=gemini`。API key 只放在伺服器環境，不會送到瀏覽器；沒有設定時不會靜默改用 mock。Agent、語音、PDF、備審主張、鏡頭及歷史保存授權集中到資料使用設定。選擇儲存在這個瀏覽器，訪客與各帳號分開；每場開始顯示沿用選擇並送出同意快照。模型接入方式或語音處理服務／位置變更後重新選擇。未授權功能顯示限制；未授權語音可改用文字。

切換 API 模式後，備審資料庫會在學生已於設定允許 PDF 與 Agent 處理並按下整理後，將每份 PDF 以單次 inline 文件請求交給 Gemini API，保留原生 PDF 理解路徑；不使用 Gemini Files API，也不把原始檔存入本機資料庫。API 與 CLI 兩種模式每份 PDF 都會回傳最多八則附頁碼與摘錄的候選主張；學生可修改，開始前請核對；設定允許使用主張時會使用當時編輯與勾選的內容。頁碼／摘錄只是回查提示，不代表內容已被查證。非 PDF 格式可直接手動新增主張。

此 provider 使用 Gemini Interactions API 的結構化輸出與新版 `steps` 回應格式；文字與 PDF 請求設為不保存 interaction。參考：[Interactions API 遷移說明](https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026)、[PDF inline 輸入方法](https://ai.google.dev/gemini-api/docs/file-input-methods)。

Antigravity CLI provider 仍可選用：

先登入 Antigravity CLI，再設定：

```powershell
$env:VIVAPREP_AGENT_MODE = "cli"
$env:ANTIGRAVITY_MODEL = "gemini-3.8-flash-medium"
npm run dev
```

若 CLI 不在 PATH，可用 `ANTIGRAVITY_CLI_PATH` 指定執行檔。CLI 模式不會靜默退回 mock；找不到 CLI、模型不可用或呼叫失敗時會顯示錯誤。使用者需在資料使用設定允許模型處理，才會建立外部模型場次。Antigravity headless 即時對話採場次隔離的 CLI conversation、精簡問題 schema、暫存工作目錄和 sandbox；結束時釋放場次。模型 slug 需以已安裝 CLI 的 `agy models` 清單確認。

Windows 本機已安裝 Antigravity CLI 時，可用 `npm run dev:agent` 啟動目前免 API key 的 CLI 模式；一般 `npm run dev` 仍使用本機示範模式。Gemini API 和 CLI 都會在建立面試時要求模型處理同意。

## 面試節奏與收尾（2026-09-29）

練習時間可選 3／5／8 分鐘，預設 5 分鐘（逢甲資工 115 官方面試為 5 分鐘）。後端接收前端的有效練習秒數，並把剩餘時間及階段交給教授 Agent。最後 15% 時間（至少 40 秒、上限 90 秒）只留一個短問題；回答後直接致謝，剩 20 秒不再產生新題。時間到或手動結束先停止問題生成、保留最後錄音或文字，再顯示／播放收尾，之後進復盤。收尾不是新題；模型等待、辨識等待與準備語音仍不計入練習倒數，遲到問題與舊題音訊不會蓋過收尾。

流程與提問目的已加入受信任教授提示：可邀請一分鐘自介，從學生回答找追問線索，釐清貢獻、概念、驗證、學習動機與反思，並依時間取捨。這是質性調研後的模擬設計，不宣稱固定官方題序或問法頻率。逢甲 APCS 的 115 官方指引已補入既有情境；五個目標校系的證據與資料缺口見 [面試流程與教授提問調研](VivaPrep_面試流程與教授提問調研.md)。

每題屬於一條話題線（同一段經驗或同一個面向）。同一條線的追問上限由後端控制：3 分鐘場次 1 次、5／8 分鐘 2 次；到上限就強制換到另一段經驗或尚未談過的面向，並用一句自然轉場。學生已說清楚或表示不知道時，教授也可提早換題。自介之後的下一題視為新話題。

匿名保護：備審主張、PDF 摘錄與檔名、學生回答在送給教授與復盤 Agent 前，會把疑似高中／國中校名換成「［學校名稱］」；學生自己的逐字稿保持原文。教授產生的題目若提及、猜測或詢問就讀學校、住處、姓名，會被攔下重新生成，兩次都失敗就改用固定的安全題。回答提到校名時，面試中會提醒「正式面試通常不宜透露就讀學校」，復盤也會註記。校名偵測是規則比對，可能漏掉罕見簡稱或誤遮一般詞；語音模式下，Gemini 語音辨識仍會收到原始音訊。

檢查入口：`node scripts/check-topic-threads.mjs`、`node scripts/check-interview-closing.mjs`、`node scripts/check-input-workflows.mjs`、`node scripts/check-voice-ui.mjs`、`node scripts/check-streaming-recognition.mjs`、`node scripts/check-gemini-live-voice.mjs`（假 Live 伺服器：成功對談、連不上、逾時、429、斷線接續、遲到訊息、匿名）、`node scripts/check-gemini-live-ui.mjs`。真實模型檢查 `node scripts/check-live-closing.mjs` 使用合成文字，涵蓋最後一題、致謝語音與復盤，不開實體麥克風。

## 語音 adapter

### Gemini Live 即時對談（暖身對談，2026-10-28）

「暖身對談」（只有陳教授一位考官）在語音情境下優先使用 Gemini Live API 即時對答：學生說完約 1.2～1.6 秒教授就開口，題目與語音由 Live 直接產生，不經過回合制的辨識 → 教授 Agent → TTS（約 1.6 + 3.5 + 6 秒）。其他考官組合與文字情境維持回合制。

```text
VIVAPREP_LIVE_VOICE=auto                # auto＝可用就用 Live；off＝一律回合制
GEMINI_LIVE_VOICE_MODEL=gemini-3.8-live
GEMINI_LIVE_API_KEY=                    # 留空＝沿用 GEMINI_API_KEY
```

`ANTIGRAVITY_LIVE_MODEL` 是 CLI 出題用的快速模型，和這裡的 Gemini Live 無關。

- **連線方式：後端代理。**瀏覽器以 WebSocket（`/api/sessions/:id/live?ticket=…`）把麥克風 16 kHz PCM 送到 VivaPrep 後端，後端用伺服器上的 key（`x-goog-api-key` 標頭，不放 URL）連 `BidiGenerateContent`，再把 24 kHz PCM 教授語音回傳給瀏覽器以 Web Audio 播放。選代理而不是臨時權杖讓瀏覽器直連，是因為 key 與系統指示都不會到瀏覽器，後端也能直接讀雙方逐字稿寫入 turns、做匿名檢查並在斷線時接手；代價是多一跳，部署在同一台或同區域時可忽略（本機實測整段延遲 1.2～1.6 秒，其中約 1 秒是 Live 判斷說完的停頓設定）。若日後部署到離使用者很遠的主機，可再評估臨時權杖。WebSocket 不能帶 CSRF 標頭，所以連線需同源 `Origin`、場次擁有者的 cookie，以及建立場次時（CSRF 保護）發的一次性 ticket（60 秒）。
- **系統指示**沿用教授 Agent 的 `interviewGuide`、`anonymityGuide`、`speechTranscriptGuide`、陳教授角色、開場角度（`OpeningPlanner`）、話題線追問上限與學生確認的備審主張；練習時間由前端每 5 秒回報，進入最後一題區間時以 `clientContent`（`turnComplete: false`，不打斷）提示「下一題用『最後一個問題』」，剩 20 秒提示「說完就致謝」。最後一題回答後 Live 致謝即收尾；若 Live 沒有說出致謝，改用回合制的致謝語音。
- **逐字稿與復盤：**輸入／輸出語音轉寫（`languageCodes: ["zh-TW","en-US"]` 與少量資工術語，避免轉成簡體）由後端分段：教授說完一句寫成 `questionText`，學生的話在教授下一次開口後寫成 `answerText` 並標 `answerFromSpeech`。停頓 8 秒時請 Live 換個方式問（寫成同題 `followUps`），再沒回應就換話題；學生也可打字作答，文字會送進 Live。括號旁白（例如「(等待學生回答)」）不寫入。復盤照常使用這些 turns。
- **匿名：**教授說出的問題以 `violatesAnonymity` 檢查，違規的不寫入 turns，並請 Live 說「這題先跳過」改問；回答中的校名照回合制計數、提醒，送給教授與復盤 Agent 前遮蔽。限制：Live 已經聽到原始語音，違規的問題也已經說出口，後端只能事後攔截。
- **回聲：**教授說話時，瀏覽器只送明顯大聲的人聲（RMS ≥ 0.06，視為插話）到 Live，避免喇叭回聲被當成學生開口；建議戴耳機。
- **降階（面試不會卡住）：**設備頁會試連一次 Live（`POST /api/live/probe`，逾時 5 秒）；逾時、`429 RESOURCE_EXHAUSTED`、驗證失敗或其他錯誤時，畫面標示「即時對談無法使用，改用回合制」，本場直接走回合制。面試中 Live 斷線或額度用完：先用 `sessionResumption` handle 重新連線（GoAway 或非額度／驗證錯誤，最多 3 次；Live 一個工作階段只允許一個連線，所以會先關舊連線，期間的麥克風音訊最多保留 10 秒再補送），接不上就在題目邊界切回回合制：教授說到一半 → 學生剛才的回答已完整，教授 Agent 依累積逐字稿從同一話題接著問（含 TTS）；學生說到一半 → 已轉出的文字留在作答區，題目不重念；還沒開場 → 教授 Agent 開場。瀏覽器 15 秒內沒有連上 Live、伺服器重啟，或學生改用回合制操作（送出文字 API、錄音辨識）也會切回回合制。舊連線遲到的訊息一律丟棄，不會寫進新題。
- **授權：**設定頁新增「暖身對談使用 Gemini Live 即時對談」（需同時允許 Agent 與語音），說明音訊會經後端即時送 Google、免費層的內容會被 Google 用來改進產品並可能經人工審閱；Live 是否啟用（模型名稱）納入授權簽章 `preferenceScope()` 的 `live` 欄位。開場送出 `consent.liveVoice`，後端同意紀錄為 `speech-processing-v4`。
- **頁面隱藏：**教授語音以 Web Audio 排程播放，不使用 `<audio>` 元素，切到別的分頁時不會像回合制那樣延後載入音檔。

實測（2026-10-28，真實 Gemini Live API、示範 Agent、以兩段合成中文錄音當學生）：Chrome 152 正式頁面 8 次「學生說完到教授語音開始播放」1,161～1,592 毫秒（中位數約 1.45 秒）；Node 版手動檢查 9 次「最後一段有聲音訊送出到第一段教授音訊回到後端」1,254～1,683 毫秒；模擬斷線後以 handle 接續 0.83～1.48 秒，接續後教授仍延續原話題；設備頁試連 0.6～1.8 秒。手動檢查：`node scripts/check-live-voice-real.mjs answers.wav`（需 key，不在離線檢查內）。真人說話的停頓、網路與麥克風環境仍會影響數字。

### 瀏覽器串流辨識（預設，2026-10-27）

學生的回答預設由瀏覽器的 Web Speech API（`SpeechRecognition`／`webkitSpeechRecognition`，`zh-TW`、連續、含 interim）即時辨識：說話時作答區直接顯示辨識中的文字（斜體），停頓後把文字經 `POST /api/sessions/:id/answers`（帶 `turnId`、`eventSeq`）送出，不再上傳錄音給後端 Whisper。結束判斷要兩個條件同時成立：麥克風音量安靜 1.6 秒，且 Chrome 1.2 秒內沒有回傳新的 interim 文字（文字會比聲音晚到）；只看其中一個會在說話途中截斷（小聲時音量低於門檻、Chrome 換氣就定稿而下一段字超過 1 秒才回來）。Chrome 重送相同的 interim、或定稿時多補幾個字，都不算還在說話。若音量一直不降（例如途中開了風扇），6 秒沒有新字也會結束。說話期間噪音基準固定為開口前的值，連續說話不會被當成背景噪音。停頓時仍有未定稿文字會先 `stop()` 讓服務定稿，最多等 0.7 秒。單次回答上限從第一個字起算 3 分鐘（錄音退回 Whisper 時仍是 60 秒）。只有雜音、沒有文字時不送出，繼續聽同一題。

辨識準確度：Web Speech API 沒有可用的自訂詞彙，中英混雜的術語常被寫成同音中文（例如 DP → 「一滴」、Python → 「拍放」）。語音回答在後端標記 `answerFromSpeech`，教授 Agent 與復盤 Agent 的指示會說明這是辨識文字，要依上下文推回原意，不追問、不糾正錯字，也不把辨識錯字評為表達問題；逐字稿本身保留原文。

Chrome 的 Web Speech API 會把麥克風音訊送到 Google 語音服務，面試後端只收到文字。設定頁可選「瀏覽器串流辨識（較快，音訊送 Google）」或「本機 Whisper（較慢，不外傳）」，預設串流；辨識位置納入授權簽章，更換後需重新允許語音。開場時送出 `consent.speechRecognition`，後端同意紀錄以 `speech-processing-v3` 記錄串流辨識。

以下情況改走原本的 MediaRecorder → `/audio-answers` → 本機 Whisper，且同一場剩下的題目都用 Whisper：瀏覽器不支援（例如 Firefox）、辨識服務回報 `network`／`not-allowed`／`service-not-allowed`／`audio-capture` 等錯誤、連續兩段說話都沒有辨識結果，或辨識工作階段無法重新開始。錯誤發生時若已辨識到文字，文字會留在作答區讓學生修改後送出；沒有文字則自動改用錄音重新聽同一題，Whisper 辨識失敗仍會先自動再聽一次。`no-speech`（安靜太久）只會重新開始辨識，不算錯誤。教授播放語音、教授思考、收尾期間不收音；換題時中止舊辨識，舊題的結果（包含停頓定稿中才回來的結果）不會送到新題，後端也會以 `eventSeq` 拒絕過期回答。

實測（2026-10-27，Chrome 152、獨立暫存設定檔、以合成中文錄音當假麥克風、示範 Agent）：7 個回答從音量判定說完到送出 1.60～1.62 秒，後端收到 1.63～2.03 秒；同兩段錄音以本機 Whisper small 辨識需 12.4～15.4 秒（不含錄音上傳與停頓判斷）。截斷修正後（2026-10-28，同一套量測）6 個回答中 4 個為 1.60～1.61 秒；停頓時仍有未定稿文字的 1 個為 2.8 秒；另 1 個 4.8 秒發生在電腦記憶體不足卡頓時（後端也延遲到 12.5 秒）。6 個回答都完整收到句尾，沒有截斷。真人說話的實際數字仍以實測為準。前端主控台會記錄每次的「說完到送出」與「最後新字到送出」毫秒數，後端 `timings` 以 `browser_recognition` 階段記錄。內建預覽面板會封鎖麥克風（Web Speech 回報 `not-allowed`），請在 Chrome 開 `http://localhost:4180` 實測；實際延遲仍受網路與真人說話停頓影響。

### 後端語音（Whisper／Gemini／SAPI）

文字面試不依賴 Google API key。要啟用回合制語音辨識和提問語音，需另外設定 Gemini API：

```powershell
$env:VIVAPREP_SPEECH_MODE = "gemini"
$env:GEMINI_API_KEY = "你的 Google AI Studio API key"
npm run dev
```

設定後，瀏覽器錄音會送至 Gemini Transcribe Files API，完成辨識後會要求刪除暫存檔；教授提問由 Gemini TTS 產生 WAV。這是 STT → 文字教授 Agent → TTS 的回合制流程；暖身對談的 Gemini Live 見上一節。沒有設定或使用者未同意時，可直接用文字回答。

Windows 也可設定 `VIVAPREP_SPEECH_MODE=windows-sapi` 使用本機語音辨識與合成，不需要 Gemini API key；錄音不會送至語音服務。這是回合制語音流程，也是 Gemini Live 無法使用時的備援。

只要伺服器設定了 `GEMINI_API_KEY`，教授提問預設改用 Gemini TTS，即使語音辨識仍在本機（`whisper-local` 或 `windows-sapi`）；學生錄音仍留在本機，只有教授的題目文字送到 Google。該場沒有同意 Agent 處理時不送出，改用本機聲音；Gemini 連線或額度失敗時也自動改用本機聲音，不會整段沒聲音。要固定使用本機聲音可設 `VIVAPREP_TTS_MODE=local`。試聽方式：

```powershell
$env:GEMINI_API_KEY = "你的 Google AI Studio API key"
npm run dev:agent
```

三位教授各有自己的聲線（`server/speech-adapter.js` 的 `voiceProfiles`）：林教授與周教授為男聲、陳教授為女聲。Gemini TTS 預設林教授 Charon、陳教授 Sulafat、周教授 Puck，並依角色帶入語氣說明；Google 文件沒有標示預建聲音的性別與口音，正式使用前請試聽。可用 `GEMINI_TTS_VOICE_TECHNICAL`、`GEMINI_TTS_VOICE_PORTFOLIO`、`GEMINI_TTS_VOICE_LOGIC` 改成其他聲音或 Extended Voice Library／Voice design 的 voice id；`node scripts/list-gemini-voices.mjs` 會列出台灣與中文候選聲音。本機模式改用 Windows OneCore zh-TW 聲音：林、周教授用 Zhiwei 男聲（語速與音高不同），陳教授用 Yating 女聲；沒有 OneCore 聲音時退回桌面 SAPI。

語音面試在教授音訊實際播放結束後才啟動收音與回答等候計時。麥克風已授權時可直接開口。收音判斷會從最近 4 秒最安靜的音量估計環境噪音，開口門檻是噪音的 3 倍（至少 0.02），並分開設定開口與持續說話兩個門檻，所以風扇、冷氣等穩定噪音不會被當成說話；停頓約 1.6 秒自動送出辨識，單次回答最長收音 60 秒，也可按「說完了，送出」。畫面顯示收音音量、辨識與考官思考狀態；辨識失敗時會先自動再聽一次，同一題再失敗才需要按「重試收音」；本機 Whisper 逾時被終止後會在背景自動重新載入，可隨時改用文字或暫停麥克風。朗讀、辨識及產生下一題期間不會觸發停頓接話。若瀏覽器阻擋音訊自動播放，需按「播放問題」或選擇閱讀字幕。

說完題目後約 8 秒仍無回答，考官會明確降低難度、換個方式問；改問後再等 12 秒無回答就換到新話題。每題標記實際提問重點，面板排除近期重複重點與高度相似問句；候選題皆重複時再請 Gemini 產生新話題。這是互動策略，不把沒有收到語音的狀態當成學生能力不足。

### 本機語音與現場速度（2026-09-28）

Windows 可先執行 `powershell -File scripts/setup-local-speech.ps1`。此腳本在專案 `.data` 建立獨立 Python 環境，從 PyPI 安裝 faster-whisper 與 OpenCC，下載約 484 MB 的 Whisper small 模型。`npm run dev:agent` 偵測模型後啟用 `whisper-local`；未安裝時仍使用原 SAPI。模型預先載入常駐程序，CPU int8 辨識，VAD 排除等待與尾端靜音，繁體轉換及技術詞彙提示只協助辨識，不產生答案。錄音經記憶體管線傳入，不存檔，也不向語音廠商傳送。TTS 仍使用 Windows。

現場每回合只呼叫一位相關教授，輸出四個問題欄位；使用 `ANTIGRAVITY_LIVE_MODEL`（預設 `gemini-3.8-flash-low`）與 low effort。同場重用獨立 CLI 串流對話，要求直接以 finish 提交；接納當回合的新 finish 或當回合 response 中符合問題格式的 JSON，排除 CLI 可能回傳的上一回合 structured_output。完整多面向復盤仍使用 `ANTIGRAVITY_MODEL` 與原思考設定。等待辨識、模型及語音合成準備時，練習倒數暫停；教授朗讀、學生思考與回答時繼續計時。

`GET /api/sessions/:id` 的 `timings` 只含階段、毫秒與回合 ID，方便定位慢在辨識、產題或合成。`node scripts/check-interview-performance.mjs` 以兩段固定合成 WebM 錄音跑三個問題，分別量測上述階段，結果存入 `.data/performance/after.json`；`VIVAPREP_CHECK_LABEL` 可另設測試名稱。`node scripts/check-cli-conversation.mjs` 驗證串流重用與舊輸出攔截，`node scripts/check-local-stt.mjs` 重用合成錄音比較本機辨識。測試不開啟實體麥克風，臨時場次於最後刪除。

可用 `node scripts/check-conversation.mjs` 檢查播放時序、重複問題與語音競態；`node scripts/check-voice-ui.mjs` 使用隔離的 Web API 替身測試正式頁面的自動收音、停頓送出及過期音訊，不會開啟實體麥克風。已啟動 CLI 與 Windows 語音服務時，`node scripts/check-live-interview.mjs` 會用純合成資料測試 WebM 語音辨識、Gemini 追問、改問、換題與復盤；測試場次會清除，結果保存在 `.data/live-dialogue-check.json`。

## 帳號、管理員與郵件

本機註冊採電子郵件 + 密碼（至少 12 字元），密碼使用 Node scrypt；驗證信、重設密碼和取消帳號刪除連結會在伺服器終端輸出本機預覽連結，不會把信箱寫入 log。正式郵件可設定簽名 webhook：

```powershell
$env:VIVAPREP_EMAIL_MODE = "webhook"
$env:VIVAPREP_EMAIL_WEBHOOK_URL = "https://your-mail-service.example/send"
$env:VIVAPREP_EMAIL_WEBHOOK_KEY = "由部署環境安全注入的密鑰"
$env:VIVAPREP_PUBLIC_URL = "https://your-domain.example"
```

設定 `VIVAPREP_BOOTSTRAP_ADMIN_EMAIL` 後，該信箱完成驗證時會取得初始 admin 角色；登入帳號頁設定 TOTP 驗證器和一次性復原碼後，才能審核心得或處理個資申請。不要在公開環境使用預設本機郵件模式。production 模式還必須注入至少 32 bytes 的 `VIVAPREP_APP_SECRET`；目前仍需先完成 PostgreSQL adapter 與部署安全設定，才適合作為正式服務。

## 試點資料

首個正式來源 profile 是逢甲資工 115 學年度一般申請：官方資料列為一關、5 分鐘，觀察學習態度與思考、邏輯表達和系所相關知識；正式面試委員人數未載明。介面可選 5、10、15、20 分鐘，後三者是延伸練習長度，不代表正式場次。三位教授只是模擬角色。APCS 與其他校系 profile 仍標示為一般練習，沒有混用一般申請規則。

## API

場次節奏端點：`POST /api/sessions/:id/progress` 更新有效練習秒數；`/ending` 停止出題並容許最後答案保存；`/close` 發送致謝收尾；`/finish` 開始復盤。各端點沿用場次擁有權與 CSRF 檢查。

- `GET /api/health`、`GET /api/profiles`、`GET /api/profiles/:id`、`POST /api/profiles/custom`（建立本場用的一般模擬情境，不保存為官方校系資料）
- `GET /api/auth/session`、`POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`
- `POST /api/auth/verify-email`、`POST /api/auth/verification/resend`、`POST /api/auth/password-reset/request`、`POST /api/auth/password-reset/confirm`
- `GET/PATCH /api/account`、`POST /api/account/password`、`GET /api/account/export`
- `GET /api/account/practice-sessions`、`GET/DELETE /api/account/practice-sessions/:id`、`GET /api/account/sessions`、`DELETE /api/account/sessions/:id`
- `POST /api/account/deletion-requests`、`POST /api/account/deletion-requests/cancel-token`、`POST /api/privacy/requests`
- `GET /api/account/mfa`、`POST /api/account/mfa/setup`、`POST /api/account/mfa/confirm`、`POST /api/account/mfa/verify`
- `POST /api/sessions`、`GET /api/sessions/:id`、`DELETE /api/sessions/:id`
- `POST /api/portfolio/parse`（經獨立同意後，CLI 模式抽取 PDF 文字交給 CLI 整理；API 模式使用 Gemini 原生 PDF 輸入）
- `POST /api/portfolio/release`（完成匯入後釋放屬於目前訪客／帳號的 CLI 整理批次）
- `PATCH /api/sessions/:id/settings`（更新字幕或回答方式；啟用語音需明確同意音訊處理且語音服務可用）
- `GET /api/sessions/:id/events`（SSE）、`GET /api/sessions/:id/events/:seq/audio`
- `POST /api/live/probe`（試連 Gemini Live，不含學生資料）、`GET /api/sessions/:id/live?ticket=…`（WebSocket，暖身對談即時語音；需同源、場次擁有者與一次性 ticket）
- `POST /api/sessions/:id/answers`（文字或瀏覽器串流辨識的文字；帶 `eventSeq` 時拒絕舊題回答）、`POST /api/sessions/:id/audio-answers`、`POST /api/sessions/:id/nudge`、`POST /api/sessions/:id/finish`、`GET /api/sessions/:id/review`、`POST /api/sessions/:id/review/retry`
- `GET /api/reports/share-policy`、`POST /api/reports/preview`、`POST /api/reports`、`POST /api/reports/:id/withdraw`
- `GET /api/admin/reports`、`POST /api/admin/reports/:id/review`、`GET /api/admin/privacy-requests`、`POST /api/admin/privacy-requests/:id/complete`（具相符角色且近期完成 MFA）

非安全方法必須帶同源 CSRF token；API 以登入 session 或訪客 cookie 驗證場次所有權。心得預覽會掃描標題、形式、主題與摘要的常見直接識別資訊，遮罩後需再次確認；這不能保證排除間接識別。只有人工核准的當前 revision 進入來源檢索。若 `.data/reports.json` 存在，啟動時會匯入舊回報；舊資料標記為需重新檢視，不宣稱有新制同意證據。

Gemini 復盤會分析完整逐字稿與回答：單段最多六回合，或在輸入達容量界線時提早分段；多段再統整，引用只保留能在原逐字稿找到的引文。Session state 以 SQLite 暫存，結束／離開時由前端請求刪除；若瀏覽器或伺服器非正常關閉，最多依 TTL 留存一小時。

## 前端場景

面試室目前使用平面面試室照片與去背的教授動作圖；發問、聆聽、翻閱筆記和思考時會切換姿勢圖片，不需要 WebGL。3D 角色開發暫緩，現有模型與製作規格保留於 `public/assets/avatars/README.md`。

設備檢查頁提供選用的本機鏡頭試測，預覽含頭部與上半身虛線取景提示。勾選後，面試中由 MediaPipe Face/Pose Landmarker 在瀏覽器 Worker 取得臉部特徵點、眼球 blendshape 與上半身特徵點，連到當題 `turnId`、教授與互動階段。開場前約 3 秒為個人校正（坐正、看著考官），之後以校正為基準估計：視線方向（看向考官／低頭／看旁邊／往上看，結合頭部角度與眼球方向，眨眼時不判斷）、坐姿（頭肩下沉、肩膀歪斜）、手部靠近臉部、上半身晃動，以及連續低頭或移開視線的次數與最長秒數。移動電腦或座位後可按「重新校正」。復盤頁的「姿態與視線回饋」只看回答時段：每項給出數值、等級（保持／留意／優先改善）、為什麼重要與一個練習方法，指出最明顯的題目，並以每題的視線分布條呈現；未校正或資料不足時只說明原因，不下判斷。門檻是設計上的經驗值（`src/camera-signals.js`），需用團隊錄製樣本校正。視覺套件與 WASM 由本機伺服器提供；首次載入仍需瀏覽器連線至 Google Storage 取得臉部和姿勢模型檔。原始攝影機影格永不傳到 VivaPrep 伺服器。衍生摘要預設只留在目前頁面；使用者另行同意後，摘要才會送給 Agent 復盤。若同時選擇保存私人歷史，摘要會加密保存並可隨該筆歷史刪除，不會加入共用心得。這些指標尚未以人工標註驗證，視線是相對校正的估計而非眼動儀量測，不構成面試表現評分。檢查：`node scripts/check-camera-feedback.mjs`、`node scripts/check-voice-profiles.mjs --local`。

Gemini Live API 目前只用在「暖身對談」的即時語音（其他組合仍為回合制）；尚未有 Google Drive／Workspace 匯入或 Google Cloud 部署整合。Gemini 教授 Agent 可透過 Gemini API 或 Antigravity CLI 提供回合制文字推論；CLI 模式以 PDF.js 在本機伺服器抽取文字後交給 CLI，API 模式保留 Gemini 原生 PDF 輸入。本機 SAPI、Gemini STT/TTS、Chrome Web Speech API（Google 語音服務）和 MediaPipe 是其他可選或已接入的元件。Drive 和 Cloud 部署仍屬規劃，簡報應依實際完成狀態描述。

## 設計文件

- [使用者帳號與匿名分享資料架構](使用者帳號與匿名分享資料架構.md)：完整資料模型、API、隱私界線、保留與 PostgreSQL 上線遷移規格；本機 SQLite schema v3、電子郵件帳密、私人歷史、匿名心得和管理流程已接線，OIDC 與 PostgreSQL runtime 尚待部署階段實作。
- [Agent 與後端設計規格](VivaPrep_Agent與後端設計規格.md)：四個 Agent、RAG、API、資料飛輪和隱私邊界。
- [設計迭代紀錄](VivaPrep_設計迭代紀錄.md)：按日期追加實作與設計變更，供其他 session 和前端對齊。
- [UI 設計規格與前端任務](UI_設計規格與前端生成任務.md)
- [產品初步規劃書](VivaPrep_大學申請面試模擬系統_初步規劃書.md)
