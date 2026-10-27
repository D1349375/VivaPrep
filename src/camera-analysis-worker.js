const MEDIAPIPE_ROOT = "/vendor/mediapipe";
const WASM_ROOT = `${MEDIAPIPE_ROOT}/wasm`;
const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const POSE_MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

let faceLandmarker;
let poseLandmarker;

function visible(point, threshold = 0.55) {
  return Boolean(point && (point.visibility == null || point.visibility >= threshold));
}

self.onmessage = async ({ data }) => {
  if (data?.type === "init") {
    try {
      const vision = await import(`${MEDIAPIPE_ROOT}/vision_bundle.mjs`);
      const files = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
      [faceLandmarker, poseLandmarker] = await Promise.all([
        vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: false,
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
    const face = faceResult.faceLandmarks?.[0];
    const pose = poseResult.landmarks?.[0];
    let yawProxy = null;
    if (face?.[1] && face?.[33] && face?.[263]) {
      const eyeDistance = Math.abs(face[33].x - face[263].x);
      if (eyeDistance > 0.02) yawProxy = (face[1].x - (face[33].x + face[263].x) / 2) / eyeDistance;
    }
    const leftShoulder = pose?.[11];
    const rightShoulder = pose?.[12];
    const poseValid = visible(leftShoulder) && visible(rightShoulder);
    const shoulderWidth = poseValid ? Math.abs(leftShoulder.x - rightShoulder.x) : 0;
    const shoulderCenter = poseValid ? { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 } : null;
    self.postMessage({
      type: "sample",
      timestamp,
      context,
      faceValid: Boolean(face?.length),
      yawProxy,
      poseValid: Boolean(poseValid && shoulderWidth > 0.04),
      shoulderWidth,
      shoulderCenter,
    });
  } catch (error) {
    self.postMessage({ type: "sample-error", timestamp, context, message: error?.message || "影格分析失敗。" });
  } finally {
    bitmap?.close?.();
  }
};
