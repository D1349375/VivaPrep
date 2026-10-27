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

檢查入口：`node scripts/check-topic-threads.mjs`、`node scripts/check-interview-closing.mjs`、`node scripts/check-input-workflows.mjs`、`node scripts/check-voice-ui.mjs`。真實模型檢查 `node scripts/check-live-closing.mjs` 使用合成文字，涵蓋最後一題、致謝語音與復盤，不開實體麥克風。

## 語音 adapter

文字面試不依賴 Google API key。要啟用回合制語音辨識和提問語音，需另外設定 Gemini API：

```powershell
$env:VIVAPREP_SPEECH_MODE = "gemini"
$env:GEMINI_API_KEY = "你的 Google AI Studio API key"
npm run dev
```

設定後，瀏覽器錄音會送至 Gemini Transcribe Files API，完成辨識後會要求刪除暫存檔；教授提問由 Gemini TTS 產生 WAV。這是 STT → 文字教授 Agent → TTS，不是 Live API。沒有設定或使用者未同意時，可直接用文字回答。

Windows 也可設定 `VIVAPREP_SPEECH_MODE=windows-sapi` 使用本機語音辨識與合成，不需要 Gemini API key；錄音不會送至語音服務。此版本是回合制語音流程，尚未接入 Gemini Live API。

語音面試在教授音訊實際播放結束後才啟動收音與回答等候計時。麥克風已授權時可直接開口；持續偵測到聲音後，停頓約 2.5 秒自動送出辨識，也可按「說完了，送出」。畫面顯示收音音量、辨識與考官思考狀態；辨識失敗時需按「重試收音」，可隨時改用文字或暫停麥克風。朗讀、辨識及產生下一題期間不會觸發停頓接話。若瀏覽器阻擋音訊自動播放，需按「播放問題」或選擇閱讀字幕。

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
- `POST /api/sessions/:id/answers`、`POST /api/sessions/:id/audio-answers`、`POST /api/sessions/:id/nudge`、`POST /api/sessions/:id/finish`、`GET /api/sessions/:id/review`、`POST /api/sessions/:id/review/retry`
- `GET /api/reports/share-policy`、`POST /api/reports/preview`、`POST /api/reports`、`POST /api/reports/:id/withdraw`
- `GET /api/admin/reports`、`POST /api/admin/reports/:id/review`、`GET /api/admin/privacy-requests`、`POST /api/admin/privacy-requests/:id/complete`（具相符角色且近期完成 MFA）

非安全方法必須帶同源 CSRF token；API 以登入 session 或訪客 cookie 驗證場次所有權。心得預覽會掃描標題、形式、主題與摘要的常見直接識別資訊，遮罩後需再次確認；這不能保證排除間接識別。只有人工核准的當前 revision 進入來源檢索。若 `.data/reports.json` 存在，啟動時會匯入舊回報；舊資料標記為需重新檢視，不宣稱有新制同意證據。

Gemini 復盤會分析完整逐字稿與回答：單段最多六回合，或在輸入達容量界線時提早分段；多段再統整，引用只保留能在原逐字稿找到的引文。Session state 以 SQLite 暫存，結束／離開時由前端請求刪除；若瀏覽器或伺服器非正常關閉，最多依 TTL 留存一小時。

## 前端場景

面試室目前使用平面面試室照片與去背的教授動作圖；發問、聆聽、翻閱筆記和思考時會切換姿勢圖片，不需要 WebGL。3D 角色開發暫緩，現有模型與製作規格保留於 `public/assets/avatars/README.md`。

設備檢查頁提供選用的本機鏡頭試測，預覽含頭部與上半身虛線取景提示。勾選後，面試中由 MediaPipe Face/Pose Landmarker 在瀏覽器 Worker 估計頭部方向代理值、臉部／肩部涵蓋率和上半身位移，並連到當題 `turnId`、教授與互動階段。視覺套件與 WASM 由本機伺服器提供；首次載入仍需瀏覽器連線至 Google Storage 取得臉部和姿勢模型檔。原始攝影機影格永不傳到 VivaPrep 伺服器。衍生摘要預設只留在目前頁面；使用者另行同意後，摘要才會送給 Agent 復盤。若同時選擇保存私人歷史，摘要會加密保存並可隨該筆歷史刪除，不會加入共用心得。這些指標尚未以人工標註驗證，不提供眼球注視判定或面試表現評分。

目前沒有 Gemini Live、Google Drive／Workspace 匯入或 Google Cloud 部署整合。Gemini 教授 Agent 可透過 Gemini API 或 Antigravity CLI 提供回合制文字推論；CLI 模式以 PDF.js 在本機伺服器抽取文字後交給 CLI，API 模式保留 Gemini 原生 PDF 輸入。本機 SAPI、Gemini STT/TTS 和 MediaPipe 是其他可選或已接入的 Google 元件。Drive、Live 和 Cloud 部署仍屬規劃，簡報應依實際完成狀態描述。

## 設計文件

- [使用者帳號與匿名分享資料架構](使用者帳號與匿名分享資料架構.md)：完整資料模型、API、隱私界線、保留與 PostgreSQL 上線遷移規格；本機 SQLite schema v3、電子郵件帳密、私人歷史、匿名心得和管理流程已接線，OIDC 與 PostgreSQL runtime 尚待部署階段實作。
- [Agent 與後端設計規格](VivaPrep_Agent與後端設計規格.md)：四個 Agent、RAG、API、資料飛輪和隱私邊界。
- [設計迭代紀錄](VivaPrep_設計迭代紀錄.md)：按日期追加實作與設計變更，供其他 session 和前端對齊。
- [UI 設計規格與前端任務](UI_設計規格與前端生成任務.md)
- [產品初步規劃書](VivaPrep_大學申請面試模擬系統_初步規劃書.md)
