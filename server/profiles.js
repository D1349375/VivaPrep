import { randomUUID } from "node:crypto";

const fcuOfficialGuideUrl = "https://webadmi.fcu.edu.tw/115/college/apply/2182-2/015252-4.pdf";
const fcuApcsGuideUrl = "https://webadmi.fcu.edu.tw/115/college/apply/2182-2/015262-4.pdf";

const fcuGeneralSources = [
  {
    sourceId: "fcu-cs-115-general-interview-guide",
    sourceType: "official_rule",
    schoolId: "fcu",
    departmentId: "cs",
    academicYear: 115,
    admissionRoute: "general_application",
    title: "試點校系 115 學年度資工系一般申請面試進行方式及準備指引",
    url: fcuOfficialGuideUrl,
    excerpt: "應試生參加一關面試；面試時間 5 分鐘。",
    summary: "115 學年度一般申請為一關面試，面試時間 5 分鐘。文件未說明面試委員人數。",
    claimType: "fact",
    confidence: "high",
    isFirstHand: false,
    reportCount: 1,
    reviewStatus: "approved",
    consentStatus: "not_applicable",
    anonymized: true,
  },
  {
    sourceId: "fcu-cs-115-general-interview-rubric",
    sourceType: "official_rubric",
    schoolId: "fcu",
    departmentId: "cs",
    academicYear: 115,
    admissionRoute: "general_application",
    title: "試點校系 115 學年度資工系一般申請面試準備重點",
    url: fcuOfficialGuideUrl,
    excerpt: "主要觀察學習態度及思考能力、邏輯表達能力、本系相關既有知識等。",
    summary: "官方準備重點包括學習態度及思考能力、邏輯表達能力、本系相關既有知識。",
    claimType: "fact",
    confidence: "high",
    isFirstHand: false,
    reportCount: 1,
    reviewStatus: "approved",
    consentStatus: "not_applicable",
    anonymized: true,
  },
];

export const profiles = [
  {
    id: "fcu-general",
    schoolId: "fcu",
    departmentId: "cs",
    school: "模擬大學",
    department: "資訊工程學系",
    academicYear: 115,
    admissionRoute: "general_application",
    routeLabel: "個人申請・一般組",
    displayName: "模擬資工一般申請",
    interviewFormat: "官方資料：一關面試，單場 5 分鐘；可選擇較長時間作延伸練習。",
    officialPanelSize: null,
    profileStatus: "official_115",
    officialFacts: [
      "115 學年度一般申請指引列為一關面試，面試時間 5 分鐘。",
      "官方準備重點包括學習態度及思考能力、邏輯表達能力、本系相關既有知識。",
      "官方指引沒有說明面試委員人數；模擬 panel 人數不代表正式配置。",
    ],
    unknowns: ["面試委員人數", "下一學年度流程是否變更"],
    sourceIds: fcuGeneralSources.map((source) => source.sourceId),
    sources: fcuGeneralSources,
    lastVerifiedAt: "2026-09-26",
    version: "fcu-cs-general-115.1",
  },
  {
    id: "fcu-apcs",
    schoolId: "fcu",
    departmentId: "cs",
    school: "模擬大學",
    department: "資訊工程學系",
    academicYear: 115,
    admissionRoute: "apcs",
    routeLabel: "個人申請・APCS 組",
    displayName: "模擬資工 APCS",
    interviewFormat: "官方資料：一關面試，單場 5 分鐘；可選擇較長時間作延伸練習。",
    officialPanelSize: null,
    profileStatus: "official_115",
    officialFacts: ["115 學年度 APCS 組指引列為一關面試，面試時間 5 分鐘。", "主要觀察學習態度及思考能力、邏輯表達能力、本系相關既有知識。", "未規定固定自介開場；未說明委員人數。"],
    unknowns: ["面試委員人數", "正式題目與題序"],
    sourceIds: ["fcu-cs-115-apcs-interview-guide"],
    sources: [{
      sourceId: "fcu-cs-115-apcs-interview-guide",
      sourceType: "official_rule",
      schoolId: "fcu",
      departmentId: "cs",
      academicYear: 115,
      admissionRoute: "apcs",
      title: "試點校系 115 學年度資工系 APCS 組面試指引",
      url: fcuApcsGuideUrl,
      excerpt: "應試生參加一關面試，面試時間 5 分鐘。",
      summary: "115 APCS 組：一關 5 分鐘；觀察學習態度、思考、邏輯表達與相關既有知識。未列固定自介題序或委員人數。",
      claimType: "fact",
      confidence: "high",
      isFirstHand: false,
      reportCount: 1,
      reviewStatus: "approved",
      consentStatus: "not_applicable",
      anonymized: true,
    }],
    lastVerifiedAt: "2026-09-29",
    version: "fcu-cs-apcs-115.1",
  },
  {
    id: "ncu-eecs",
    schoolId: "ncu",
    departmentId: "eecs",
    school: "模擬大學",
    department: "資訊電機工程學系",
    academicYear: null,
    admissionRoute: "general_simulation",
    routeLabel: "一般模擬",
    displayName: "模擬資電一般模擬",
    interviewFormat: "一般模擬；尚未載入校系來源。",
    officialPanelSize: null,
    profileStatus: "practice_only",
    officialFacts: [],
    unknowns: ["校系官方資訊尚未整理"],
    sourceIds: [],
    sources: [],
    lastVerifiedAt: null,
    version: "ncu-eecs-general.stub",
  },
];

export function getProfile(profileId) {
  return profiles.find((profile) => profile.id === profileId) || null;
}

export function publicProfile(profile) {
  if (!profile) return null;
  return {
    id: profile.id,
    schoolId: profile.schoolId,
    departmentId: profile.departmentId,
    school: profile.school,
    department: profile.department,
    academicYear: profile.academicYear,
    admissionRoute: profile.admissionRoute,
    routeLabel: profile.routeLabel,
    displayName: profile.displayName,
    interviewFormat: profile.interviewFormat,
    officialPanelSize: profile.officialPanelSize,
    profileStatus: profile.profileStatus,
    officialFacts: profile.officialFacts,
    unknowns: profile.unknowns,
    sourceIds: profile.sourceIds,
    sourceCount: profile.sources.filter((source) => source.reviewStatus === "approved").length,
    lastVerifiedAt: profile.lastVerifiedAt,
    version: profile.version,
  };
}

export function createPracticeProfile(input) {
  const cleanField = (value, label) => {
    const normalized = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (normalized.length < 2 || normalized.length > 80) {
      throw Object.assign(new Error(label + "需介於 2 到 80 個字元。"), { code: "INVALID_CUSTOM_PROFILE", status: 400 });
    }
    return normalized;
  };
  const school = cleanField(input?.school, "學校名稱");
  const department = cleanField(input?.department, "科系名稱");
  const routeLabel = cleanField(input?.routeLabel, "申請管道");
  return {
    id: "custom-" + randomUUID(),
    schoolId: "custom",
    departmentId: "custom",
    school,
    department,
    academicYear: null,
    admissionRoute: "general_simulation",
    routeLabel,
    displayName: school + department + "一般模擬",
    interviewFormat: "使用者自訂的一般模擬情境；未載入校系官方資料。",
    officialPanelSize: null,
    profileStatus: "practice_only",
    officialFacts: [],
    unknowns: ["此為自訂一般模擬情境，尚無校系官方資訊來源。"],
    sourceIds: [],
    sources: [],
    lastVerifiedAt: null,
    version: "custom-practice-v1",
  };
}
