function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function scoreSource(source, queryTerms) {
  const haystack = normalize([source.title, source.summary, source.excerpt, ...(source.topics || [])].join(" "));
  let overlap = 0;
  for (const term of queryTerms) if (term && haystack.includes(term)) overlap += 1;
  const typeBoost = source.sourceType === "official_rule" || source.sourceType === "official_rubric" ? 3 : 0;
  const yearBoost = source.academicYear ? 1 : 0;
  return typeBoost + yearBoost + overlap;
}

export function retrieveSources(profile, inputText, claims = [], approvedReports = [], limit = 8) {
  if (!profile) return [];
  const queryTerms = normalize([inputText, ...claims].join(" ")).split(/\s+/).filter((term) => term.length > 1);
  const official = (profile.sources || []).filter((source) => (
    ["official_rule", "official_rubric"].includes(source.sourceType) &&
    source.schoolId === profile.schoolId &&
    source.departmentId === profile.departmentId &&
    source.academicYear === profile.academicYear &&
    source.admissionRoute === profile.admissionRoute &&
    source.reviewStatus === "approved"
  ));
  const matchingReports = approvedReports.filter((source) => (
    source.sourceType === "first_person_report" &&
    source.schoolId === profile.schoolId &&
    source.departmentId === profile.departmentId &&
    source.academicYear === profile.academicYear &&
    source.admissionRoute === profile.admissionRoute &&
    source.reviewStatus === "approved"
  ));
  const sameProgramOlder = approvedReports.filter((source) => (
    source.sourceType === "first_person_report" &&
    source.schoolId === profile.schoolId &&
    source.departmentId === profile.departmentId &&
    source.admissionRoute === profile.admissionRoute &&
    source.academicYear !== profile.academicYear &&
    source.reviewStatus === "approved"
  )).map((source) => ({ ...source, retrievalNote: "other_year" }));
  const rank = (candidates) => candidates
    .map((source) => ({ source, score: scoreSource(source, queryTerms) }))
    .sort((a, b) => b.score - a.score || String(a.source.sourceId).localeCompare(String(b.source.sourceId)))
    .map(({ source }) => source);
  const selectedOfficial = rank(official).slice(0, limit);
  const selectedReports = rank([...matchingReports, ...sameProgramOlder]).slice(0, Math.max(0, limit - selectedOfficial.length));
  const selected = [...selectedOfficial, ...selectedReports];
  return selected.map((source) => ({
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      claimType: source.claimType,
      academicYear: source.academicYear,
      admissionRoute: source.admissionRoute,
      title: source.title,
      summary: source.summary,
      excerpt: source.excerpt,
      confidence: source.confidence,
      reportCount: source.reportCount,
      url: source.url,
      retrievalNote: source.retrievalNote || null,
    }));
}

export function renderSourceContext(sources) {
  return sources.map((source) => {
    return [
      "來源 ID：" + source.sourceId,
      "類型：" + source.sourceType + "；主張類型：" + source.claimType,
      "學年度／管道：" + (source.academicYear ?? "未標示") + "／" + (source.admissionRoute || "未標示"),
      "摘要：" + (source.summary || "無可用摘要"),
      "信心：" + (source.confidence || "low") + "；心得數：" + (source.reportCount ?? "未知"),
      "網址：" + (source.url || "無"),
    ].join("\n");
  }).join("\n\n");
}
