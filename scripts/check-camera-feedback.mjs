import assert from "node:assert/strict";
import { extractSignals, computeBaseline, classifyAttention, classifyPosture, BASELINE_SAMPLE_COUNT } from "../src/camera-signals.js";
import { buildPostureFeedback } from "../src/posture-feedback.js";
import { sanitizeCameraMetrics, summarizeCameraMetrics } from "../server/camera-metrics.js";

// Synthetic landmarks in normalized image coordinates (y grows downward).
function faceAt({ noseDy = 0, noseDx = 0 } = {}) {
  return { 1: { x: 0.5 + noseDx, y: 0.45 + noseDy }, 10: { x: 0.5, y: 0.3 }, 33: { x: 0.45, y: 0.4 }, 152: { x: 0.5, y: 0.6 }, 263: { x: 0.55, y: 0.4 } };
}
function poseAt({ headY = 0.45, tilt = 0, hand = null } = {}) {
  return { 0: { x: 0.5, y: headY, visibility: 0.9 }, 11: { x: 0.6, y: 0.7 + tilt, visibility: 0.9 }, 12: { x: 0.4, y: 0.7 - tilt, visibility: 0.9 },
    15: hand || { x: 0.6, y: 0.95, visibility: 0.9 }, 16: { x: 0.4, y: 0.95, visibility: 0.9 } };
}
const eyes = (look = {}) => ({ eyeLookUpLeft: 0, eyeLookUpRight: 0, eyeLookDownLeft: 0.05, eyeLookDownRight: 0.05, eyeLookInLeft: 0, eyeLookInRight: 0, eyeLookOutLeft: 0, eyeLookOutRight: 0, eyeBlinkLeft: 0, eyeBlinkRight: 0, ...look });

const neutral = extractSignals({ face: faceAt(), blendshapes: eyes(), pose: poseAt() });
assert.equal(neutral.faceValid, true);
assert.equal(neutral.poseValid, true);
const baseline = computeBaseline(Array.from({ length: BASELINE_SAMPLE_COUNT }, () => neutral));
assert.equal(classifyAttention(neutral, baseline), "screen");

// Head lowered: the nose tip drops toward the chin relative to the eye line.
assert.equal(classifyAttention(extractSignals({ face: faceAt({ noseDy: 0.02 }), blendshapes: eyes(), pose: poseAt() }), baseline), "down");
// Eyes alone looking down (reading notes with the head still).
assert.equal(classifyAttention(extractSignals({ face: faceAt(), blendshapes: eyes({ eyeLookDownLeft: 0.6, eyeLookDownRight: 0.6 }), pose: poseAt() }), baseline), "down");
// Turned head or sideways eyes.
assert.equal(classifyAttention(extractSignals({ face: faceAt({ noseDx: 0.012 }), blendshapes: eyes(), pose: poseAt() }), baseline), "side");
assert.equal(classifyAttention(extractSignals({ face: faceAt(), blendshapes: eyes({ eyeLookOutLeft: 0.6, eyeLookInRight: 0.6 }), pose: poseAt() }), baseline), "side");
assert.equal(classifyAttention(extractSignals({ face: faceAt(), blendshapes: eyes({ eyeLookUpLeft: 0.6, eyeLookUpRight: 0.6, eyeLookDownLeft: 0, eyeLookDownRight: 0 }), pose: poseAt() }), baseline), "up");
// A blink is not "looking down".
assert.equal(classifyAttention(extractSignals({ face: faceAt(), blendshapes: eyes({ eyeLookDownLeft: 0.7, eyeLookDownRight: 0.7, eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 }), pose: poseAt() }), baseline), "screen");
assert.equal(classifyAttention({ faceValid: false }, baseline), "unknown");
assert.equal(classifyAttention(neutral, null), "unknown", "No baseline, no judgement");

assert.deepEqual(classifyPosture(neutral, baseline), { valid: true, tilted: false, slumped: false, handNearFace: false });
assert.equal(classifyPosture(extractSignals({ face: faceAt(), pose: poseAt({ tilt: 0.03 }) }), baseline).tilted, true);
assert.equal(classifyPosture(extractSignals({ face: faceAt(), pose: poseAt({ headY: 0.55 }) }), baseline).slumped, true, "Head sinking toward the shoulders");
assert.equal(classifyPosture(extractSignals({ face: faceAt(), pose: poseAt({ hand: { x: 0.52, y: 0.5, visibility: 0.9 } }) }), baseline).handNearFace, true);

