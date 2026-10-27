// Pure signal helpers shared by the camera analyzer and its checks.
// Every threshold is a design heuristic relative to the student's own
// baseline, not a validated standard; tune them with recorded team samples.

export const BASELINE_SAMPLE_COUNT = 30;

export const thresholds = {
  yaw: 0.12,          // nose offset / eye distance
  pitchDown: 0.06,    // (nose - eye line) / face height; larger = head lowered
  pitchUp: -0.06,
  gazeDown: -0.22,    // blendshape eyeLookUp - eyeLookDown
  gazeUp: 0.22,
  gazeSide: 0.25,
  blink: 0.5,
  tiltDegrees: 7,
  slumpRatio: 0.85,   // head-above-shoulder height relative to baseline
  handNearFace: 0.55, // wrist/index distance to nose, in shoulder widths
};

function median(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function visible(point, threshold = 0.5) {
  return Boolean(point && (point.visibility == null || point.visibility >= threshold));
}

// Turns raw landmarks into scale-free signals. Runs inside the worker.
export function extractSignals({ face, blendshapes, pose }) {
  // Landmarks arrive either as arrays or as {index: point} subsets from the worker.
  const signals = { faceValid: Boolean(face && Object.keys(face).length), poseValid: false, yaw: null, pitch: null, gazeH: null, gazeV: null, blink: null, shoulderTilt: null, headHeight: null, shoulderWidth: 0, shoulderCenter: null, handNearFace: null };
  if (face?.[1] && face?.[33] && face?.[263] && face?.[10] && face?.[152]) {
    const eyeDistance = Math.abs(face[33].x - face[263].x);
    const eyeY = (face[33].y + face[263].y) / 2;
    const faceHeight = face[152].y - face[10].y;
    if (eyeDistance > 0.02) signals.yaw = (face[1].x - (face[33].x + face[263].x) / 2) / eyeDistance;
    if (faceHeight > 0.04) signals.pitch = (face[1].y - eyeY) / faceHeight;
  }
  if (blendshapes) {
    const b = (name) => Number(blendshapes[name]) || 0;
    signals.gazeV = ((b("eyeLookUpLeft") + b("eyeLookUpRight")) - (b("eyeLookDownLeft") + b("eyeLookDownRight"))) / 2;
    signals.gazeH = ((b("eyeLookOutLeft") - b("eyeLookInLeft")) + (b("eyeLookInRight") - b("eyeLookOutRight"))) / 2;
    signals.blink = (b("eyeBlinkLeft") + b("eyeBlinkRight")) / 2;
  }
  const leftShoulder = pose?.[11];
  const rightShoulder = pose?.[12];
  if (visible(leftShoulder, 0.55) && visible(rightShoulder, 0.55)) {
    const shoulderWidth = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
    if (shoulderWidth > 0.04) {
      signals.poseValid = true;
      signals.shoulderWidth = shoulderWidth;
      signals.shoulderCenter = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 };
      // Angle of the shoulder line from horizontal, independent of mirroring.
      const angle = Math.atan2(leftShoulder.y - rightShoulder.y, leftShoulder.x - rightShoulder.x) * 180 / Math.PI;
      signals.shoulderTilt = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
      const nose = pose[0];
      if (visible(nose)) {
        signals.headHeight = (signals.shoulderCenter.y - nose.y) / shoulderWidth;
        const hands = [15, 16, 19, 20].map((index) => pose[index]).filter((point) => visible(point));
        signals.handNearFace = hands.length ? hands.some((point) => Math.hypot(point.x - nose.x, point.y - nose.y) / shoulderWidth < thresholds.handNearFace) : false;
      }
    }
  }
  return signals;
}

export function computeBaseline(samples) {
  const faces = samples.filter((sample) => sample.faceValid);
  const poses = samples.filter((sample) => sample.poseValid);
  return {
    yaw: median(faces.map((sample) => sample.yaw)),
    pitch: median(faces.map((sample) => sample.pitch)),
    gazeH: median(faces.filter((sample) => !(sample.blink > thresholds.blink)).map((sample) => sample.gazeH)),
    gazeV: median(faces.filter((sample) => !(sample.blink > thresholds.blink)).map((sample) => sample.gazeV)),
    shoulderTilt: median(poses.map((sample) => sample.shoulderTilt)),
    headHeight: median(poses.map((sample) => sample.headHeight)),
  };
}

// Where the student is looking relative to their calibrated "looking at the
// interviewer" baseline. Down takes priority because it is the most common habit.
export function classifyAttention(sample, baseline) {
  if (!sample?.faceValid || !baseline || baseline.yaw == null || baseline.pitch == null) return "unknown";
  const pitchDelta = Number.isFinite(sample.pitch) ? sample.pitch - baseline.pitch : 0;
  const yawDelta = Number.isFinite(sample.yaw) ? sample.yaw - baseline.yaw : 0;
  const gazeUsable = Number.isFinite(sample.gazeV) && baseline.gazeV != null && !(sample.blink > thresholds.blink);
  const gazeVDelta = gazeUsable ? sample.gazeV - baseline.gazeV : 0;
  const gazeHDelta = gazeUsable && Number.isFinite(sample.gazeH) && baseline.gazeH != null ? sample.gazeH - baseline.gazeH : 0;
  if (pitchDelta > thresholds.pitchDown || gazeVDelta < thresholds.gazeDown) return "down";
  if (Math.abs(yawDelta) > thresholds.yaw || Math.abs(gazeHDelta) > thresholds.gazeSide) return "side";
  if (pitchDelta < thresholds.pitchUp || gazeVDelta > thresholds.gazeUp) return "up";
  return "screen";
}

export function classifyPosture(sample, baseline) {
  if (!sample?.poseValid || !baseline) return { valid: false, tilted: false, slumped: false, handNearFace: false };
  const tilted = Number.isFinite(sample.shoulderTilt) && baseline.shoulderTilt != null && Math.abs(sample.shoulderTilt - baseline.shoulderTilt) > thresholds.tiltDegrees;
  const slumped = Number.isFinite(sample.headHeight) && baseline.headHeight > 0 && sample.headHeight / baseline.headHeight < thresholds.slumpRatio;
  return { valid: true, tilted, slumped, handNearFace: sample.handNearFace === true };
}
