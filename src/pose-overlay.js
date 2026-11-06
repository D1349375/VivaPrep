// Demo view for the camera panel: draws the MediaPipe landmarks the local
// analyzer already receives, so a recording shows what is being tracked.
// The points never leave this browser, like every other camera signal.

// FaceLandmarker indices (478 points with irises).
export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
export const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
export const IRIS_CENTERS = [468, 473];
// PoseLandmarker upper body: shoulders, arms, hands and hips.
export const POSE_EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [15, 17], [15, 19], [17, 19], [16, 18], [16, 20], [18, 20], [11, 23], [12, 24], [23, 24]];
const POSE_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24];
// Drawing only, not analysis (camera-signals keeps its own threshold). A laptop camera
// often catches just the top of the shoulders, which MediaPipe scores around 0.3-0.5.
export const MIN_DRAW_VISIBILITY = 0.3;

const ATTENTION_LABELS = { screen: "看向考官", down: "低頭", side: "看旁邊", up: "往上看" };

// Maps normalized frame coordinates onto a box showing the video with object-fit: cover.
export function coverMapping(videoWidth, videoHeight, boxWidth, boxHeight) {
  const scale = Math.max(boxWidth / videoWidth, boxHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  const offsetX = (boxWidth - width) / 2;
  const offsetY = (boxHeight - height) / 2;
  return ([x, y]) => [offsetX + x * width, offsetY + y * height];
}

// The live gaze and posture labels shown on the camera panel.
export function liveBadges(summary) {
  const latest = summary?.latest;
  const waiting = summary?.status === "calibrating" ? "校正中" : summary?.status === "loading-model" ? "載入中" : null;
  const attention = latest?.attention;
  const gaze = ATTENTION_LABELS[attention]
    ? { value: ATTENTION_LABELS[attention], tone: attention === "screen" ? "good" : "warn" }
    : { value: waiting || "偵測不到臉", tone: "idle" };
  const posture = latest?.posture;
  const postureBadge = !posture?.valid ? { value: waiting || "肩膀未入鏡", tone: "idle" }
    : posture.slumped ? { value: "下沉", tone: "warn" }
    : posture.tilted ? { value: "歪斜", tone: "warn" }
    : posture.handNearFace ? { value: "手靠近臉", tone: "warn" }
    : { value: "端正", tone: "good" };
  return { gaze, posture: postureBadge };
}

// Eases drawn points toward the latest 10 FPS sample so the skeleton moves smoothly.
export function smoothPoints(shown, target, amount = 0.45) {
  if (!target) return null;
  if (!shown || shown.length !== target.length) return target.map((point) => [...point]);
  return target.map((point, index) => point.map((value, axis) => axis > 1 ? value : shown[index][axis] + (value - shown[index][axis]) * amount));
}

export function createPoseOverlay(canvas, video) {
  const context = canvas.getContext("2d");
  let target = null;
  let shown = { face: null, pose: null };
  let frame = 0;

  function fit() {
    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(box.width * ratio);
    const height = Math.round(box.height * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    return { width, height, ratio };
  }

  function path(points, indexes, map, closed) {
    const usable = indexes.map((index) => points[index]).filter(Boolean);
    if (usable.length < 2) return;
    context.beginPath();
    usable.forEach((point, index) => { const [x, y] = map(point); index ? context.lineTo(x, y) : context.moveTo(x, y); });
    if (closed) context.closePath();
    context.stroke();
  }

  function draw() {
    frame = window.requestAnimationFrame(draw);
    const { width, height, ratio } = fit();
    context.clearRect(0, 0, width, height);
    if (!target || !video.videoWidth || !width) return;
    shown = { face: smoothPoints(shown.face, target.face), pose: smoothPoints(shown.pose, target.pose) };
    const map = coverMapping(video.videoWidth, video.videoHeight, width, height);
    const { face, pose } = shown;
    if (face) {
      // Every mesh point, sized to the box: on a recording the earlier 1.6 px dots at
      // half opacity were invisible.
      const dot = Math.max(1.6 * ratio, width / 450);
      context.fillStyle = "rgba(255,255,255,.82)";
      for (let index = 0; index < Math.min(face.length, 468); index++) {
        const [x, y] = map(face[index]);
        context.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }
      context.lineWidth = Math.max(2 * ratio, width / 300);
      context.strokeStyle = "rgba(255,255,255,.85)";
      path(face, FACE_OVAL, map, true);
      context.strokeStyle = "rgba(168,201,149,.95)";
      path(face, LEFT_EYE, map, true);
      path(face, RIGHT_EYE, map, true);
      context.strokeStyle = "rgba(234,194,166,.85)";
      path(face, LIPS, map, true);
      context.fillStyle = "#e4a081";
      IRIS_CENTERS.forEach((index) => {
        if (!face[index]) return;
        const [x, y] = map(face[index]);
        context.beginPath();
        context.arc(x, y, Math.max(3 * ratio, width / 160), 0, Math.PI * 2);
        context.fill();
      });
    }
    if (pose) {
      const seen = (index) => pose[index] && (pose[index][2] ?? 1) >= MIN_DRAW_VISIBILITY;
      context.lineWidth = Math.max(3.5 * ratio, width / 110);
      context.lineCap = "round";
      context.strokeStyle = "rgba(168,201,149,.9)";
      POSE_EDGES.forEach(([from, to]) => {
        if (!seen(from) || !seen(to)) return;
        const [x1, y1] = map(pose[from]);
        const [x2, y2] = map(pose[to]);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.stroke();
      });
      context.fillStyle = "#f6f3ec";
      POSE_JOINTS.filter(seen).forEach((index) => {
        const [x, y] = map(pose[index]);
        context.beginPath();
        context.arc(x, y, Math.max(4 * ratio, width / 90), 0, Math.PI * 2);
        context.fill();
      });
    }
  }

  return {
    update(next) { target = next; if (!next) shown = { face: null, pose: null }; },
    start() { if (!frame) frame = window.requestAnimationFrame(draw); },
    stop() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      target = null;
      shown = { face: null, pose: null };
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
