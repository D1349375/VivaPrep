# VivaPrep Google 服務規範調研：Gemini API／Live、Cloud Run、Drive

> 查核日期：2026-10-28（Asia/Taipei）。全部來源都在當天讀取，條款與文件日後可能變動，正式上線前要再核對一次。
> 用途：在動手做 Cloud Run、Drive、三位教授 Live 之前，先確認有沒有條款、額度或平台限制會讓做好的功能不能用或不能宣稱。
> 本文只整理官方文件的內容，不是法律意見。標「未查證」的項目，本輪沒有找到或讀到原文。

## 0. 先看這六點

| # | 發現 | 影響 | 建議動作 |
|---|---|---|---|
| 1 | Gemini API 條款**禁止**把服務用在「以未滿 18 歲者為對象，或可能被未滿 18 歲者使用」的網站或 app。Google Cloud（Agent Platform，前身是 Vertex AI）的 Generative AI 條款 §20(d) **也有同一條**。 | VivaPrep 的使用者是高三申請生，很多人面試時未滿 18 歲。這條影響**所有** Gemini 功能（教授 Agent、PDF、TTS、Live、復盤），**改用 Vertex AI 也避不開**。 | 要先決定對外定位與部署範圍（見第 1 節），簡報詢答也要準備。 |
| 2 | 免費層條款寫明「不要把敏感、機密或個人資料送進免費服務」；免費層的內容會被 Google 拿來改進產品、訓練模型，也可能有人工審閱。 | 備審 PDF、學生回答與語音都屬於個人資料。 | 至少一個專案**開啟付費**（Paid tier）。費用很低，見第 2 節。 |
| 3 | Antigravity CLI（agy）在論壇的回覆（含 Google 人員）只認可「個人在自己電腦上使用」，不包括共用伺服器或多使用者轉接；包裝 agy 可能觸發帳號停權。 | agy 不能當作部署給別人用的後端。 | demo 與 Cloud Run 都用 Gemini API；agy 只留在本機開發。 |
| 4 | Drive 只用 `drive.file` 範圍是「非敏感」範圍，只要基本驗證。但 Workspace API 使用者資料政策**禁止**用使用者資料訓練或改進通用 AI 模型。 | Drive 取得的 PDF 若送進免費層 Gemini（免費層會拿資料訓練），可能違反這項政策。 | Drive 功能**必須搭配付費層**；只用 `drive.file`。 |
| 5 | Cloud Run 的檔案系統在記憶體裡，執行個體停止後資料就消失；多個執行個體之間不共享狀態；WebSocket 受請求逾時限制（預設 5 分鐘、最長 60 分鐘）。 | 目前的 SQLite 與場次狀態在 Cloud Run 上不會保存，多執行個體時 SSE、WebSocket、REST 可能落在不同機器。 | demo 版設最多 1 個執行個體、開啟 session affinity、逾時調到 60 分鐘，並在簡報寫明「展示用部署，資料不持久」。 |
| 6 | Live 的聲音只能在建立連線時設定；額度按專案計算，不是按 key；`gemini-3.8-live` 的同時連線上限官方沒有公布。 | 三位教授要三條連線，免費層可能不夠。 | 用付費專案；做之前先到 AI Studio 的限速頁看實際上限。 |

## 1. 未滿 18 歲限制（最重要）

### 原文

- Gemini API 附加條款（2026-03-23 生效，2026-04-28 更新），年齡要求一節：
  - "You must be 18 years of age or older to use the APIs."
  - 也不得把服務用在 "directed towards or is likely to be accessed by individuals under the age of 18" 的網站、app 或其他服務。
- Google Cloud 服務專屬條款 §20(d)（Generative AI Services，適用 Agent Platform，也就是原本的 Vertex AI）：Customer 不得、也不得讓 End User 把 Generative AI Service 用在以未滿 18 歲者為對象或可能被其使用的服務。
- §32（Live API on Agent Platform）：自訂聲音與虛擬人功能不得使用任何未滿 18 歲者的影像、錄音、聲音樣本或衍生資料；這項功能只開放給 Google 核准的客戶，而且不能整合進面向一般使用者的 app。

### 有沒有教育例外

沒有找到。Google 開發者論壇上有好幾位教育 app 開發者問過，包括使用者自備 key、年齡驗證、限成人功能等做法，Google 人員都沒有給具體答覆，只請他們參考文件。

### 對 VivaPrep 的意義

