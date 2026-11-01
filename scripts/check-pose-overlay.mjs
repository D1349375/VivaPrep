import assert from "node:assert/strict";
import { FACE_OVAL, LEFT_EYE, RIGHT_EYE, LIPS, IRIS_CENTERS, POSE_EDGES, coverMapping, liveBadges, smoothPoints } from "../src/pose-overlay.js";

// Indices must exist in FaceLandmarker (478 with irises) and PoseLandmarker (33) output.
for (const index of [...FACE_OVAL, ...LEFT_EYE, ...RIGHT_EYE, ...LIPS, ...IRIS_CENTERS]) assert.ok(index >= 0 && index < 478, `face index ${index}`);
for (const index of POSE_EDGES.flat()) assert.ok(index >= 0 && index < 33, `pose index ${index}`);

// object-fit: cover. Same aspect maps corners to corners.
const same = coverMapping(1280, 720, 320, 180);
assert.deepEqual(same([0, 0]), [0, 0]);
assert.deepEqual(same([1, 1]), [320, 180]);
// A 16:9 camera in a 4:3 box is cropped left and right, centered.
const cropped = coverMapping(1280, 720, 400, 300);
assert.deepEqual(cropped([0.5, 0.5]), [200, 150]);
const [left] = cropped([0, 0]);
assert.ok(Math.abs(left - (400 - 300 * 16 / 9) / 2) < 1e-9 && left < 0, "left edge falls outside the box");
assert.deepEqual(cropped([0, 1]).map((value) => Math.round(value)), [Math.round(left), 300]);

// Live labels follow the analyzer's latest sample.
const at = (status, latest) => liveBadges({ status, latest });
assert.deepEqual(at("measuring", { attention: "screen", posture: { valid: true } }), { gaze: { value: "看向考官", tone: "good" }, posture: { value: "端正", tone: "good" } });
assert.deepEqual(at("measuring", { attention: "down", posture: { valid: true, slumped: true } }), { gaze: { value: "低頭", tone: "warn" }, posture: { value: "下沉", tone: "warn" } });
assert.equal(at("measuring", { attention: "side", posture: { valid: true, tilted: true } }).posture.value, "歪斜");
assert.equal(at("measuring", { attention: "up", posture: { valid: true, handNearFace: true } }).posture.value, "手靠近臉");
// Before calibration there is no baseline, so both read as waiting, not as a judgment.
assert.deepEqual(at("calibrating", { attention: "unknown", posture: { valid: false } }), { gaze: { value: "校正中", tone: "idle" }, posture: { value: "校正中", tone: "idle" } });
assert.deepEqual(at("measuring", { attention: "unknown", posture: { valid: false } }), { gaze: { value: "偵測不到臉", tone: "idle" }, posture: { value: "肩膀未入鏡", tone: "idle" } });
assert.equal(at("loading-model", null).gaze.value, "載入中");

// Smoothing eases x/y toward the target, keeps visibility as-is, and resets on a new point count.
assert.equal(smoothPoints([[0, 0, 1]], null), null);
assert.deepEqual(smoothPoints(null, [[1, 1, 0.8]]), [[1, 1, 0.8]]);
assert.deepEqual(smoothPoints([[0, 0, 0.2]], [[1, 2, 0.9]], 0.5), [[0.5, 1, 0.9]]);
assert.deepEqual(smoothPoints([[0, 0]], [[1, 1], [2, 2]]), [[1, 1], [2, 2]]);

console.log("PASS: overlay landmark indices, object-fit cover mapping, live gaze/posture labels, and point smoothing");
