# VivaPrep Agent 與後端設計規格

> 設計版本：v0.5
> 更新日期：2026-09-28  
> 狀態：Agent、本機 API、SQLite schema v3、帳號/匿名分享與前端資料流程已接入；外部模型仍需環境設定，OIDC/PostgreSQL runtime 仍屬正式部署工作。

## 1. 範圍與已定決策

本版先完成逢甲大學資工系一般申請的文字面試流程，使用 115 學年度資料作為起始版本。每筆資訊保留學年度、招生管道與來源。APCS 組另建 profile，不混入一般申請規則。

| 項目 | 狀態 | 決策 |
|---|---|---|
| 試點 | 已定 | 逢甲資工一般申請，115 學年度起始。 |
| 場中考官 | 已實作 | 三個教授角色：備審與個人貢獻、資工概念與推理、動機與反思。每回合程式選一位相關角色，Gemini 只生成下一個短問題。完整多面向分析於面試後產生。 |
| 面試後統整 | 已定 | 第四個 Agent 在面試結束後統整三位觀察與逐字稿，不參與場中搶答。 |
| 模型 | 已實作兩種 provider | 預設 mock；可用 Gemini API 直接處理開場、逐題追問、停頓接話與復盤，也保留 Antigravity CLI provider。API 模式使用 `GEMINI_MODEL`，CLI 模式使用 `ANTIGRAVITY_MODEL`。 |
| 備審 PDF | 已實作兩條路徑 | 可選五份 PDF，每份 8 MB、合計 24 MB，依序解析且可重試失敗檔案。CLI 模式由 PDF.js 抽取文字；API 模式使用原生 inline PDF。每份最多八則候選主張，附文件 ID、檔名、頁碼與摘錄；原始 PDF 不保存。面試最多使用 40 個已確認主張。 |
| 語音 | adapter 已實作 | 回合制 STT → 文字 Agent → TTS；使用 Gemini 3.5 Transcribe 與 Gemini 3.8 Flash TTS 的可選 adapter，不接 Live API。需 VIVAPREP_SPEECH_MODE=gemini 和 GEMINI_API_KEY。 |
| RAG | 已定原則 | 結構化校系 profile 加來源檢索；官方資訊、心得與生成題分層；不微調模型。 |
| 資料庫、登入、保存期限 | SQLite schema v3 與本機帳號流程已接入 | 逐字稿/復盤加密暫存；訪客及未選保存的場次依 TTL 清除。登入者可逐場 opt-in 保存私人歷史並匯出/刪除；匿名心得獨立保存、經審核後進 RAG。PostgreSQL adapter 尚未接入。 |
| 傳輸方式 | 已實作 | REST 命令搭配可重播 SSE 事件。 |

三位教授是 VivaPrep 的模擬角色，不是真實教授，也不代表逢甲一般申請正式面試固定有三位教授。此設定用來練習不同面向。

## 2. 元件責任與流程

1. Interview API 收到前端命令。
2. Interview Orchestrator 取得 profile 和篩選後的來源片段。
3. Panel Coordinator 依回答主題與輪替選一位角色；Gemini 使用精簡 schema 生成一個候選問題，CLI 模式使用 Flash low 並重用該場獨立對話。
4. Panel Coordinator 驗證輸出、去除不合格候選，再以程式規則選一位發言。
5. 後端保存 turn、assessment 和 interview event，將 UI 事件送到前端。
6. 面試結束後，Review Agent 根據完整逐字稿、所選教授的各面向及可選的計算指標產生復盤；不宣稱場中已有三份独立評語。

Agent 產生候選問題、逐題觀察和復盤文字。程式控制面試狀態、發言權、輪替、計時、重試、事件順序和 schema 驗證。RAG 提供有來源標籤的上下文，不由 Agent 自行搜尋網路或自行擴張校系規則。原始媒體不預設保存。

## 3. 四個 Agent 的設計

### 3.1 備審與個人貢獻教授

角色 ID：portfolio。

