const app = document.getElementById("app");
const toast = document.getElementById("toast");
const profiles = [
  { id: "fcu-general", school: "逢甲大學", dept: "資訊工程學系", route: "個人申請・一般組", tag: "資訊工程", confidence: "示範情境", icon: "⌘" },
  { id: "fcu-apcs", school: "逢甲大學", dept: "資訊工程學系", route: "個人申請・APCS 組", tag: "APCS", confidence: "示範情境", icon: "⌘" },
  { id: "ncu-eecs", school: "中央大學", dept: "資訊電機工程學系", route: "個人申請・一般模擬", tag: "資訊電機", confidence: "一般模擬", icon: "◌" },
];
const interviewers = {
  technical: { id: "technical", name: "林教授", role: "專題與工程實作", trait: "精準、重視你實際做過什麼", cue: "翻看專題紀錄", image: "/assets/interviewer-technical.png", color: "copper" },
  portfolio: { id: "portfolio", name: "陳教授", role: "備審與學習歷程", trait: "耐心、會從你的經歷找到線索", cue: "翻閱備審資料", image: "/assets/interviewer-portfolio.png", color: "sage" },
  logic: { id: "logic", name: "周教授", role: "邏輯、動機與反思", trait: "好奇、喜歡沿著想法多問一步", cue: "提出延伸追問", image: "/assets/interviewer-logic.png", color: "blue" },
};
const panels = [
  { id: "balanced", title: "完整評估團", subtitle: "作品 × 學科 × 動機", count: "3 位", desc: "三種角度輪流提問，適合完整模擬。", people: ["technical", "portfolio", "logic"], icon: "✳" },
  { id: "technical-pair", title: "技術追問組", subtitle: "專題 × 邏輯", count: "2 位", desc: "集中練習作品細節、推理與概念追問。", people: ["technical", "logic"], icon: "⌘" },
  { id: "warmup", title: "暖身對談", subtitle: "備審 × 動機", count: "1 位", desc: "先和一位考官練自我介紹與選系動機。", people: ["portfolio"], icon: "◒" },
];
const questions = [
  { topic: "自我介紹", role: "portfolio", text: "請用一分鐘介紹自己，並說說你為什麼想申請這個學系。" },
  { topic: "備審追問", role: "technical", text: "請說明這個專題中你負責的部分，以及遇到最大的挑戰。" },
  { topic: "推理與選擇", role: "logic", text: "如果重新做一次這個專題，你會優先改變哪個決定？為什麼？" },
  { topic: "學科概念", role: "technical", text: "你提到演算法，可以用自己的話說明 Big-O，並舉一個你用過的例子嗎？" },
  { topic: "面試收尾", role: "portfolio", text: "今天的面試先到這裡。你有沒有問題想問我們？" },
];
const steps = [
  ["profile", "選擇校系", "面試情境"], ["resume", "整理備審", "主張確認"],
  ["setup", "設定練習", "考官與流程"], ["device", "設備檢查", "開始前準備"],
  ["interview", "模擬面試", "進入面試室"], ["review", "逐題復盤", "下一輪練習"],
];
const state = {
  page: "home", profileId: "fcu-general", fileName: "", fileSize: "",
  claims: [
    { id: "c1", text: "我在校園借閱系統專題中負責資料處理與搜尋功能。" },
    { id: "c2", text: "我透過自學演算法，嘗試用動態規劃改善問題解法。" },
  ],
  config: { duration: 15, mode: "voice", captions: true, timer: true },
  panel: "balanced", people: [...panels[0].people], seed: 260926,
  q: 0, answers: [], schedule: [], elapsed: 0, muted: false,
  confirmEnd: false, stream: null, deviceReady: false, toastTimer: null,
};
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const profile = () => profiles.find((p) => p.id === state.profileId) || profiles[0];
const activePeople = () => state.people.map((id) => interviewers[id]).filter(Boolean);
const currentQuestion = () => questions[Math.min(state.q, questions.length - 1)];
const elapsedText = () => Math.floor(state.elapsed / 60).toString().padStart(2, "0") + ":" + (state.elapsed % 60).toString().padStart(2, "0");
function notify(message) {
  toast.textContent = message; toast.classList.add("is-visible"); clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2500);
}
function stopMedia() {
  if (state.stream) state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null; state.deviceReady = false;
}
function go(page) {
  if (state.page === "device" && page !== "device") stopMedia();
  state.page = page; state.confirmEnd = false; render(); window.scrollTo({ top: 0, behavior: "smooth" });
}
function sideNav() {
  const current = steps.findIndex((s) => s[0] === state.page);
  return `<aside class="sidebar"><a class="brand-lockup" href="#" data-action="home"><span class="brand-mark">V</span><span><strong>VivaPrep</strong><small>面試練習室</small></span></a>
  <div class="sidebar-label">我的練習</div><button class="nav-home ${state.page === "home" ? "is-active" : ""}" data-action="home"><span class="nav-home-icon">⌂</span>練習總覽<span class="nav-chevron">›</span></button><div class="sidebar-label sidebar-label-spaced">準備流程</div>
  <ol class="workflow-nav">${steps.map((s, i) => { const done = current > i || state.page === "review", here = state.page === s[0]; return `<li class="${here ? "is-current" : ""} ${done ? "is-done" : ""}"><button data-action="step" data-page="${s[0]}" ${done || here ? "" : "disabled"}><span class="step-number">${done ? "✓" : String(i + 1).padStart(2, "0")}</span><span class="step-copy"><strong>${s[1]}</strong><small>${s[2]}</small></span></button></li>`; }).join("")}</ol>
  <div class="sidebar-spacer"></div><div class="privacy-note"><span class="privacy-mark">◈</span><div><strong>你的資料留在本機</strong><p>此原型不會上傳備審檔案或面試紀錄。</p></div></div><div class="sidebar-footer"><span class="status-dot"></span> 示範版・校系資料尚未核對</div></aside>`;
}
function header() {
  const index = steps.findIndex((s) => s[0] === state.page);
  const title = { home: "個人申請・練習工作台", profile: "選擇校系情境", resume: "整理備審內容", setup: "設定面試情境", device: "設備檢查", review: "面試復盤" }[state.page] || "VivaPrep";
  return `<header class="topbar"><div class="topbar-left">${state.page === "home" ? `<span class="eyebrow">${title}</span>` : `<button class="back-link" data-action="back">← <span>返回</span></button><span class="topbar-divider"></span><span class="eyebrow">${title}</span>`}</div><div class="topbar-right">${index >= 0 ? `<div class="progress-pill"><span>準備進度</span><strong>${Math.max(1, index + 1)} <i>/ 6</i></strong></div>` : ""}<div class="profile-chip"><span class="profile-avatar">YU</span><span>我的練習</span></div></div></header>`;
}
function shell(content, klass = "") {
  document.body.classList.remove("is-interview");
  return `<div class="app-shell">${sideNav()}<main class="main-column ${klass}">${header()}<div class="page-content">${content}</div></main></div>`;
}
function intro(n, title, desc) {
  return `<div class="step-intro"><div class="eyebrow accent">STEP 0${n + 1} / 06</div><h1>${title}</h1><p>${desc}</p><div class="step-progress">${[0,1,2,3].map((i) => `<span class="${i <= n ? "is-filled" : ""}"></span>`).join("")}</div></div>`;
}
function homePage() {
  const p = profile();
  return `<section class="welcome-row"><div><div class="eyebrow accent">星期一・練習計畫</div><h1>把準備過的經歷，<br /><em>說成清楚的回答。</em></h1><p>先整理備審中的主張，再練習教授可能如何追問。</p><button class="button button-primary button-large" data-action="step" data-page="profile">開始一場模擬 <span>→</span></button></div><div class="welcome-illustration"><div class="sun-disc"></div><div class="arch"></div><div class="table-line"></div><div class="plant plant-one">✳</div><div class="plant plant-two">✳</div><div class="illustration-caption"><span>01</span><span>一步一步，練習自己的故事</span></div></div></section>
  <div class="section-heading"><div><span class="eyebrow">YOUR NEXT STEP</span><h2>準備好開始了嗎？</h2></div><button class="text-link" data-action="step" data-page="profile">查看完整流程 <span>→</span></button></div>
  <section class="dashboard-grid"><button class="next-card" data-action="step" data-page="profile"><span class="card-icon card-icon-warm">↗</span><span class="card-meta">預計 3 分鐘</span><strong>挑選練習校系</strong><small>從目標校系開始，建立適合你的提問情境。</small><span class="card-arrow">→</span></button><article class="last-session-card"><div class="section-heading small-heading"><div><span class="eyebrow">練習設定</span><h3>目前的情境</h3></div><span class="session-dot"></span></div><div class="mini-profile"><span class="mini-school-mark">F</span><div><strong>${p.school}・${p.dept}</strong><small>${p.route}</small></div></div><div class="session-foot"><span>語音練習</span><span>·</span><span>三位考官</span><button data-action="step" data-page="profile">›</button></div></article><article class="trust-card"><span class="trust-star">✳</span><div><strong>練習，不是預測</strong><p>VivaPrep 幫你準備表達，不預測錄取結果，也不代表校系官方流程。</p></div></article></section>
  <section class="approach-row"><div><span class="eyebrow">VIVAPREP METHOD</span><h2>不是背題庫，<br />而是練習回答自己的故事。</h2></div><div class="approach-steps"><div><span>01</span><strong>準備</strong><small>整理備審主張</small></div><i>→</i><div><span>02</span><strong>練習</strong><small>回應有根據的追問</small></div><i>→</i><div><span>03</span><strong>復盤</strong><small>帶著下一步再練</small></div></div></section>`;
}
function profilePage() {
  const p = profile();
  return intro(0, "先選一個想練習的校系", "練習資料以示範情境為主。來源尚未核對的資訊會清楚標示，不會當作校系官方流程。") +
  `<div class="two-column-layout"><div class="profile-list">${profiles.map((x) => `<button class="profile-card ${p.id === x.id ? "is-selected" : ""}" data-action="profile" data-id="${x.id}"><span class="school-monogram">${x.icon}</span><span class="profile-card-copy"><span class="profile-tag">${x.tag}</span><strong>${x.school}</strong><b>${x.dept}</b><small>${x.route}</small></span><span class="radio-mark">${p.id === x.id ? "✓" : ""}</span></button>`).join("")}<button class="profile-add-card" data-action="toast"><span>＋</span><span><strong>找不到你的校系？</strong><small>之後可自行建立一般模擬情境</small></span><i>↗</i></button></div><aside class="profile-detail-card"><div class="detail-top"><span class="detail-kicker">情境摘要</span><span class="confidence-chip">${p.confidence}</span></div><h3>${p.school}<br /><em>${p.dept}</em></h3><div class="detail-route"><span>招生管道</span><strong>${p.route}</strong></div><div class="detail-route"><span>面試形式</span><strong>一般 panel 模擬</strong></div><div class="detail-rule"><span>✳</span><p>依備審內容練習作品追問與學科概念說明。</p></div><div class="source-note"><span class="source-dot"></span><div><strong>資料狀態：${p.confidence}</strong><small>校系流程和評分資訊尚未接入官方來源；此設定僅供練習。</small></div></div><div class="detail-footer">最後核對 <strong>尚未核對</strong></div></aside></div>
  <div class="form-footer"><button class="button button-quiet" data-action="home">← 返回總覽</button><button class="button button-primary" data-action="step" data-page="resume">下一步：整理備審 <span>→</span></button></div>`;
}
function claimsHtml() {
  return state.claims.map((c, i) => `<div class="claim-item"><span class="claim-index">${String(i + 1).padStart(2, "0")}</span><textarea data-claim="${c.id}" rows="2" aria-label="備審主張 ${i + 1}">${esc(c.text)}</textarea><button class="claim-remove" data-action="remove-claim" data-id="${c.id}">×</button></div>`).join("");
}
function resumePage() {
  return intro(1, "把備審裡的重要主張帶進練習", "選擇一份檔案作為參考，再確認系統應該如何理解你的專題、貢獻和學習經驗。") +
  `<div class="resume-grid"><section class="upload-panel"><div class="panel-heading"><span class="eyebrow">YOUR PORTFOLIO</span><span class="secure-tag">◈ 僅此裝置</span></div><h3>匯入備審資料</h3><label class="drop-zone" for="resume-file"><input id="resume-file" type="file" accept=".pdf,.doc,.docx,.txt" /><span class="upload-icon">↑</span><strong>${state.fileName ? esc(state.fileName) : "拖放檔案到這裡"}</strong><small>${state.fileName ? esc(state.fileSize) + "・只顯示檔名，原始檔不會上傳" : "或點擊選擇 PDF、Word 或文字檔"}</small><span class="button button-outline">${state.fileName ? "更換檔案" : "選擇檔案"}</span></label><div class="upload-safety"><span>◈</span><p>前端示範不會讀取或傳送檔案內容；請自行確認下方主張。</p></div><button class="sample-link" data-action="sample">先用示範內容練習 <span>→</span></button></section>
  <section class="claims-panel"><div class="claims-heading"><div><span class="eyebrow">CLAIMS TO PRACTICE</span><h3>請確認這些主張</h3></div><span class="mock-label">示範草稿</span></div><p class="subtle-copy">這些句子會成為考官追問的線索。可直接編輯，或改寫成你自己的經驗。</p><div class="claim-list">${claimsHtml()}</div><button class="add-claim-button" data-action="add-claim">＋ 新增一個主張</button><div class="claim-tip"><span>✳</span><span>只寫你能進一步解釋的事情，面試練習會從這些內容延伸。</span></div></section></div>
  <div class="form-footer"><button class="button button-quiet" data-action="step" data-page="profile">← 上一步</button><button class="button button-primary" data-action="step" data-page="setup">主張確認，繼續設定 <span>→</span></button></div>`;
}
function personPick(person) {
  const checked = state.people.includes(person.id);
  return `<button class="interviewer-pick ${checked ? "is-checked" : ""}" data-action="person" data-id="${person.id}" aria-pressed="${checked}"><span class="pick-check">${checked ? "✓" : "+"}</span><span class="pick-portrait"><img src="${person.image}" alt="" /></span><span class="pick-copy"><strong>${person.name}<small>${person.role}</small></strong><span class="trait-line">${person.trait}</span><span class="signature-line">專屬動作・${person.cue}</span></span></button>`;
}
function setupPage() {
  return intro(2, "安排一場適合自己的練習", "選擇考官陣容、練習長度和互動方式。考官是可替換的角色，不會固定在背景場景裡。") +
  `<section class="panel-choice-section"><div class="section-heading compact-heading"><div><span class="eyebrow">INTERVIEW PANEL</span><h2>選一組考官</h2></div><span class="muted-count">三種面試組合</span></div><div class="panel-options">${panels.map((x) => `<button class="panel-option ${state.panel === x.id ? "is-selected" : ""}" data-action="panel" data-id="${x.id}"><span class="panel-option-top"><span class="panel-glyph">${x.icon}</span><span class="panel-count">${x.count}</span></span><strong>${x.title}</strong><small>${x.subtitle}</small><p>${x.desc}</p><span class="panel-option-check">${state.panel === x.id ? "已選擇 ✓" : "選擇陣容 →"}</span></button>`).join("")}</div></section>
  <section class="customize-panel"><div class="customize-heading"><div><span class="eyebrow">CHARACTER ROSTER</span><h3>調整考官角色</h3><p>保留 1–3 位考官；點擊角色卡即可替換陣容。</p></div><span class="roster-count"><strong>${state.people.length}</strong> / 3 位</span></div><div class="interviewer-picks">${Object.values(interviewers).map(personPick).join("")}</div><div class="roster-hint">目前陣容：${activePeople().map((x) => x.name).join("・") || "請至少選一位考官"}</div></section>
  <section class="settings-grid"><div class="setting-card"><div class="setting-label"><span class="setting-icon">◷</span><div><strong>練習時間</strong><small>用來安排節奏，不是評分</small></div></div><div class="segmented-control">${[10,15,20].map((n) => `<button class="${Number(state.config.duration) === n ? "is-active" : ""}" data-action="duration" data-value="${n}">${n}<small> 分鐘</small></button>`).join("")}</div></div>
  <div class="setting-card"><div class="setting-label"><span class="setting-icon">◉</span><div><strong>回答方式</strong><small>對話流程使用本機 mock</small></div></div><div class="mode-options"><button class="${state.config.mode === "voice" ? "is-active" : ""}" data-action="mode" data-value="voice"><span>♩</span><strong>語音練習</strong><small>前端示範，文字輸入備援</small></button><button class="${state.config.mode === "text" ? "is-active" : ""}" data-action="mode" data-value="text"><span>⌁</span><strong>文字練習</strong><small>輸入回答後進入下一題</small></button></div></div>
  <div class="setting-card setting-card-wide"><div class="setting-label"><span class="setting-icon">▤</span><div><strong>畫面偏好</strong><small>可在面試中隨時調整字幕</small></div></div><label class="toggle-row"><span><strong>顯示即時字幕</strong><small>預設開啟</small></span><input type="checkbox" data-config="captions" ${state.config.captions ? "checked" : ""} /><i></i></label><label class="toggle-row"><span><strong>顯示練習計時</strong><small>只在你選擇後顯示</small></span><input type="checkbox" data-config="timer" ${state.config.timer ? "checked" : ""} /><i></i></label></div></section>
  <div class="seed-row"><span>動作排程種子</span><input type="number" min="1" max="999999" data-seed value="${state.seed}" /><small>相同種子可重播同一組角色動作。</small><button data-action="new-seed">換一組動作 ↻</button></div>
  <div class="form-footer"><button class="button button-quiet" data-action="step" data-page="resume">← 上一步</button><button class="button button-primary" data-action="step" data-page="device">下一步：設備檢查 <span>→</span></button></div>`;
}
function devicePage() {
  return intro(3, "先確認設備，再進入面試室", "鏡頭只在本頁短暫預覽，正式面試不會顯示自拍畫面。這個原型不錄製或上傳影音。") +
  `<div class="device-grid"><section class="device-preview-card"><div class="device-preview-top"><span class="eyebrow">CAMERA PREVIEW</span><span class="local-only">◈ 僅此裝置</span></div><div class="video-preview ${state.deviceReady ? "has-video" : ""}"><video id="device-video" autoplay playsinline muted></video><div class="preview-placeholder"><span class="camera-orbit">◉</span><strong>${state.deviceReady ? "鏡頭已準備好" : "鏡頭預覽尚未開啟"}</strong><small>${state.deviceReady ? "離開此頁後會停止鏡頭" : "按下檢查按鈕後，瀏覽器會詢問鏡頭權限"}</small></div><span class="preview-corner">設備檢查</span></div><button class="button button-primary full-button" data-action="devices">${state.deviceReady ? "重新檢查設備" : "檢查麥克風與鏡頭"} <span>→</span></button><button class="skip-check" data-action="step" data-page="interview">略過設備檢查，以示範模式繼續</button></section>
  <section class="device-status-card"><span class="eyebrow">DEVICE STATUS</span><h3>設備準備狀態</h3><div class="device-status-row"><span class="device-symbol">♩</span><span><strong>麥克風</strong><small>${state.deviceReady ? "瀏覽器已取得使用權限" : "尚未檢查・可使用文字模式"}</small></span><span class="status-pill ${state.deviceReady ? "is-ready" : ""}">${state.deviceReady ? "就緒" : "待檢查"}</span></div><div class="device-status-row"><span class="device-symbol">▣</span><span><strong>攝影機</strong><small>${state.deviceReady ? "只用於本頁設備預覽" : "面試中不會顯示自拍"}</small></span><span class="status-pill ${state.deviceReady ? "is-ready" : ""}">${state.deviceReady ? "就緒" : "待檢查"}</span></div><div class="device-info-note"><span>i</span><p>不需要開啟鏡頭也能完成文字練習。面試畫面只會看到考官與面試室。</p></div><div class="device-profile-summary"><span class="mini-school-mark">F</span><div><strong>${profile().school}・${profile().dept}</strong><small>${activePeople().map((x) => x.name).join("・")} ・ ${state.config.duration} 分鐘</small></div><button data-action="step" data-page="setup">編輯</button></div></section></div>
  <div class="form-footer"><button class="button button-quiet" data-action="step" data-page="setup">← 返回設定</button><button class="button button-primary" data-action="step" data-page="interview">進入面試室 <span>→</span></button></div>`;
}
function rng(seed) {
  let x = seed >>> 0;
  return () => { x += 0x6D2B79F5; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function scheduleFor(seed) {
  const pool = state.people.length ? state.people : ["portfolio"], random = rng(Number(seed) || 1);
  return questions.map((q, i) => { const speaker = pool.includes(q.role) ? q.role : pool[i % pool.length], others = pool.filter((id) => id !== speaker); return { speaker, reader: others.length && random() > .42 ? others[Math.floor(random() * others.length)] : "", beat: Math.floor(random() * 4) }; });
}
function actor(person, index, total, event) {
  const seats = total === 1 ? [50] : total === 2 ? [33,67] : [19,50,81];
  const action = person.id === event.speaker ? "speaking" : person.id === event.reader ? "reading_notes" : event.beat === 0 ? "considering" : "listening";
  const label = action === "speaking" ? "正在提問" : action === "reading_notes" ? person.cue : action === "considering" ? "思考中" : "聆聽中";
  const ring = action === "speaking" ? '<span class="speaker-ring"></span>' : "";
  return `<div class="actor actor-${person.id} state-${action} ${action === "speaking" ? "is-active-speaker" : ""}" data-person="${person.id}" data-state="${action}" style="--seat-x:${seats[index]}%;--seat-index:${index}"><img class="actor-portrait" src="${person.image}" alt="${person.name}，${person.role}" /><div class="actor-nameplate ${person.color}"><span class="actor-state-dot"></span><strong>${person.name}</strong><small>${label}</small></div>${ring}</div>`;
}
function interviewPage() {
  document.body.classList.add("is-interview");
  const p = profile(), q = currentQuestion(), event = state.schedule[state.q] || scheduleFor(state.seed)[0], speaker = interviewers[event.speaker] || interviewers.portfolio, people = activePeople();
  const timer = state.config.timer ? '<span class="interview-timer"><span>練習計時</span><strong id="elapsed">' + elapsedText() + "</strong></span>" : "";
  const caption = state.config.captions ? '<div class="caption-bubble"><span class="caption-speaker">' + speaker.name + "</span><p>" + q.text + "</p></div>" : "";
  const progress = questions.map((_, i) => '<i class="' + (i === state.q ? "is-current" : i < state.q ? "is-past" : "") + '"></i>').join("");
  const modal = state.confirmEnd ? '<div class="modal-scrim"><div class="confirm-modal" role="dialog" aria-modal="true"><span class="modal-icon">↗</span><h2>要結束這次練習嗎？</h2><p>目前回答會整理到本機復盤頁，不會上傳。</p><div><button class="button button-quiet" data-action="continue">繼續練習</button><button class="button button-primary" data-action="confirm-end">結束並看復盤</button></div></div></div>' : "";
  return `<main class="interview-screen"><div class="room-backdrop"></div><div class="room-wash"></div>
  <header class="interview-topline"><a class="interview-brand" href="#" data-action="home"><span class="brand-mark">V</span><span><strong>VivaPrep</strong><small>模擬面試</small></span></a><div class="interview-context"><span class="context-dot"></span><span>${p.school}・${p.dept}</span><i>·</i><span>${p.route}</span><b>示範情境</b></div><div class="interview-top-actions">${timer}<button class="exit-link" data-action="end">結束面試 <span>↗</span></button></div></header>
  <div class="room-caption-top"><span class="room-status"><i></i> 面試進行中</span><span class="room-phase">${q.topic}　·　${String(state.q + 1).padStart(2, "0")} / ${questions.length}</span></div>
  <section class="room-stage" data-count="${people.length}" aria-label="一個連續的面試室場景">${people.map((x, i) => actor(x, i, people.length, event)).join("")}<div class="speaker-cue"><span class="cue-pulse"></span><span><small>目前發問</small><strong>${speaker.name}・${speaker.role}</strong></span><span class="cue-chevron">›</span></div></section>
  <div class="interview-bottom">${caption}<form class="answer-composer" data-form="answer"><div class="composer-context"><span class="composer-wave">${state.config.mode === "voice" ? "♩" : "⌁"}</span><span>${state.config.mode === "voice" ? "語音練習示範" : "文字練習"}<small>前端 mock・回答只留在本機頁面</small></span></div><textarea name="answer" rows="2" placeholder="${state.config.mode === "voice" ? "目前未連接語音辨識，可先輸入模擬回答…" : "輸入你的回答，再送出繼續…"}" aria-label="輸入模擬回答"></textarea><button class="send-answer" type="submit" aria-label="送出回答並繼續">↑</button></form></div>
  <footer class="interview-dock"><div class="dock-group"><button class="dock-control ${state.muted ? "is-muted" : ""}" data-action="mic"><span>${state.muted ? "×" : "♩"}</span><small>${state.muted ? "麥克風關閉" : "麥克風示範"}</small></button><button class="dock-control is-camera" data-action="camera"><span>▣</span><small>鏡頭預覽已隱藏</small></button><button class="dock-control ${state.config.captions ? "is-on" : ""}" data-action="captions"><span>CC</span><small>字幕 ${state.config.captions ? "開啟" : "關閉"}</small></button></div><div class="dock-center"><span class="question-progress">${progress}</span><span>第 ${state.q + 1} 題</span></div><div class="dock-right"><span class="seed-badge">SEED ${esc(state.seed)}</span><button class="button button-glass" data-action="next">${state.q === questions.length - 1 ? "結束並看復盤" : "下一題"} <span>→</span></button></div></footer>${modal}</main>`;
}
function feedback(q, answer, i) {
  if (!answer) return "尚未輸入作答。下一輪可以先用一句話回答，再補一個例子。";
  if (answer.length < 48) return "你已開始回應「" + q.topic + "」。可以再補一個具體步驟或例子，讓個人貢獻更清楚。";
  return i === 0 ? "回答有足夠脈絡。下一步可把選系理由連到一段實際經驗。" : "回答包含細節。試著再補上結果或驗證方式，讓考官能追到你的依據。";
}
function reviewPage() {
  const p = profile(), answered = state.answers.filter((a) => a && a.trim()).length;
  const cards = questions.map((q, i) => `<article class="transcript-card"><div class="transcript-head"><span class="transcript-index">${String(i + 1).padStart(2, "0")}</span><div><span class="topic-chip">${q.topic}</span><h3>${q.text}</h3></div><span class="transcript-time">${interviewers[state.schedule[i]?.speaker || q.role]?.name || "考官"}</span></div><div class="answer-quote"><span>你的回答</span><p>${state.answers[i] ? esc(state.answers[i]) : "這題尚未輸入回答。"}</p></div><div class="feedback-note"><span>✳</span><p>${feedback(q, state.answers[i] || "", i)}</p></div><div class="evidence-link">練習提示・回應主題：<strong>${q.topic}</strong></div></article>`).join("");
  const roster = activePeople().map((x) => '<div><img src="' + x.image + '" alt="" /><span><strong>' + x.name + "</strong><small>" + x.role + "</small></span></div>").join("");
  return `<div class="review-hero"><div><span class="eyebrow accent">SESSION REVIEW / MOCK</span><h1>每一次回答，<br /><em>都能找到下一步。</em></h1><p>${p.school}・${p.dept}　／　${state.config.duration} 分鐘練習情境</p></div><div class="review-stamp"><span>V</span><small>練習完成</small><strong>${String(answered).padStart(2, "0")}<i> / ${questions.length}</i></strong><small>題有輸入回答</small></div></div>
  <div class="review-disclaimer"><span>i</span><p><strong>這是前端示範復盤。</strong>內容依你輸入的文字與簡單本機規則整理；不代表官方評分，也不預測錄取結果。</p></div><div class="review-layout"><section class="review-main"><div class="section-heading compact-heading"><div><span class="eyebrow">QUESTION BY QUESTION</span><h2>逐題回看</h2></div><button class="text-link" data-action="export">下載文字紀錄 ↓</button></div><div class="transcript-list">${cards}</div></section>
  <aside class="review-aside"><div class="review-side-card next-practice-card"><span class="eyebrow">NEXT PRACTICE</span><h3>下一輪，先練這件事</h3><p>挑一個備審主張，用「情境 → 自己的行動 → 結果」各說一句，再試著回答教授的延伸追問。</p><div class="practice-quote">「這個成果裡，哪些是你親自完成的？」</div><button class="button button-primary full-button" data-action="practice">換一個 seed 再練一次 <span>↻</span></button></div><div class="review-side-card"><span class="eyebrow">PANEL USED</span><h3>這次的考官</h3><div class="review-roster">${roster}</div><button class="text-link" data-action="step" data-page="setup">調整陣容與設定 →</button></div><div class="review-safety"><span>◈</span><p>視線、停頓等訊號不會在此推斷個性或錄取機率。復盤只提供可回看、可練習的內容提示。</p></div></aside></div><div class="form-footer review-footer"><button class="button button-quiet" data-action="home">回到練習總覽</button><button class="button button-primary" data-action="practice">開始下一輪練習 <span>→</span></button></div>`;
}

let clock = null;
function render() {
  if (state.page === "interview") {
    app.innerHTML = interviewPage();
    if (state.config.timer && !clock) clock = setInterval(() => { state.elapsed++; const e = document.getElementById("elapsed"); if (e) e.textContent = elapsedText(); }, 1000);
  } else {
    if (clock) clearInterval(clock); clock = null;
    const views = { home: homePage, profile: profilePage, resume: resumePage, setup: setupPage, device: devicePage, review: reviewPage };
    app.innerHTML = shell((views[state.page] || homePage)(), state.page === "home" ? "is-home" : "");
    const video = document.getElementById("device-video"); if (video && state.stream) video.srcObject = state.stream;
  }
}
function startInterview() {
  stopMedia(); state.page = "interview"; state.q = 0; state.answers = [];
  state.schedule = scheduleFor(state.seed); state.elapsed = 0; state.muted = false; state.confirmEnd = false; render();
}
function submitAnswer() {
  const input = app.querySelector('[data-form="answer"] textarea');
  state.answers[state.q] = input?.value.trim() || "";
  if (state.q === questions.length - 1) { state.page = "review"; state.confirmEnd = false; render(); return; }
  state.q++; render();
}
function setPanel(id) { const item = panels.find((p) => p.id === id); if (!item) return; state.panel = item.id; state.people = [...item.people]; render(); }
function togglePerson(id) {
  if (state.people.includes(id)) {
    if (state.people.length === 1) return notify("至少保留一位考官。");
    state.people = state.people.filter((x) => x !== id);
  } else { if (state.people.length === 3) return notify("一場面試最多安排三位考官。"); state.people.push(id); }
  state.panel = "custom"; render();
}
async function checkDevices() {
  if (!navigator.mediaDevices?.getUserMedia) return notify("這個瀏覽器無法檢查設備，可直接使用示範模式。");
  try { state.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true }); state.deviceReady = true; render(); notify("麥克風與鏡頭已在本機準備好。"); }
  catch (error) { state.deviceReady = false; render(); notify(error?.name === "NotAllowedError" ? "你尚未允許設備權限；可以略過並使用示範模式。" : "目前無法連接設備，可以略過檢查。"); }
}
function newSeed() {
  const v = new Uint32Array(1); if (window.crypto?.getRandomValues) window.crypto.getRandomValues(v); else v[0] = Date.now() >>> 0;
  state.seed = (v[0] % 999999) + 1;
}
function exportReview() {
  const lines = ["VivaPrep 面試復盤（前端示範）", profile().school + "・" + profile().dept, "",
    ...questions.flatMap((q, i) => [String(i + 1) + ". " + q.topic, "考官：" + q.text, "回答：" + (state.answers[i] || "尚未輸入回答"), "練習提示：" + feedback(q, state.answers[i] || "", i), ""]),
    "本紀錄由本機 mock 規則產生，不代表官方評分或錄取結果。"];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "VivaPrep-interview-review.txt"; link.click(); URL.revokeObjectURL(link.href);
}
app.addEventListener("click", async (event) => {
  const el = event.target.closest("[data-action]"); if (!el) return;
  const a = el.dataset.action, id = el.dataset.id;
  if (a === "home") { stopMedia(); go("home"); }
  else if (a === "step") { el.dataset.page === "interview" ? startInterview() : go(el.dataset.page); }
  else if (a === "back") { const i = steps.findIndex((s) => s[0] === state.page); go(i > 0 ? steps[i - 1][0] : "home"); }
  else if (a === "profile") { state.profileId = id; render(); }
  else if (a === "panel") setPanel(id);
  else if (a === "person") togglePerson(id);
  else if (a === "duration") { state.config.duration = Number(el.dataset.value); render(); }
  else if (a === "mode") { state.config.mode = el.dataset.value; render(); }
  else if (a === "new-seed") { newSeed(); render(); notify("已換成新的角色動作種子。"); }
  else if (a === "add-claim") { state.claims.push({ id: "c" + Date.now(), text: "" }); render(); app.querySelector(".claim-item:last-child textarea")?.focus(); }
  else if (a === "remove-claim") { state.claims = state.claims.filter((c) => c.id !== id); render(); }
  else if (a === "sample") { state.claims = [{ id: "c" + Date.now(), text: "我在校園借閱系統專題中負責資料處理與搜尋功能。" }, { id: "c" + (Date.now() + 1), text: "我透過自學演算法，嘗試用動態規劃改善問題解法。" }]; render(); notify("已載入可自行修改的示範主張。"); }
  else if (a === "devices") await checkDevices();
  else if (a === "mic") { state.muted = !state.muted; render(); }
  else if (a === "camera") notify("正式面試不顯示自拍畫面；鏡頭只在設備檢查頁預覽。");
  else if (a === "captions") { state.config.captions = !state.config.captions; render(); }
  else if (a === "next") submitAnswer();
  else if (a === "end") { state.confirmEnd = true; render(); }
  else if (a === "continue") { state.confirmEnd = false; render(); }
  else if (a === "confirm-end") { state.page = "review"; state.confirmEnd = false; render(); }
  else if (a === "practice") { newSeed(); startInterview(); }
  else if (a === "export") exportReview();
  else if (a === "toast") notify("此校系資料功能會在接入來源後開放。");
});
app.addEventListener("change", (event) => {
  const el = event.target;
  if (el.id === "resume-file" && el.files?.[0]) {
    const f = el.files[0]; state.fileName = f.name;
    state.fileSize = f.size < 1048576 ? Math.max(1, Math.round(f.size / 1024)) + " KB" : (f.size / 1048576).toFixed(1) + " MB";
    render(); notify("已選擇檔案；此原型只顯示檔名，不讀取或上傳內容。");
  } else if (el.dataset.config) { state.config[el.dataset.config] = el.checked; render(); }
  else if (el.dataset.seed !== undefined) state.seed = Math.max(1, Number(el.value) || 1);
});
app.addEventListener("input", (event) => {
  const el = event.target;
  if (el.dataset.claim) { const claim = state.claims.find((c) => c.id === el.dataset.claim); if (claim) claim.text = el.value; }
  else if (el.dataset.seed !== undefined) state.seed = Math.max(1, Number(el.value) || 1);
});
app.addEventListener("submit", (event) => { if (event.target.matches('[data-form="answer"]')) { event.preventDefault(); submitAnswer(); } });
app.addEventListener("dragover", (event) => { if (event.target.closest(".drop-zone")) event.preventDefault(); });
app.addEventListener("drop", (event) => {
  if (!event.target.closest(".drop-zone")) return;
  event.preventDefault(); const f = event.dataTransfer?.files?.[0]; if (!f) return;
  state.fileName = f.name; state.fileSize = f.size < 1048576 ? Math.max(1, Math.round(f.size / 1024)) + " KB" : (f.size / 1048576).toFixed(1) + " MB";
  render(); notify("已選擇檔案；此原型只顯示檔名，不讀取或上傳內容。");
});
render();