- 現在的原型在本機執行、沒有對外開放，實際使用者是成年的團隊成員，風險主要在「部署給高中生使用」那一刻。
- Cloud Run 一上線就是對外服務。如果宣傳對象是高三生，就落在條款範圍內。

### 可以選的方向（需要你們決定）

1. **把第一個對外上線的族群改成 18 歲以上**：研究所甄試／碩士班口試、轉學考、學士後面試等。同一套引擎（備審 → 追問 → 復盤）都適用，規劃書 18.2 節也把研究所列為延伸方向。高三版本列為「取得 Google 書面確認後再開放」。
2. **Cloud Run 只開給團隊與評審**：用邀請碼或允許名單，加上「年滿 18 歲」確認，簡報寫明這是展示用部署，不對高中生公開。
3. **未成年版改用非 Google 模型**：但 Gemini 組看 Google 整合，這條只適合當長期備案。注意競賽規定不得使用中國或中資來源的模型。
4. **正式上線前向 Google 詢問並取得書面確認。**

**決定（2026-10-29）：**採「限制部署範圍」：Cloud Run 只開給團隊與評審，加上年滿 18 歲確認；簡報把第一個公開上線族群寫成 18 歲以上，高三版本待取得 Google 書面確認後再開放。

詢答建議講法：主動說明已查到這條限制、目前原型只由成年團隊成員使用、部署有存取限制，以及正式上線前的處理計畫。不要等評審先提。

## 2. Gemini API（教授 Agent、PDF、TTS、Live 共用）

| 項目 | 官方內容 | 對 VivaPrep |
|---|---|---|
| 使用目的 | 「for professional or business purposes, not for consumer use」：指開發者是以專業或商業目的使用 | 團隊以產品開發身分使用，沒有問題。 |
| 地區 | 台灣在可用地區清單內 | 可以使用。 |
| 免費層資料 | 內容用來改進產品並訓練模型；可能有人工審閱；不要送個人或敏感資料 | 不適合真實學生資料，要用付費層。 |
| 付費層資料 | 不用你的提示改進產品；只在有限期間內記錄提示與回應，用於偵測違規、安全與法律需求 | 設定頁的授權說明要改寫成付費層版本。 |
| 禁止用途 | 不得開發與 Gemini 競爭的模型、不得反向工程、不得繞過安全機制、不得用於臨床 | 都不涉及。 |
| 生成式 AI 禁止使用政策（2024-12-17） | 高風險自動決策清單是就業、醫療、金融、法律、住房、保險、社福，**沒有列教育**；禁止為了欺騙而冒充真人、或把 AI 內容說成純人類創作 | VivaPrep 本來就不打分數、不預測錄取。教授是虛構角色，介面要持續標明是 AI 模擬。 |
| 模型狀態 | `gemini-3.8-live`、`gemini-3.8-flash`、`gemini-3.8-flash-tts` 都是 Stable | 很好。不要改用 Preview 模型（例如 3.5 Live Translate）：Preview 限速較嚴，最短 2 週通知就會下架。 |
| 速率限制 | 「Rate limits are applied per project, not per API key」 | 同專案多開 key 沒用。 |

### 付費價格（每 100 萬 token，美元，付費層）

| 模型 | 輸入 | 輸出 |
|---|---|---|
| `gemini-3.8-live` | 文字 0.75；音訊 3.00（約每分鐘 0.005） | 文字 4.50；音訊 12.00（約每分鐘 0.018） |
| `gemini-3.8-flash` | 文字 0.75（2027-01-01 起 1.50） | 文字 3.75（2027-01-01 起 7.50） |
| `gemini-3.8-flash-tts` | 文字 0.50 | 音訊 9.00（約每 10 秒 0.00225） |

粗估：一場 5 分鐘 Live 面試，麥克風音訊全程上傳約 0.025 美元，教授說話約 2 分鐘約 0.036 美元，一場不到 0.1 美元。決賽前的測試與展示加起來應該在幾美元內。

## 3. Gemini Live