- 從學生已確認的備審主張出題。
- 釐清學生負責的部分、方法、困難、結果和反思。
- 主張缺少具體例子時追問細節，不自行補成學生做過的事。
- 不因履歷亮眼就推斷能力，不把未確認的 PDF 抽取內容當事實。

### 3.2 資工概念與推理教授

角色 ID：technical。

- 針對學生自己提到的技術或概念，詢問定義、原理、複雜度、取捨或實例。
- 從已確認主張延伸，例如演算法、資料結構或專題技術。
- 答案不完整時提出一個可回答的釐清問題，不用陷阱題製造壓力。
- 不假設學生熟悉未提到的進階內容，不把跨校心得說成逢甲規則。

### 3.3 動機與反思教授

角色 ID：motivation。

- 了解選系原因、學習方法、挫折後的調整、反思和下一步規劃。
- 追問學生如何從經驗形成判斷，以及選擇和其自述目標是否一致。
- 不推斷人格、家庭背景或心理狀態；不把特定人生經歷當成標準答案。

### 3.4 面試後統整 Agent

角色 ID：review；只在使用者結束面試後執行。

輸入：逐字稿與題目、三位教授的逐題觀察、來源標籤、學生確認過的備審主張，以及可選且經同意的程式計算指標。

輸出：整體共識、不同觀察面向、有逐字稿證據的優點與待改善處、一至兩項優先練習建議、具體練習題與完成檢核方式、來源依據和資料限制。

限制：不可重算視覺／音訊指標、不可預測錄取結果、不可只憑單一數字排序學生。資料不足時標示「無法判讀」。

## 4. 協調規則與 Agent 輸出

每次收到回答後，Panel Coordinator 先依回答主題及近期輪替選一位教授，該角色只回傳下一題、實際提問重點、對話動作與來源 ID。程式檢查重複與長度。CLI 對每場使用獨立的串流對話，低思考 Flash 產生短問題；其他場次不共用模型對話。面試後再由 Review Agent 依所選教授面向分析完整逐字稿。

現場不等待另外兩份評語。候選題重複時最多再生成一次新話題；仍失敗時回傳可重試錯誤。CLI 單次現場呼叫上限 25 秒，對話空閒三分鐘釋放程序，結束或刪除時關閉。接受當回合 finish 或當回合 response JSON，防止 CLI 回傳上一回合 structured_output。實際說話與學生思考／回答算練習時間，模型等待、辨識與合成準備不算。面試階段、時間和結束條件由程式管理。

現場 Gemini JSON schema 為 candidateQuestion、questionFocus、dialogueAction、sourceRefs。後端為相容舊版紀錄，保留以下 assessment 欄位；未產生的分析維持空值，不補造評語：

| 欄位 | 型別與用途 |
|---|---|
| agentId | portfolio、technical 或 motivation。 |
| assessment | 一至兩句內部觀察，連結回答證據。 |
| rubricDimension | 本輪著重的評量面向。 |
| evidenceRefs | turnId 和短引文或文字範圍；沒有證據時為空。 |
| candidateQuestion | 候選發言；不適合時為 null。 |
| questionIntent | 問題希望釐清的內容。 |
| sourceRefs | 使用到的官方或心得來源 ID。 |
| confidence | low、medium、high；代表觀察信心，不是學生能力分數。 |
| limits | 來源不足、回答過短、轉錄不確定等限制。 |

被選問題還需通過長度、重複度、來源語義和禁用主張檢查。Agent 不輸出標準答案。Review Agent 使用 summary、sharedStrengths、improvementPriorities、perspectiveDifferences、practiceDrill、evidenceRefs、sourceRefs、dataLimits 等欄位；每項回饋需有逐字稿證據，或標示為練習建議。

## 5. Prompt 與 CLI 呼叫邊界

Prompt 固定由以下部分組成：

1. 全域規則：練習角色、繁體中文、不得捏造校系規則或學生經歷、隱私和適合未成年人的語氣。
2. 校系 profile：學校、系所、學年度、招生管道、已確認規則與未知項目。
3. Agent role card：本角色負責的評量維度與不負責事項。
4. 學生主張：只傳使用者確認可用於本場的欄位。
5. 檢索片段：來源 ID、來源類型、年份、管道、摘要和信心。
6. 對話狀態：階段、必要的最近題目與回答、已問問題、時間和輸出 schema。

