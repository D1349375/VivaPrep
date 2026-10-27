# VivaPrep 競品差異化與 Google 整合論證

> 補充研究｜2026-09-26；實作狀態更新｜2026-09-28  
> 用途：供 VivaPrep 規劃書、競賽系統概述與簡報敘事使用。競品能力依其公開產品頁描述，未代表獨立試用或性能驗證。

## 一、結論先行

VivaPrep 的目標架構列有 Gemini Live API、Gemini API、Google Drive／Workspace，以及 Cloud Run／Firestore／Cloud Storage。**目前已接入 Antigravity CLI Gemini 教授 Agent、PDF.js 文字抽取後交 Gemini CLI 整理備審，以及 MediaPipe 本機鏡頭分析；Gemini API 原生 PDF 路徑也已保留。Live、Drive／Workspace 與 Google Cloud 尚未接入。**以下其他整合流程仍是選型提案，不能當成已完成實作：

1. 說明每項 Google 技術在使用者流程中完成什麼不可忽略的工作。
2. 說明可替代方案存在時，為什麼此案仍選 Google，並坦承哪些元件其實只是方便或基礎設施。

競賽鼓勵運用 Gemini 生態系、AI、Workspace、Cloud 等資源，官方評分也把 Google 整合列為初賽與決賽各 25%；簡章並沒有要求「只能使用 Google」或證明其他廠牌不能做到。因此，敘事不該宣稱技術上不可替代，應說清楚 Google 技術如何共同支援這個產品流程，為什麼符合需求，以及原型如何展示整合成效。[Google Gemini AI 生態系應用組說明與評分](https://innoserveawards.tca.org.tw/advertise26_metaage.htm)

**VivaPrep 目前最有潛力的競爭位置**是「台灣升學面試的來源可追溯、備審主張承接追問、逐題復盤和可比較重練」；Google 生態系的完整串接仍是待完成工作。多模態分析、Gemini 名稱或雲端服務本身都不是獨家差異，也尚未有對照測試證明 VivaPrep 已經勝過競品。

## 二、VivaPrep 規劃相較競品的優勢與界線

| 面向 | VivaPrep 規劃中的優勢 | 競品公開功能與重疊處 | 判斷 |
|---|---|---|---|
| 台灣校系／招生組別資料 | 明確設計學年度、校系、招生組別、資料類型、來源、年份、信心和最後核對日，並區分官方規則、考生心得與模型生成題。 | MIND 已有台灣個申二階、特殊選才等練習，也可貼校系／科班資料加練，並提供報告與學校輔導流程。Pallas 以學習歷程和個人化面試為核心。公開頁面不能證明競品沒有內部資料標註系統。 | **規劃上有機會做得更可追溯，但不能先說競品沒有。**要在 demo 中展示來源和信心如何改變題目與回饋。 |
| 備審主張到追問 | 把學生在備審寫下的專題、技術、個人貢獻轉成定義、證據、推理和反思等連續追問。 | Pallas 已主打從學習歷程 PDF 產生個人化問題；MIND 也提供升學情境追問。 | **「讀備審出題」已不是獨家。**更可區隔的是每一個追問都能回連到學生確認過的主張和校系規準。 |
| 復盤到重新訓練 | 已接上逐題復盤、練習建議與下一輪入口；私人歷史可保存完成場次，另有同意後的鏡頭摘要並列。尚無穩定的能力變化分數。 | MIND 有個人報告、重複練習和教師查看流程；Big Interview、Yoodli 都有影片／語音回饋及行為指標。 | **閉環已具原型，效果仍需試用者驗證。**「回饋連回答證據、再練後並列同版本摘要」比單次總分更值得展示；不主張造成能力改善。 |
| 視線、肢體、口語流暢度 | 計畫將程式量測與 LLM 解讀分開，並記錄逐題數據和個人趨勢。 | Big Interview 公開提供眼神、肢體、語速、贅詞等回饋；Yoodli 提供相機肢體／畫面置中回饋。MIND 企業面試方案也提及語氣、停頓與非語言訊號。 | **不能宣稱是新功能。**VivaPrep 的賣點應是這些訊號如何連到升學面試題目、改善練習和個人進步紀錄。 |
| 真實面試資料回報 | 規劃讓學生自願、匿名化回報真實面試流程與題型，帶來源與年份更新題型資料。 | 競品可能也會累積使用者與題庫資料；公開資訊不足以比較其資料規模或品質。 | **目前是待建立的資料飛輪，不是現有護城河。**需有參與者、審核、同意和更新流程後才可稱為優勢。 |

### 目前可以誠實主張的優勢

- **產品定位更聚焦在學生訓練。**資料、評量、回饋以升學準備為核心，不把練習分數包裝成招生端的候選人篩選結論。
- **企劃書對資料來源與證據鏈的設計較明確。**資料帶年份、校系、組別和來源類型；回饋能連回回答內容，這是可以在一場 demo 裡展示的規劃優勢。
- **已有初步多模態訓練閉環原型。**本機頭部方向代理值、涵蓋率與軀幹位移可在獨立同意後依回合交給復盤；保存歷史另需同意。尚未人工標註驗證，也沒有穩定的語速／眼神指標或能力變化分數。

### 目前不能先宣稱的事

尚未做過相同題目、相同備審、相同使用者條件下的競品對照，也未經輔導教師或考生驗證回饋品質。因此建議簡報說「我們的設計目標／初步原型能做到……」，避免說「比 MIND／Pallas／Big Interview 更準、更有效」。

## 三、規劃書中的 Google 技術：已列到什麼程度？

| 元件 | 現有規劃用途 | 建議保留嗎？ | 適合定位 |
|---|---|---|---|
| Gemini Live API | 即時語音面試、依回答進行追問。 | **保留，作為核心 Google AI 整合。** | 讓面試流程由非同步答題轉成即時、多輪、可打斷的對話。 |
| Gemini API | 讀取備審、抽取主張、產生追問和復盤。 | **保留，但要把任務講明確。** | 從 PDF 和文字中抽取可確認主張，再依校系規準輸出結構化資料與回饋。 |
| Google Drive／Workspace | 使用者授權匯入備審或校系資料。 | **作為可選整合；不要把 Drive 說成唯一匯入方式。** | 用戶端選取自己授權的檔案；也保留直接上傳 PDF 的方式。 |
| MediaPipe Tasks Vision | 瀏覽器端視覺特徵抽取。 | **已接入本機試測；同意後可將衍生摘要交給 Agent。** | 本機處理頭部方向、臉／姿勢涵蓋率和動作指標；原始影格不傳出。指標尚未人工標註驗證，也不是面試評分。 |
| Google Cloud／Cloud Run／Firestore | API 部署、使用者資料與練習紀錄。 | **視作品實際需要保留。** | Cloud Run 是服務部署，Firestore 可存逐題指標和個人進度；兩者都有替代產品，不應稱為獨家 AI 能力。 |
| Google Cloud Speech-to-Text | 現有規劃未列為必要元件。 | **先列為選配。** | Gemini Live 可提供即時逐段轉錄，但官方說 Live API 不提供字詞級時間戳；若需精準定位停頓／填充詞，才比較專用 STT 或本機 VAD。 |

## 四、逐項「為何選 Google」與替代方案取捨

### 1. Gemini Live：處理面試中的即時對話

**任務需求：**面試官要即時聽到回答、管理回合、在適當時機追問；使用者也可能打斷或要求重複。Gemini Live 支援低延遲串流對話、語音活動偵測、打斷處理與工具呼叫，可讓模型對話同時受 VivaPrep 的面試流程工具控制。[Gemini Live API 概覽與限制](https://ai.google.dev/gemini-api/docs/live-api/capabilities) · [Gemini API 工具呼叫](https://ai.google.dev/gemini-api/docs/tools)

**為何選它：**在這個設計裡，同一套 Gemini 生態系可承接已整理的備審上下文、即時語音回合和面試工具，不必在主持面試時再拼接互不相通的對話與語音服務。這是「減少整合環節、符合競賽 Google AI 主題」的選型理由。

**替代方案：**其他即時語音／對話 API 也能完成低延遲面試，並非技術上不能替代。若改用其他方案，要重新驗證繁中互動品質、回合控制、打斷處理、成本、延遲和逐字稿輸出，並多維護一段模型上下文整合。

**必要限制要誠實說：**目前 Live 轉錄提供語句層級結果，不支援詞級時間戳；因此可拿它做字幕與即時互動，不宜單靠它精算每個填充詞的位置。若要做詞級分析，應使用專用 STT 或本機 VAD／對齊流程，並驗證繁中結果。[Live transcription 功能與限制](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)

### 2. Gemini 文件理解：讀取學習歷程並形成可確認的主張資料

**任務需求：**學習歷程可能是 PDF，含文字、圖表、專題圖片和頁面排版；系統需要把內容整理成學生能確認的主張欄位，而非只做摘要。

**為何選它：**Gemini 文件理解可把 PDF 的文字、圖片、圖表和表格一起納入理解，並可要求結構化輸出。這適合把「專題名稱、個人貢獻、方法、成果、技術概念」轉成固定欄位，再交給學生確認，供 Live 面試 Agent 根據已確認的內容追問。[Gemini 文件理解](https://ai.google.dev/gemini-api/docs/generate-content/document-processing) · [Gemini 結構化輸出](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en)

**替代方案：**傳統 PDF parser／OCR 再串其他 LLM 也能做到。選 Gemini 的論據應是「在同一模型 API 中保留 PDF 圖文上下文並輸出規定 schema，減少 OCR、視覺理解和文字模型之間的交接」，而不是說其他模型讀不懂 PDF。必須用團隊常見的學習歷程樣本做實測，才能比較準確度。

### 3. Drive／Workspace：受控的個人資料匯入

**任務需求：**學生已將學習歷程或作品整理在自己的檔案空間；能直接選取已授權文件，可減少下載、轉存和找錯版本。

**為何選它：**Google Drive API 可以取得使用者授權的檔案內容，也能匯出 Google Docs 等 Workspace 文件。這使 Drive 可成為熟悉、可選擇的匯入入口。[Drive API 下載與匯出](https://developers.google.com/workspace/drive/api/guides/manage-downloads)

**替代方案：**直接上傳 PDF 仍可完成核心任務，對沒有使用 Google Drive 的學生也更友善。因此 Drive 是整合體驗的加值，不是 Gemini 推理不可缺少的依賴。用最小範圍權限，只讀使用者主動選取的檔案，不索取整個雲端硬碟存取權。

### 4. MediaPipe 本機視覺分析：量測，不讓雲端看完整影片

**任務需求：**需要量化鏡頭朝向代理指標、臉／肩部可見率和姿勢變化；復盤只需統計數據與片段時間，未必需要模型長時間處理整段影像。

**為何選它：**MediaPipe Tasks Vision 提供 Web／JavaScript 的 Face／Pose Landmarker，適合本機從鏡頭影格抽 landmarks 和姿勢訊號。推論完成後只交出同意使用的衍生統計給 Gemini 做解讀，可以減少原始視訊傳輸和保存。[Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) · [Pose Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

**替代方案：**OpenCV、其他邊緣視覺套件或雲端視覺模型也可以。選 MediaPipe 的理由是它在 Google AI Edge 生態中可於瀏覽器部署，且與作品的 Google AI 技術主軸一致；其偵測準確度和裝置效能仍需自行測試。這裡的 Google 選擇不代表其他視覺方案無法做到。

### 5. Cloud Run／Firestore：後端部署與量化歷程

**任務需求：**保護模型金鑰、保存逐題指標和版本、讓同一學生跨場次查看個人趨勢；若之後分享給輔導教師，必須由學生逐份授權。

**為何選它：**Cloud Run 可以承載伺服器 API，Firestore 可保存 session／answer／metrics 文件與版本資訊；它們可以支援本案規劃的個人化進步追蹤。這是雲端整合能力與開發部署便利的理由。

**替代方案：**Firebase 以外的託管資料庫、一般 SQL 資料庫或本機儲存都可完成部分功能。因此它們是產品架構的選擇，不是不可替代的模型能力。若競賽 demo 只需單一使用者本機趨勢，不必為了名詞硬加所有 Cloud 元件；若使用 Cloud，就要展示真實資料流、權限和刪除功能。

## 五、建議用於企劃書／簡報的整合敘事

### 架構故事

```text
學生在 Drive 選取並授權學習歷程
        ↓
Gemini 理解 PDF 圖文，將經歷抽成學生確認的主張與證據
        ↓
Gemini Live 根據校系規準即時進行語音面試與承接追問
        ↓
MediaPipe 在瀏覽器端分析鏡頭朝向代理訊號和姿勢變化
        ↓
程式產生可量化指標；Gemini 依逐字稿、rubric 和時間戳做復盤
        ↓
Firestore 保存同意保留的逐題指標與版本，供學生比較重練結果
```

這條整合的產品價值是把校系文件、學生備審、即時面試、可觀察的表達數據和後續練習接在同一條教育流程上。Google 技術在各步驟各司其職，使用者能看到 Drive 檔案如何變成面試追問，也能看到練習數據如何回到個人進步報告。

### 可直接放進規劃書的技術選型文字

> VivaPrep 選擇 Google 生態系，是因為作品需要把學習歷程文件理解、即時口語面試和多次練習追蹤接成同一條升學準備流程。學生可選擇授權 Drive 文件；Gemini 將 PDF 圖文內容整理成由學生確認的經歷主張；Gemini Live 依這些主張和校系評量依據主持即時追問；MediaPipe 在瀏覽器端抽取鏡頭朝向與姿勢變化等描述性數據，再由 Gemini 結合逐字稿及評量規準產生有證據的練習回饋。Cloud Run／Firestore 保存選擇保留的逐題指標與版本，讓學生比較自己的重練歷程。各項技術都有其他可行選項；本案選用 Google，是因為它能支援這條多模態工作流程並直接對應競賽主題，而非宣稱其他方案無法達成同一功能。

## 六、demo 應該怎麼證明整合不是掛名

只跑 API 名稱或展示架構圖不足以證明整合。簡報 demo 建議使用一份已同意或虛構的學習歷程，完整演示：

1. 使用者選取 Drive 文件，明確確認匯入範圍。
2. Gemini 抽取一項專題主張，顯示出處／頁面，學生可更正。
3. Gemini Live 根據這項主張追問個人貢獻，並承接回答再追問一次。
4. 視覺分析在本機運作；介面指出有效涵蓋率，資料不足時不冒充分數。
5. Gemini 依逐字稿、面試規準與程式指標提供一項有時間點的建議。
6. Firestore 保存指標和算法版本；第二次練習後呈現個人指標改變，明示只有示範樣本、沒有統計成效結論。

## 七、調整現有技術主張時的注意事項

- 不把所有 Google 元件說成必要。Live 和 Gemini 文件理解支援作品核心流程；Drive 是匯入選項；Cloud 是部署／持續紀錄方式。
- 如使用 Gemini Live 的轉錄，逐字稿可供即時顯示和復盤，但詞級時間戳不支援。若要量填充詞或詞級定位，加入專用 STT 或本機 VAD，並實際比對繁中精度。
- 即時音訊與即時影音 API 的 session 限制不同。VivaPrep 的分析設計已採本機 MediaPipe，因此面試互動以音訊 Live 為主；不要把完整視訊串流到 Live API 當必要架構。[Live API 能力與限制](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- 所有模型與指標都提供「資料不足／不適用」狀態。模型流暢地生成評語不等於評語已被教師或考生驗證。
- 對外使用「預計支援」或「原型展示」描述尚未完成的 Google 整合。完成實際資料流後，才能主張作品已整合該服務。

## 參考來源

- [InnoServe Google Gemini AI 生態系應用組說明、主題與評分](https://innoserveawards.tca.org.tw/advertise26_metaage.htm)
- [MIND Education 升學面試練習](https://education.mind-interview.com/zh-TW/education-practice/)
- [Pallas Interview](https://pallas-interview.com/)
- [Big Interview 線上模擬面試](https://www.biginterview.com/platform/practice-with-interview-simulator)
- [Yoodli 練習說明](https://support.yoodli.ai/en/articles/9550465-practice-with-yoodli)
- [Gemini Live API 能力與限制](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Gemini Live transcription](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe)
- [Gemini 文件理解](https://ai.google.dev/gemini-api/docs/generate-content/document-processing)
- [Gemini 結構化輸出](https://ai.google.dev/gemini-api/docs/generate-content/structured-output?hl=en)
- [Google Drive API 下載與匯出](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
- [MediaPipe Face Landmarker Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [MediaPipe Pose Landmarker Web](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