| 項目 | 官方內容 | 對 VivaPrep |
|---|---|---|
| 工作階段長度 | 純語音 15 分鐘，語音加影像 2 分鐘 | 面試最長 8 分鐘，夠用。**不要把鏡頭畫面送進 Live**，否則上限變 2 分鐘。MediaPipe 繼續在本機跑。 |
| 連線壽命 | 約 10 分鐘，結束前會送 GoAway | 現有的接續邏輯已經處理。 |
| 接續 token | 工作階段結束後 2 小時內有效 | 沒有問題。 |
| 聲音 | 在連線設定的 `speechConfig` 指定；文件沒有寫能中途更換 | 三位教授各自要一條連線。 |
| 函式呼叫 | `gemini-3.8-live` 支援，預設非同步 | 可以用來交棒給下一位教授。 |
| 手動說話偵測 | 可以關掉自動偵測，自己送 activityStart／activityEnd；官方建議說完後至少等 500 毫秒 | 想精準控制哪位教授收音時可以用。 |
| 同時連線上限 | 官方頁沒有公布 `gemini-3.8-live` 的數字。唯一查得到的是舊版 2.5 Flash Live 免費層每專案 3 條 | 要到 AI Studio 限速頁（aistudio.google.com/rate-limit）查你們專案的實際數字。 |
| 自訂聲音 | Agent Platform 上的自訂聲音只開放核准客戶、不能用在面向使用者的 app、不能用未成年人的聲音 | 不要規劃「客製教授聲音」，用預建聲音就好。 |

## 4. Cloud Run

| 項目 | 官方內容 | 對 VivaPrep |
|---|---|---|
| 地區 | `asia-east1`（台灣）是 Cloud Run 地區，屬 Tier 1 價格 | 部署在台灣，延遲最低。 |
| WebSocket 與 SSE | 都算 HTTP 請求，受服務逾時限制：預設 5 分鐘、最長 60 分鐘；逾時就斷線，用戶端要能重連 | 逾時要設成 3600 秒，否則 Live 與 SSE 會在 5 分鐘斷線。 |
| 多執行個體 | 不同執行個體之間看不到彼此資料；session affinity 只是盡量把同一用戶導到同一台 | 目前場次狀態在單機 SQLite，demo 設 `max-instances=1`，並開 session affinity。 |
| 開著 WebSocket 時 | 執行個體算活躍狀態，CPU 持續分配，按執行個體計費 | 面試期間會計費，金額很小。 |
| 檔案系統 | 在記憶體裡；執行個體停止就消失；寫入會占記憶體（預設 512 MiB），超過會被終止 | SQLite 資料（帳號、歷史、心得）不會保存。展示可以接受，但要誠實標示；真正持久化需要 Cloud SQL 或 Firestore，PostgreSQL adapter 目前還沒做。 |
| 關機 | 先送 SIGTERM，10 秒後強制結束 | 最好加 SIGTERM 處理，先關閉 Live 連線。 |
| 監聽位址 | 必須監聽 `0.0.0.0` 與 `PORT`（預設 8080） | `server/config.js:16` 預設 `HOST=127.0.0.1`，部署時要設 `HOST=0.0.0.0`。 |
| 免費額度 | 每月 180,000 vCPU 秒、360,000 GiB 秒、200 萬次請求（以請求計費時） | 展示用量應在免費額度內。 |
| 免費試用 | 300 美元、90 天，**需要信用卡**；**這筆額度不能支付 AI Studio 的 Gemini API 費用** | Gemini API 付費會直接從卡片扣，要有人提供付款方式。 |
| 執行環境 | Linux 容器 | Windows SAPI、本機 Whisper（Windows venv 路徑）、agy 都不能在 Cloud Run 上用。雲端版改用瀏覽器串流辨識、Gemini TTS 與 Gemini API。 |
| HTTPS | Cloud Run 提供 HTTPS 網址 | 其他裝置（評審的電腦、手機）也能使用麥克風與鏡頭。瀏覽器只在 HTTPS 或 localhost 允許使用麥克風與鏡頭。 |
| 匿名規定 | 競賽規定 | 專案 ID、服務名稱、網址都不能含校名或縮寫。 |

API key 建議放在 Secret Manager，不要寫進映像檔；這是 Google Cloud 的一般建議做法，本輪沒有另外讀原文。

## 5. Google Drive 匯入