// Feedback: one question mostly looking down, one fine.
const turns = [{ turnId: "t1", questionText: "可以介紹你的專題嗎？" }, { turnId: "t2", questionText: "你怎麼驗證結果？" }];
const segment = (turnId, attentionRatios, extra = {}) => ({ turnId, speakerId: "portfolio", phase: "candidate_answer", observedMs: 20000, samples: 200, faceCoverage: 0.95, poseCoverage: 0.9, postureCoverage: 0.9,
  attentionRatios, attentionUnknownRatio: 0, tiltedRatio: 0.05, slumpedRatio: 0.1, handNearFaceRatio: 0.02, averageTorsoDisplacementPerSecond: 0.04, awayEpisodes: 1, longestAwayMs: 2000, longestDownMs: 1500, ...extra });
const summary = { schemaVersion: "camera-trial-v2", calibration: "camera-baseline-calibrated", actualFps: 9.5, segments: [
  segment("t1", { screen: 0.4, down: 0.5, side: 0.05, up: 0.05 }, { longestDownMs: 7000 }),
  segment("t2", { screen: 0.85, down: 0.05, side: 0.05, up: 0.05 }),
  { ...segment("t2", { screen: 0, down: 1, side: 0, up: 0 }), phase: "question_listening" },
] };
const feedback = buildPostureFeedback(summary, turns);
assert.equal(feedback.usable, true);
const card = (id) => feedback.cards.find((item) => item.id === id);
assert.equal(card("looking-down").level, "watch", "Listening segments are excluded; answers average 27.5% down");
assert.match(card("looking-down").detail, /第 1 題/);
assert.match(card("looking-down").detail, /最長連續 7 秒/);
assert.equal(card("posture").level, "good");
assert.ok(feedback.priorities.some((item) => item.id === "looking-down"));
assert.deepEqual(feedback.perQuestion[0].flags.slice(0, 1), ["低頭 50%"]);
assert.deepEqual(feedback.perQuestion[1].flags, []);
for (const item of feedback.cards) assert.ok(item.tip && item.why, `${item.id} has a reason and a practice step`);

// Not calibrated or too little data: no judgement, explain why.
const uncalibrated = buildPostureFeedback({ ...summary, calibration: "calibrating" }, turns);
assert.equal(uncalibrated.usable, false);
assert.equal(uncalibrated.cards.length, 0);
assert.ok(uncalibrated.limits.some((item) => item.includes("校正")));
assert.equal(buildPostureFeedback({ schemaVersion: "camera-trial-v1", calibration: "head-pose-proxy-calibrated", segments: [] }, turns).usable, false);

// Server keeps the v2 fields (bounded) and summarizes them for history.
const sanitized = sanitizeCameraMetrics({ ...summary, segments: [...summary.segments, { ...segment("t1", { screen: 9, down: -1 }), tiltedRatio: 4 }] }, { turns, roster: ["portfolio"], durationMinutes: 5 });
assert.equal(sanitized.schemaVersion, "camera-trial-v2");
assert.equal(sanitized.calibration, "camera-baseline-calibrated");
assert.equal(sanitized.segments.at(-1).attentionRatios.screen, 1);
assert.equal(sanitized.segments.at(-1).attentionRatios.down, 0);
assert.equal(sanitized.segments.at(-1).tiltedRatio, 1);
const history = summarizeCameraMetrics(sanitized);
assert.ok(Number.isFinite(history.screenRatio) && Number.isFinite(history.downRatio) && Number.isFinite(history.postureIssueRatio));
assert.equal(sanitizeCameraMetrics({ schemaVersion: "camera-trial-v1", segments: [segment("t1", {})] }, { turns, roster: ["portfolio"], durationMinutes: 5 }).segments[0].attentionRatios, undefined, "v1 input stays v1");

console.log("PASS: gaze/head-down/side/up classification with blink handling, posture tilt/slump/hand-near-face, per-question posture feedback, uncalibrated limits, and v2 server sanitizing");
