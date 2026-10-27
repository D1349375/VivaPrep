const phases = new Set([
  "question_listening",
  "follow_up_listening",
  "question_visible_window",
  "follow_up_visible_window",
  "candidate_answer",
  "question_response_transition",
  "agent_transition",
  "unclassified",
]);
const zones = ["left", "center", "right"];
const attentionZones = ["screen", "down", "side", "up"];
const calibrations = new Set(["head-pose-proxy-calibrated", "camera-baseline-calibrated"]);

function boundedNumber(value, min, max, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function boundedInteger(value, min, max, fallback = 0) {
  const number = boundedNumber(value, min, max, null);
  return number == null ? fallback : Math.round(number);
}

function weightedAverage(rows, readValue) {
  let weighted = 0;
  let weightTotal = 0;
  for (const row of rows) {
    const value = readValue(row);
    const weight = Math.max(0, Number(row.observedMs) || 0);
    if (Number.isFinite(value) && weight > 0) {
      weighted += value * weight;
      weightTotal += weight;
    }
  }
  return weightTotal ? Math.round((weighted / weightTotal) * 1000) / 1000 : null;
}

export function sanitizeCameraMetrics(input, { turns, roster, durationMinutes }) {
  if (!input || typeof input !== "object" || !["camera-trial-v1", "camera-trial-v2"].includes(input.schemaVersion) || !Array.isArray(input.segments)) return null;
  const v2 = input.schemaVersion === "camera-trial-v2";
  const turnIds = new Set((turns || []).map((turn) => turn.turnId));
  const speakerIds = new Set(roster || []);
  const maxDurationMs = Math.max(5, Number(durationMinutes) || 5) * 60_000 + 120_000;
  const segments = input.segments.slice(0, 120).flatMap((raw) => {
    if (!raw || typeof raw !== "object" || !turnIds.has(raw.turnId) || !speakerIds.has(raw.speakerId)) return [];
    const ratios = raw.headOrientationRatios && typeof raw.headOrientationRatios === "object" ? raw.headOrientationRatios : {};
    const observedMs = boundedInteger(raw.observedMs, 0, maxDurationMs);
    const attention = raw.attentionRatios && typeof raw.attentionRatios === "object" ? raw.attentionRatios : {};
    const v2Fields = v2 ? {
      attentionRatios: Object.fromEntries(attentionZones.map((zone) => [zone, boundedNumber(attention[zone], 0, 1)])),
      attentionUnknownRatio: boundedNumber(raw.attentionUnknownRatio, 0, 1),
      gazeCoverage: boundedNumber(raw.gazeCoverage, 0, 1),
      postureCoverage: boundedNumber(raw.postureCoverage, 0, 1),
      tiltedRatio: boundedNumber(raw.tiltedRatio, 0, 1),
      slumpedRatio: boundedNumber(raw.slumpedRatio, 0, 1),
      handNearFaceRatio: boundedNumber(raw.handNearFaceRatio, 0, 1),
      awayEpisodes: boundedInteger(raw.awayEpisodes, 0, 10_000),
      longestAwayMs: boundedInteger(raw.longestAwayMs, 0, maxDurationMs),
      longestDownMs: boundedInteger(raw.longestDownMs, 0, maxDurationMs),
    } : {};
    return [{
      turnId: raw.turnId,
      speakerId: raw.speakerId,
      phase: phases.has(raw.phase) ? raw.phase : "unclassified",
      startedOffsetMs: boundedInteger(raw.startedOffsetMs, 0, maxDurationMs),
      endedOffsetMs: boundedInteger(raw.endedOffsetMs, 0, maxDurationMs),
      samples: boundedInteger(raw.samples, 0, 250_000),
      observedMs,
      faceCoverage: boundedNumber(raw.faceCoverage, 0, 1),
      poseCoverage: boundedNumber(raw.poseCoverage, 0, 1),
      headOrientationRatios: Object.fromEntries(zones.map((zone) => [zone, boundedNumber(ratios[zone], 0, 1)])),
      unknownRatio: boundedNumber(raw.unknownRatio, 0, 1),
      averageTorsoDisplacementPerSecond: boundedNumber(raw.averageTorsoDisplacementPerSecond, 0, 100),
      torsoDisplacementP90PerSecond: boundedNumber(raw.torsoDisplacementP90PerSecond, 0, 100),
      ...v2Fields,
    }];
  });
  return {
    schemaVersion: input.schemaVersion,
    captureMode: "consented-derived-metrics",
    calibration: calibrations.has(input.calibration) ? input.calibration : "not-calibrated",
    status: typeof input.status === "string" ? input.status.slice(0, 32) : "unknown",
    elapsedMs: boundedInteger(input.elapsedMs, 0, maxDurationMs),
    actualFps: boundedNumber(input.actualFps, 0, 120, 0),
    droppedFrames: boundedInteger(input.droppedFrames, 0, 1_000_000),
    segments,
  };
}

export function cameraMetricsForTurns(metrics, turns) {
  if (!metrics?.segments?.length) return null;
  const turnIds = new Set((turns || []).map((turn) => turn.turnId));
  const segments = metrics.segments.filter((segment) => turnIds.has(segment.turnId));
  return segments.length ? { ...metrics, segments } : null;
}

export function summarizeCameraMetrics(metrics) {
  if (!metrics?.segments?.length) return null;
  const answerSegments = metrics.segments.filter((segment) => segment.phase === "candidate_answer" && segment.observedMs >= 1000 && segment.samples >= 2);
  if (!answerSegments.length) return null;
  const calibrated = calibrations.has(metrics.calibration);
  const postureWeight = (row) => (Number(row.observedMs) || 0) * (Number(row.postureCoverage) || 0);
  const weightedBy = (rows, read, weightOf) => weightedAverage(rows.map((row) => ({ ...row, observedMs: weightOf(row) })), read);
  return {
    answerSegments: answerSegments.length,
    faceCoverage: weightedAverage(answerSegments, (row) => row.faceCoverage),
    poseCoverage: weightedAverage(answerSegments, (row) => row.poseCoverage),
    headForwardRatio: calibrated ? weightedAverage(answerSegments, (row) => row.headOrientationRatios?.center) : null,
    averageTorsoDisplacementPerSecond: weightedAverage(answerSegments, (row) => row.averageTorsoDisplacementPerSecond),
    ...(metrics.schemaVersion === "camera-trial-v2" && calibrated ? {
      screenRatio: weightedAverage(answerSegments, (row) => row.attentionRatios?.screen),
      downRatio: weightedAverage(answerSegments, (row) => row.attentionRatios?.down),
      sideRatio: weightedAverage(answerSegments, (row) => row.attentionRatios?.side),
      postureIssueRatio: weightedBy(answerSegments, (row) => Math.max(row.tiltedRatio ?? 0, row.slumpedRatio ?? 0), postureWeight),
      handNearFaceRatio: weightedBy(answerSegments, (row) => row.handNearFaceRatio, postureWeight),
    } : {}),
    calibration: metrics.calibration,
  };
}
