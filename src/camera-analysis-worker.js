const MEDIAPIPE_ROOT = "/vendor/mediapipe";
const WASM_ROOT = `${MEDIAPIPE_ROOT}/wasm`;
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const FACE_POINTS = [1, 10, 33, 152, 263];
const POSE_POINTS = [0, 11, 12, 15, 16, 19, 20];

let faceLandmarker;
let poseLandmarker;
// The demo overlay draws every landmark; analysis alone needs only the subsets above.
let overlay = false;

self.onmessage = async ({ data }) => {
  if (data?.type === "overlay") { overlay = data.enabled === true; return; }
  if (data?.type === "init") {
    try {
      const vision = await import(`${MEDIAPIPE_ROOT}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
      [faceLandmarker, poseLandmarker] = await Promise.all([
        vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        }),
        vision.PoseLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate: "CPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          outputSegmentationMasks: false,
        }),
      ]);
      self.postMessage({ type: "ready" });
    } catch (error) {
      self.postMessage({ type: "error", message: error?.message || "無法載入本機視覺模型。" });
    }
    return;
  }

  if (data?.type !== "frame" || !faceLandmarker || !poseLandmarker) return;
  const { bitmap, timestamp, context } = data;
  try {
    const faceResult = faceLandmarker.detectForVideo(bitmap, timestamp);
    const poseResult = poseLandmarker.detectForVideo(bitmap, timestamp);
    // Send only the landmarks the analyzer uses; signal math lives in camera-signals.js.
    const pick = (points, indexes) => Object.fromEntries(indexes.filter((index) => points[index]).map((index) => [index, { x: points[index].x, y: points[index].y, visibility: points[index].visibility }]));
    const face = faceResult.faceLandmarks?.[0];
    const pose = poseResult.landmarks?.[0];
    const blendshapes = faceResult.faceBlendshapes?.[0]?.categories
      ? Object.fromEntries(faceResult.faceBlendshapes[0].categories.filter((item) => /^eye(Look|Blink)/.test(item.categoryName)).map((item) => [item.categoryName, item.score]))
      : null;
    self.postMessage({
      type: "sample",
      timestamp,
      context,
      face: face?.length ? pick(face, FACE_POINTS) : null,
      blendshapes,
      pose: pose?.length ? pick(pose, POSE_POINTS) : null,
      overlay: overlay ? {
        face: face?.length ? face.map((point) => [point.x, point.y]) : null,
        pose: pose?.length ? pose.map((point) => [point.x, point.y, point.visibility ?? 1]) : null,
      } : undefined,
    });
  } catch (error) {
    self.postMessage({ type: "sample-error", timestamp, context, message: error?.message || "影格分析失敗。" });
  } finally {
    bitmap?.close?.();
  }
};