使用者答案、備審摘要和心得都是資料，不是系統指令。即使內容要求忽略規則，也不能改變 Agent 行為。Prompt 不放不必要的原始備審全文或原始影音。

Antigravity CLI 使用 headless 單次 prompt 呼叫；模型、推理 effort、timeout 和 JSON schema 從設定管理。每位教授的提示和輸入明確傳入，不共用全域續接狀態，以免不同學生或角色互相污染。使用 CLI JSON 與 JSON schema 輸出，後端仍需自行驗證欄位、長度和政策。

不要啟用危險地略過權限的選項。Headless CLI 可帶有檔案與其他工具能力；正式 provider 應使用隔離的空白工作目錄和最小工具設定，不把機密檔案放進工作目錄。若安裝版本無法限制工具，先不要讓它直接處理正式學生資料。Provider 負責 timeout、stdout/stderr 區分、退出碼、usage 記錄、重試上限與取消；錯誤不重複提交個資。

模型 slug 候選為 gemini-3.8-flash-medium；啟動或部署檢查時確認 CLI 版本與可用模型。未知 slug 不得靜默改用其他模型。參考 [Antigravity CLI headless 文件](https://www.antigravity.google/docs/cli/headless/)。

## 6. 校系 Profile 與 RAG

### 6.1 混合式檢索

校系固定資訊放在結構化 profile；心得和題型主題放在可追溯來源記錄。Agent 同時收到「已確認事實」和「可能情境」，不得混為一類。

首版不必先建向量資料庫。先以標籤、關鍵詞和少量人工整理的摘要檢索；來源量增加且有檢索品質量測後，再評估向量索引。不要把整份文件無差別塞進每個 prompt。

### 6.2 Profile 欄位

每個 profile 至少包含 schoolId、departmentId、academicYear、admissionRoute、displayName、interviewFormat、officialPanelSize、profileStatus、officialFacts、unknowns、sourceIds、lastVerifiedAt 和 version。官方教授人數未知時 officialPanelSize 為 null。

逢甲資工一般申請 profile 不引用 APCS 招生簡章作一般申請規則。三位教授只代表 VivaPrep 模擬設定。

### 6.3 SourceRecord 欄位

| 欄位 | 用途 |
|---|---|
| sourceId | 穩定識別碼。 |
| sourceType | official_rule、official_rubric、first_person_report、cross_school_report、model_generated 之一。 |
| schoolId、departmentId、academicYear、admissionRoute | 精確過濾來源適用範圍；不適用者可為 null。 |
| stage、interviewDate、publishedAt、collectedAt | 面試階段、事件／發布與收錄時間。 |
| url、title、excerpt、summary | 可回查來源；只保留必要摘要，不複製整篇受著作權保護內容。 |
| isFirstHand、reportCount、confidence | 區分第一手、佐證數和信心。單一心得仍只是一份回報。 |
| reviewStatus、consentStatus、deidentificationStatus | 審核、同意與去識別化處理狀態；不得用布林值宣稱「已保證匿名」。現有 prototype 的 anonymized 欄位需在 migration 時映射為待人工確認的舊資料狀態。 |
| claimType | fact、reported_experience、topic_pattern 或 generated_practice。 |

### 6.4 檢索順序與引用規則

1. 先取逢甲資工、115 學年度、一般申請的官方來源。
2. 同校系同管道第一手心得只補充「有人曾如此經歷」；顯示年份、心得數和信心，不說成固定流程。
3. 同校系心得不足時，才取同校不同年度同管道資料，並標示為舊資料。
4. 再不足時，跨校資工資料只用於一般資工題型練習，不陳述逢甲流程、教授人數或正式規則。
5. APCS 和一般申請是不同管道，不互相回退。
6. 生成題一律標示 model_generated／generated_practice，永不變成真實心得證據。

每個面試事件保存實際使用的 sourceRefs。官方來源和心得衝突時保留差異、年份與管道；Agent 不替衝突做無根據推測。

### 6.5 種子資料現況

規劃書已列逢甲資工 115 一般申請與 115 APCS 官方面試指引，以及交大資工 APCS、中央資電和資訊工程學群心得來源。匯入前仍須正規化成 SourceRecord，明確標示一般申請、APCS 或跨校類型。使用者提供的三場逢甲經驗也拆成各自紀錄；DP／Big-O 若管道未確認，先標記招生管道未知，不放進一般申請事實集。

本機 references 目前只有 UI 概念圖；規劃書所列來源還不是已審核的本機 RAG 資料庫。

## 7. 使用者資料飛輪

流程：使用者選擇分享真實經驗 → 告知用途並取得獨立同意 → 去識別化與欄位整理 → 檢查招生年度／管道／來源資訊 → 審核 → 通過後版本化存入 SourceRecord → 依 profile 標籤供後續 session 檢索。

- 練習回答和原始備審預設只屬於該使用者；參與面試不代表同意分享。
- 真實面試回報和模型生成問題分開保存。
- 只有 reviewStatus 為 approved 且分享同意有效的回報進入共用 RAG。
- 樣本少時顯示「一份心得提及」，不稱熱門題或常見規則。
- 支援撤回分享；撤回後從共用檢索資料移除或停用。
- 不以錄取結果作單一品質標籤，也不推斷回答造成錄取或落榜。

## 8. 後端元件與 API 契約

server.mjs 使用 Node 內建 HTTP 實作本機 API 與靜態檔案服務。模型呼叫只能在後端執行；Gemini／CLI 認證不能放入瀏覽器。

| 元件 | 職責 |
|---|---|
| InterviewAPI | 驗證請求、送出 session 命令與事件。 |
| InterviewOrchestrator | 管理狀態機、階段、時限、回合記錄和錯誤處理。 |
| ProfileRepository | 讀取版本化校系 profile。 |
| SourceRetriever | 依校系／學年度／管道先過濾，再選有限來源片段。 |
| PanelCoordinator | 選唯一發言教授、避免重複問題並維持輪替。 |
| AntigravityCliProvider | 組 prompt、呼叫 CLI、解析結構化輸出、限制 timeout。 |
| MetricsAnalyzer | 由程式計算經同意的音訊／視覺描述指標，不由 LLM 補算。 |
| SpeechToTextAdapter、TextToSpeechAdapter | 將音訊轉逐字稿、將考官文字轉語音；可替換供應商。 |
| ReviewService | 結束後叫用 review Agent，組成有證據的復盤。 |
| SQLite / SessionStore | 暫存 session、turn、agent assessment、event 和 review；使用 schema version 與 SQLite user_version migration。 |

### 建議 API

| 方法與路徑 | 用途 |
|---|---|
| POST /api/sessions | 建立 session。傳入 profileId、面試時間／模式、captionsEnabled、seed 和使用者確認過的 resumeClaims；不要傳未確認的整份備審。 |
| POST /api/sessions/{sessionId}/answers | 傳入 clientTurnId、text、submittedAt。可回 202 Accepted 和 turnId；前端顯示 considering，稍後收到下一個考官事件。 |
| GET /api/sessions/{sessionId}/events | SSE 傳送介面所需事件，不公開教授內部推理或完整 prompt。 |
| POST /api/sessions/{sessionId}/finish | 結束場次並啟動復盤。 |
| GET /api/sessions/{sessionId}/review | 讀取復盤或處理狀態。 |
| GET /api/profiles/{profileId} | 提供校系摘要、來源覆蓋度和最後查核日期。 |
| POST /api/portfolio/parse | 獨立同意後處理單份 8 MB 以下 PDF；CLI 模式只把 PDF.js 抽取的文字交給 CLI，API 模式使用 inline PDF；回傳候選主張、頁碼與摘錄。 |

SSE 對外事件建議包含 session.ready、interview.event、session.ended、review.ready 和 error。語音模式由 STT adapter 先取得逐字稿；原始音訊不隨一般答案記錄保存。若要保存原始音訊，另設明確同意與保存期限。

### 前端 interview.event 欄位

| 欄位 | 範例值 | 說明 |
|---|---|---|
| type | interview.event | 事件種類。 |
| seq | 12 | session 內遞增序號。 |
| sessionId、turnId | session-id、turn-id | 場次與回合識別碼。 |
| phase | follow_up | 沿用前端階段。 |
| speakerId | interviewer-b | 沿用前端座位識別。 |
| roleId | technical | 對應教授職責。 |
| utterance | 你提到用動態規劃，能說明狀態如何定義嗎？ | 字幕／考官文字。 |
| action | speaking | 前端角色動畫狀態。 |
| durationMs、seed、captionsEnabled | 5200、2718、true | 沿用 UI 規格欄位。 |
| sourceRefs | source-fcu-115-general | 可追溯來源 ID。 |

前端現有 speakerId 沿用 technical、portfolio、logic：roleId portfolio 對應 portfolio，technical 對應 technical，motivation 對應 logic。

## 9. 核心資料物件

| 物件 | 核心欄位 |
|---|---|
| InterviewSession | sessionId、profileId、profileVersion、academicYear、admissionRoute、mode、phase、seed、consentSnapshot、startedAt、endedAt。 |
| TurnRecord | turnId、sessionId、sequence、speakerId、questionText、answerText、submittedAt、sourceRefs。 |
| AgentAssessment | turnId、agentId、rubricDimension、assessment、evidenceRefs、candidateQuestion、confidence、modelId、promptVersion。 |
| InterviewEvent | UI event 欄位、seq、createdAt、可見性與必要來源引用。 |
| ReviewReport | 建議、逐字稿證據、指標版本、modelId、promptVersion、createdAt。 |
| SourceRecord | 第 6.3 節所列來源與同意欄位。 |
| ConsentRecord | 依用途連結 userId/sessionId，或僅連結 reportId/revisionId；含用途、同意版本、選擇、時間和撤回時間。分享同意不得同時連結帳號或面試 session。 |

profile 和 session 的資料格式與 Agent／前端契約分離；本機 SQLite 保存加密 session snapshot，並將 turn、私人歷史、分享 revision、同意、角色和審核記錄正規化。登入與多使用者 owner check 已接入；正式 PostgreSQL、OIDC 與資料遷移仍依 [使用者帳號與匿名分享資料架構](使用者帳號與匿名分享資料架構.md) 執行。

## 10. 隱私與安全基線

- 模型憑證留在後端執行環境；瀏覽器只呼叫 VivaPrep API。
- 每次 prompt 只傳必要上下文；保存 modelId、promptVersion、來源 ID、schema 驗證結果和必要 usage，不把 CLI stderr 的敏感資料寫入一般 log。
- 預設不保存原始音訊、影片或備審檔案；逐字稿保存與否、保存多久，需在產品資料政策定稿。
- 使用者資料不進入共用 RAG，除非對分享真實面試經驗另行 opt-in。
- 分享報告不得帶入帳號 user_id、email 或 interview session id；UI 用「去識別化/不顯示姓名」描述，不保證絕對匿名。只有已同意、已審核、未撤回/未到期的目前 revision 可供 RAG 使用。完整流程、schema、權限和撤回要求見 [使用者帳號與匿名分享資料架構](使用者帳號與匿名分享資料架構.md)。
- 來源、心得及使用者文字都是不可信內容，不能當成 CLI 指令或工具權限設定。
- 模型、STT 或 TTS 失敗時提供文字模式或重試；不得把失敗偽裝成已完成的復盤。

## 11. 分階段實作

| 階段 | 交付 |
|---|---|
| P0 契約與 mock provider | 已完成本機 prototype；mock 流程可用。 |
| P1 CLI 文字面試 | 已完成 adapter 和流程接線；仍需在部署環境確認 CLI 登入、模型 slug、配額和權限。 |
| P2 結束復盤 | 已完成；單段最多六回合，遇到輸入容量上限會提早分段；整份逐字稿分析後統整，引文對照原始回合驗證。 |
| P3 儲存和 RAG | SQLite repository 已接入：schema v3、精確標籤檢索、官方來源表、分享報告 revision 和撤回 gate；PostgreSQL/pgvector 與正式來源擴充待部署。 |
| P4 回合制語音 | 已完成可選 STT/TTS adapter 與同意接線；真實服務需設定 API key，繁中品質、延遲和費用尚未做部署驗證。 |
| P5 資料飛輪 | 分享預覽、PII 常見識別資訊遮罩、獨立同意、pending、角色+MFA 審核、HMAC 撤回碼與 RAG 停用已接入；自動掃描不保證匿名，外部向量刪除 worker 待部署。 |
| P6 帳號與隱私 | 本機 email/password、驗證/重設、session/CSRF、owner check、私人歷史 opt-in、匯出/刪除、個資申請、TOTP MFA 和管理 UI 已接線；OIDC/PostgreSQL production adapter 尚未完成。 |

## 12. 待定項目

以下是正式部署或擴充前仍需定案的事項，不阻擋本機功能檢視。帳號與分享資料模型及安全基線已在專門文件整理，仍需按部署選項定參數：

1. Antigravity CLI 部署環境、登入／配額、可用模型 slug、併發上限與正式資料使用權限。
2. 依 [使用者帳號與匿名分享資料架構](使用者帳號與匿名分享資料架構.md) 選定 OIDC Provider、正式 PostgreSQL/部署地區、未成年使用者政策、保留期限、郵件 provider、備份/還原和資料遷移方式；本機版本使用 SQLite 與 email/password，尚未做正式部署切換。
3. Gemini STT/TTS 在目標環境的可用性、繁中品質、延遲和費用；目前已有 adapter，但未以真實憑證呼叫。
4. 115 學年度更新到下一屆的來源查核與 profile 版本維護流程。
5. DP／Big-O 個人經驗所屬招生管道；未確認前標為 route unknown。
6. 三位教授並行呼叫的延遲／配額預算，以及必要時改為只呼叫相關 Agent 的策略。

## 13. 依據與相關文件

- 前端 UI 與既有事件欄位：[UI_設計規格與前端生成任務.md](UI_設計規格與前端生成任務.md)
- 產品流程與校系資料源：[VivaPrep_大學申請面試模擬系統_初步規劃書.md](VivaPrep_大學申請面試模擬系統_初步規劃書.md)
- 多模態復盤原則：[VivaPrep_多模態表現分析Agent設計與調研.md](VivaPrep_多模態表現分析Agent設計與調研.md)
- Antigravity CLI headless：[Google Antigravity 文件](https://www.antigravity.google/docs/cli/headless/)
- Gemini 3.8 Flash 能力：[Google 模型頁](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash/)
- Live、Transcribe、TTS 更新：[Gemini API 官方更新紀錄](https://ai.google.dev/gemini-api/docs/changelog)
- Antigravity CLI Voice Dictation 限制：[Google 文件](https://www.antigravity.google/docs/cli/commands/voice/)

## 14. 首版實作現況與操作邊界（2026-09-26）

### 已實作

- AgentService 包含 portfolio、technical、motivation 三個教授角色和 review 統整角色。教授分析可並行，但 PanelCoordinator 只讓目前 roster 中一位教授發言；沒有場中第四位主持 Agent。
- AntigravityCliProvider 透過 headless 單次呼叫輸出 schema JSON；工作目錄使用暫存子目錄，執行 sandbox，不延續其他 session 的模型上下文。Antigravity CLI 不在此開發環境的 PATH，所以預設 VIVAPREP_AGENT_MODE=mock；設為 cli 才會呼叫 Gemini。CLI 找不到、模型不可用或回覆無效時顯示錯誤，不會靜默改用 mock。
- 模型 slug 預設 gemini-3.8-flash-medium，從 ANTIGRAVITY_MODEL 覆寫；需在目標 CLI 版本用 agy models 確認，不應對未知 slug 自動降級。
- SSE 可從序號重播；答案處理失敗可用原答案重試。前端 speakerId 使用 technical、portfolio、logic，motivation 的 UI speakerId 是 logic。
- Review Agent 收到完整回答，不截掉長回答尾段；單段最多六回合，輸入達容量界線時提早分段。多段會再由統整 Agent 彙總。輸出引文只在原始 session turn 中逐字比對通過後保留；復盤失敗可由 `POST /api/sessions/:id/review/retry` 重試。
- session state 暫存於 .data/vivaprep.sqlite；結束或前端離開時刪除，未正常結束者依預設 1 小時 TTL 清除。伺服器重啟可恢復未過期場次；緩存的語音檔不寫入資料庫。Review 回到瀏覽器後保存在目前頁面的前端 state，session 刪除後不留跨場次歷史。
- STT/TTS 為分離的可選 Google adapter。STT 先上傳 Gemini Files API，辨識後要求刪除上傳檔；若刪除失敗，Files API 文件說明服務端最多保留 48 小時。TTS 使用 Gemini 3.8 Flash TTS，回傳 WAV。瀏覽器只有在設備頁同意後才傳送錄音。
- 資料飛輪只接受獨立分享同意且使用者確認不含識別資訊的摘要；先進入 SQLite 的 pending 狀態，管理員核准後才能進入來源檢索。若舊版 .data/reports.json 存在，啟動時會匯入；原檔保留備份。練習回答、錄音和備審檔不加入共用來源。
- 建立回報時只回傳一次性撤回碼；資料庫只保存撤回碼雜湊。使用者以 `POST /api/reports/:id/withdraw` 撤回後，摘要與檢索狀態停用，核准前後都可撤回。

### Profile 與目前來源

fcu-general 是可用官方來源的試點 profile，version 為 fcu-cs-general-115.1。115 學年度官方指引確認一般申請一關、面試 5 分鐘，以及學習態度與思考、邏輯表達和系所相關既有知識等觀察重點；官方文件未列面試委員人數。介面提供的 10／15／20 分鐘是延伸練習，不是正式場次長度。資料來源：[逢甲資工 115 學年度一般申請 PDF](https://webadmi.fcu.edu.tw/115/college/apply/2182-2/015252-4.pdf)。

fcu-apcs 和 ncu-eecs 保持 practice_only，不把 APCS 資料回退成一般申請規則。目前本機 RAG 只有 fcu-general 的兩筆官方來源；公開心得尚未正規化匯入。

### 本機設定

- 預設：本機 mock Agent，不呼叫 Gemini；SQLite 預設檔案為 .data/vivaprep.sqlite，VIVAPREP_DATABASE_PATH 可覆寫。
- 目前免 API key 的 Gemini 教授與備審文字整理：登入 Antigravity CLI 後設定 `VIVAPREP_AGENT_MODE=cli`（Windows 可執行 `npm run dev:agent`）；`ANTIGRAVITY_MODEL` 可覆寫 model slug，`ANTIGRAVITY_CLI_PATH` 可指定執行檔。PDF.js 在伺服器記憶體抽取頁面文字後分段交給 CLI；掃描頁／圖表不做 OCR 或視覺理解。
- Gemini API 教授與原生 PDF 解析：設定 `VIVAPREP_AGENT_MODE=gemini-api`、`GEMINI_API_KEY`；可用 `GEMINI_MODEL` 指定模型，預設 `gemini-3.8-flash`。面試處理與 PDF 解析分別取得同意；PDF 只在解析請求中 inline 傳送，不經 Files API。
- 語音：設定 VIVAPREP_SPEECH_MODE=gemini 和 GEMINI_API_KEY。此金鑰只放在後端環境。
- 管理員：設定 `VIVAPREP_BOOTSTRAP_ADMIN_EMAIL`，該信箱驗證後取得初始 admin；管理 API 要求 TOTP MFA 和後端 RBAC，不再使用共用管理員 token。
- 分享心得：`GET /api/reports/share-policy`、`POST /api/reports/preview`、`POST /api/reports`；審核：`GET /api/admin/reports` 和 `POST /api/admin/reports/:id/review`；撤回：`POST /api/reports/:id/withdraw`。分享正文不連結帳號/場次。
- .data/ 已加入 .gitignore；本機開發使用 SQLite。帳號和分享資料已持久化，但尚未切換 PostgreSQL、外部郵件/worker 或正式備份治理。

CLI 參考：[Antigravity headless mode](https://antigravity.google/docs/cli/headless/)。語音參考：[Gemini Transcribe](https://ai.google.dev/gemini-api/docs/transcribe)、[Gemini TTS](https://ai.google.dev/gemini-api/docs/speech-generation)、[Gemini Files API](https://ai.google.dev/gemini-api/docs/files)。

## 15. 實作更新（2026-09-27）

本節補充前一節在鏡頭摘要、語音執行路徑與來源檢索上的舊狀態；前一節其餘內容仍是 2026-09-26 的歷史快照。

- **來源檢索：**官方校系來源固定優先從 profile 取用，不會被心得來源擠出；有剩餘名額時才加入符合範圍的已審核心得。校系資料仍只有逢甲資工 115 一般申請試點。
- **鏡頭流程：**設備頁已有頭部與上半身虛線取景提示。使用者分別同意本機分析與把衍生數值交給 Agent；未同意前摘要留在頁面記憶體，原始影格永不傳到伺服器。Agent 每次只收到對應回合摘要，並被要求不得把頭部方向解讀成眼球注視、自信、焦慮或人格。數值尚未經人工標註驗證。
- **私人歷史：**在上述同意外，使用者須另選保存本場歷史；只有完成三項選擇時，衍生摘要才會隨私人場次加密保存。帳號歷史 API 只回傳摘要，不回傳原始影格或即時分析物件；同校系練習並列是描述性回看，不構成評分或進步結論。
- **語音：**流程為回合制而非 Gemini Live。Windows 可走本機 SAPI；也可設定 Gemini STT/TTS adapter，後者需要 API key 和額外資料處理同意。
- **Google 整合界線：**Gemini API 直接 provider 支援教授、復盤和原生 PDF 理解；Antigravity CLI 免 API key 路徑支援教授、復盤與 PDF 文字整理。已接入 MediaPipe 本機視覺元件。Gemini Live、Drive／Workspace 與 Google Cloud 部署尚未接入。
- **仍待確認：**鏡頭距離／光線提示、指標人工標註與品質門檻；其他校系官方來源；正式部署的 CLI 配額、OIDC、PostgreSQL、郵件、備份和未成年使用者政策。設計稿或其他 task/session 的計畫不能當作已完成實作。

## 16. 實作更新（2026-09-28）

- **Gemini 全流程：**Gemini API REST provider 可用 schema 輸出處理教授開場、逐題追問、停頓接話、分段復盤與統整；Antigravity CLI 可免 API key 執行同一套文字流程。任何非 mock provider 都要求面試模型處理同意。
- **備審 PDF：**前端選擇 PDF 不會立即上傳；CLI 模式經學生另行同意後，後端檢查簽章與 8 MB 上限，以 PDF.js 抽取文字並按頁分段交給 CLI，原始檔不落地、不傳給模型。掃描影像不含可擷取文字時會提示 OCR。API 模式保留 inline 原生 PDF。兩種模式都回傳主張、頁碼、摘錄和信心標籤，要求學生逐條核對及編輯。
- **線索接續：**學生確認主張後，頁碼與摘錄線索會和文字主張一起提供給場中 Agent 與復盤 Agent。線索被標示為回查提示，不代表第三方查證；原始 PDF 不進資料庫，摘錄不加入長期私人歷史 metadata。
- **尚待驗收：**尚未用實際 Antigravity CLI 和代表性備審 PDF 完成瀏覽器端到端核對；尤其需確認中文斷行摘錄命中率、模型分段速度和長文件體驗。進入決賽後可切換 API key，使用 Gemini 原生 PDF 路徑；Drive／Workspace、Gemini Live、Cloud 部署和其他校系來源仍未接入。
