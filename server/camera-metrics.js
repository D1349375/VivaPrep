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
  if (!input || typeof input !== "object" || input.schemaVersion !== "camera-trial-v1" || !Array.isArray(input.segments)) return null;
  const turnIds = new Set((turns || []).map((turn) => turn.turnId));
  const speakerIds = new Set(roster || []);
  const maxDurationMs = Math.max(5, Number(durationMinutes) || 5) * 60_000 + 120_000;
  const segments = input.segments.slice(0, 120).flatMap((raw) => {
    if (!raw || typeof raw !== "object" || !turnIds.has(raw.turnId) || !speakerIds.has(raw.speakerId)) return [];
    const ratios = raw.headOrientationRatios && typeof raw.headOrientationRatios === "object" ? raw.headOrientationRatios : {};
    const observedMs = boundedInteger(raw.observedMs, 0, maxDurationMs);
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
    }];
  });
  return {
    schemaVersion: "camera-trial-v1",
    captureMode: "consented-derived-metrics",
    calibration: input.calibration === "head-pose-proxy-calibrated" ? input.calibration : "not-calibrated",
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
  const calibrated = metrics.calibration === "head-pose-proxy-calibrated";
  return {
    answerSegments: answerSegments.length,
    faceCoverage: weightedAverage(answerSegments, (row) => row.faceCoverage),
    poseCoverage: weightedAverage(answerSegments, (row) => row.poseCoverage),
    headForwardRatio: calibrated ? weightedAverage(answerSegments, (row) => row.headOrientationRatios?.center) : null,
    averageTorsoDisplacementPerSecond: weightedAverage(answerSegments, (row) => row.averageTorsoDisplacementPerSecond),
    calibration: metrics.calibration,
  };
}