| 項目 | 官方內容 | 對 VivaPrep |
|---|---|---|
| 範圍分類 | `drive.file`：**非敏感**（只能存取使用者用這個 app 開啟或分享的檔案）；`drive.readonly`、`drive`：**受限** | 只用 `drive.file`。受限範圍若把資料存到伺服器或傳出去，要通過安全評估，決賽前做不完。 |
| 驗證 | 非敏感範圍只需基本 OAuth 應用程式驗證 | 可行。 |
| Picker 需要的東西 | API key（`setDeveloperKey`）、Web 應用程式類型的 OAuth client ID、App ID＝**專案編號**；client ID 和 App ID 必須來自同一個 Cloud 專案 | 這三樣都要由你們在 Cloud Console 建立。 |
| 取得檔案內容 | Picker 只回傳檔案 ID 與中繼資料，內容要另外用 Drive API `files.get` 下載 | 下載後交給現有的備審 PDF 解析流程。 |
| 「測試中」發布狀態 | 最多 100 位測試使用者；授權 **7 天後失效** | 把團隊與 demo 帳號加為測試使用者；決賽前 7 天內（11/1 之後）重新授權一次。 |
| 使用者資料政策 | 禁止用使用者資料「create, train, or improve」通用 AI 模型；為了提供使用者看得到的功能而轉交資料，要經使用者同意 | 搭配付費層 Gemini；設定頁新增 Drive 專用的同意說明。 |
| 學校帳號 | Workspace for Education 的未滿 18 歲帳號，在管理員設定前存取第三方 app 會被擋（「Access blocked」），學生要向學校申請審核（2023 年規定） | 高中生如果用學校帳號，大多無法直接授權；個人帳號可以，但仍受第 1 節的年齡限制。展示時用成年團隊成員的個人帳號。 |

## 6. 本輪未查證

- Chrome Web Speech API 對未成年使用者與資料處理的條款（只知道音訊會送到 Google）。
- MediaPipe 函式庫與模型檔的授權（一般認知是 Apache 2.0，本輪沒有讀原文）。
- 台灣個人資料保護法：跨境傳輸，以及未成年人同意的規定。
- Google Cloud 可接受使用政策（AUP）全文（讀取時內容被截斷）。
- Antigravity 官方服務條款原文（只讀到論壇討論）。
- 你們專案的 `gemini-3.8-live` 實際同時連線上限（要登入 AI Studio 查看）。

## 7. 對工作順序的影響

開 Cloud Run session 之前，先完成這幾件事：

1. ~~決定年齡與定位~~：2026-10-29 已決定「限制部署範圍」（見第 1 節）。
2. **開啟付費**：準備一個 Cloud 專案並綁定付款方式，到 AI Studio 確認這個專案的 key 已是付費層，順便查 Live 的同時連線上限。
3. **Cloud Run session 的任務要包含**：Gemini API 模式實測、`HOST=0.0.0.0`、逾時 3600 秒、最多 1 個執行個體、session affinity、Secret Manager、存取限制，並在畫面上標示資料不持久。
4. **Drive session**：只用 `drive.file`、測試使用者名單、11/1 後重新授權、付費層、Drive 同意文字。
5. **三位教授 Live（非必須）**：排在 Cloud Run 之後，付費專案，先確認同時連線上限。

## 來源

- [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)
- [Gemini API 可用地區](https://ai.google.dev/gemini-api/docs/available-regions)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Live API guide](https://ai.google.dev/gemini-api/docs/live-guide)
- [Live API session management](https://ai.google.dev/gemini-api/docs/live-session)
- [Generative AI Prohibited Use Policy](https://policies.google.com/terms/generative-ai/use-policy)
- [Google Cloud Service Specific Terms](https://cloud.google.com/terms/service-terms)（§17、§18、§20、§32、§34）
- [Agent Platform（原 Vertex AI）release notes](https://docs.cloud.google.com/gemini-enterprise-agent-platform/release-notes)
- [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)
- [Cloud Run container runtime contract](https://docs.cloud.google.com/run/docs/container-contract)
- [Cloud Run locations](https://docs.cloud.google.com/run/docs/locations)
- [Google Cloud Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features)
- [Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview)、[Picker web sample](https://developers.google.com/workspace/drive/picker/guides/sample)
- [Google Workspace API User Data and Developer Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [OAuth 應用程式發布狀態與使用者上限](https://support.google.com/cloud/answer/15549945)
- [Workspace for Education 第三方 app 存取（2023）](https://workspaceupdates.googleblog.com/2023/08/third-party-app-access-enhancements-for-google-workspace-edu.html)
- 論壇（非官方答覆）：[Gemini API 與 14–25 歲教育 app](https://discuss.ai.google.dev/t/can-gemini-api-be-used-for-educational-app-serving-users-aged-14-25/180993)、[BYOK 與未滿 18 歲學生](https://discuss.ai.google.dev/t/does-byok-allow-gemini-api-use-in-an-app-likely-to-be-accessed-by-under-18-students/185614)、[Live 額度是按 key 還是按使用者](https://discuss.ai.google.dev/t/is-the-gemini-live-api-rate-limit-per-key-or-per-user/78114)、[agy headless 由其他工具呼叫是否允許](https://discuss.ai.google.dev/t/is-a-local-single-user-orchestrator-allowed-to-invoke-the-official-agy-p-cli/179013)
