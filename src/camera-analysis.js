const TARGET_FPS = 10;
const MIN_SAMPLE_INTERVAL_MS = 1000 / TARGET_FPS;
const MAX_INTERVAL_FOR_COVERAGE_MS = 250;
const BASELINE_SAMPLE_COUNT = 20;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percent(value) { return `${Math.round(value * 100)}%`; }

export function createCameraAnalyzer(onUpdate = () => {}) {
  let worker = null;
  let video = null;
  let running = false;
  let inFlight = false;
  let modelReady = false;
  let scheduledVideo = null;
  let loopTimer = 0;
  let startedAt = 0;
  let lastSubmittedAt = 0;
  let lastSample = null;
  let sampleCount = 0;
  let firstSampleAt = null;
  let droppedFrames = 0;
  let baseline = [];
  let neutralYaw = null;
  let segments = new Map();
  let status = "idle";
  let errorMessage = "";
  let resolveReady = null;
  let rejectReady = null;

  function keyFor(context) {
    return `${context.turnId || "unassigned"}\u0000${context.phase || "unclassified"}`;
  }

  function ensureSegment(context) {
    const key = keyFor(context);
    if (!segments.has(key)) {
      segments.set(key, {
        turnId: context.turnId || null,
        speakerId: context.speakerId || null,
        phase: context.phase || "unclassified",
        startedOffsetMs: Math.max(0, Math.round(performance.now() - startedAt)),
        endedOffsetMs: null,
        observedMs: 0,
        faceValidMs: 0,
        poseValidMs: 0,
        zonesMs: { left: 0, center: 0, right: 0 },
        unknownMs: 0,
        motionRates: [],
        samples: 0,
      });
    }
    return segments.get(key);
  }

  function classifyYaw(value) {
    if (value == null || neutralYaw == null) return "unknown";
    const delta = value - neutralYaw;
    if (delta < -0.1) return "left";
    if (delta > 0.1) return "right";
    return "center";
  }

  function buildSummary() {
    const elapsedMs = Math.max(1, performance.now() - startedAt);
    const sampleElapsedMs = firstSampleAt == null ? 1 : Math.max(MIN_SAMPLE_INTERVAL_MS, (lastSample?.timestamp || firstSampleAt) - firstSampleAt);
    const rows = [...segments.values()].map((segment) => {
      const denominator = Math.max(1, segment.observedMs);
      const averageMotion = segment.motionRates.length
        ? segment.motionRates.reduce((total, value) => total + value, 0) / segment.motionRates.length
        : null;
      return {
        turnId: segment.turnId,
        speakerId: segment.speakerId,
        phase: segment.phase,
        startedOffsetMs: segment.startedOffsetMs,
        endedOffsetMs: segment.endedOffsetMs,
        samples: segment.samples,
        observedMs: Math.round(segment.observedMs),
        faceCoverage: segment.faceValidMs / denominator,
        poseCoverage: segment.poseValidMs / denominator,
        headOrientationRatios: Object.fromEntries(Object.entries(segment.zonesMs).map(([zone, ms]) => [zone, ms / denominator])),
        unknownRatio: segment.unknownMs / denominator,
        averageTorsoDisplacementPerSecond: averageMotion,
        torsoDisplacementP90PerSecond: segment.motionRates.length ? [...segment.motionRates].sort((a, b) => a - b)[Math.floor((segment.motionRates.length - 1) * 0.9)] : null,
      };
    });
    return {
      schemaVersion: "camera-trial-v1",
      captureMode: "local-only",
      savedToServer: false,
      startedAtOffset: 0,
      elapsedMs: Math.round(elapsedMs),
      targetFps: TARGET_FPS,
      actualFps: sampleCount * 1000 / sampleElapsedMs,
      droppedFrames,
      calibration: neutralYaw == null ? "calibrating" : "head-pose-proxy-calibrated",
      status,
      errorMessage,
      latest: lastSample ? {
        faceValid: lastSample.faceValid,
        poseValid: lastSample.poseValid,
        headOrientation: lastSample.headOrientation,
        torsoDisplacementPerSecond: lastSample.torsoDisplacementPerSecond,
      } : null,
      segments: rows,
    };
  }

  function notify() { onUpdate(buildSummary()); }

  function acceptSample(sample) {
    inFlight = false;
    sampleCount++;
    if (firstSampleAt == null) firstSampleAt = sample.timestamp;
    let yaw = sample.yawProxy;
    if (sample.faceValid && Number.isFinite(yaw) && neutralYaw == null) {
      baseline.push(yaw);
      if (baseline.length >= BASELINE_SAMPLE_COUNT) {
        neutralYaw = median(baseline);
        status = "measuring";
      } else status = "calibrating";
    }
    const orientation = classifyYaw(yaw);
    let motionRate = null;
    if (sample.poseValid && sample.shoulderCenter && sample.shoulderWidth && lastSample?.poseValid && lastSample?.shoulderCenter) {
      const deltaMs = sample.timestamp - lastSample.timestamp;
      if (deltaMs > 0 && deltaMs <= 500) {
        const distance = Math.hypot(sample.shoulderCenter.x - lastSample.shoulderCenter.x, sample.shoulderCenter.y - lastSample.shoulderCenter.y);
        const width = (sample.shoulderWidth + lastSample.shoulderWidth) / 2;
        motionRate = distance / width / (deltaMs / 1000);
      }
    }
    const current = { ...sample, headOrientation: orientation, torsoDisplacementPerSecond: motionRate };
    const contextKey = keyFor(sample.context || {});
    let segment = ensureSegment(sample.context || {});
    if (lastSample && lastSample.contextKey === contextKey) {
      const interval = Math.min(MAX_INTERVAL_FOR_COVERAGE_MS, Math.max(0, sample.timestamp - lastSample.timestamp));
      segment.observedMs += interval;
      if (sample.faceValid) segment.faceValidMs += interval;
      if (sample.poseValid) segment.poseValidMs += interval;
      if (orientation === "left") segment.zonesMs.left += interval;
      else if (orientation === "center") segment.zonesMs.center += interval;
      else if (orientation === "right") segment.zonesMs.right += interval;
      else segment.unknownMs += interval;
      if (Number.isFinite(motionRate)) segment.motionRates.push(motionRate);
      segment.endedOffsetMs = Math.max(segment.startedOffsetMs, Math.round(sample.timestamp - startedAt));
    }
    segment.samples++;
    lastSample = { ...current, contextKey };
    notify();
  }

  function onWorkerMessage({ data }) {
    if (data?.type === "ready") {
      modelReady = true;
      status = "calibrating";
      notify();
      resolveReady?.();
      resolveReady = null;
      rejectReady = null;
      scheduleVideoFrames();
    } else if (data?.type === "sample") acceptSample(data);
    else if (data?.type === "sample-error") {
      inFlight = false;
      droppedFrames++;
      errorMessage = data.message;
      notify();
    } else if (data?.type === "error") {
      status = "unavailable";
      errorMessage = data.message;
      running = false;
      modelReady = false;
      rejectReady?.(new Error(errorMessage));
      resolveReady = null;
      rejectReady = null;
      notify();
    }
  }

  function submitFrame(currentVideo, timestamp, context) {
    if (!running || !modelReady || !currentVideo || currentVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (timestamp - lastSubmittedAt < MIN_SAMPLE_INTERVAL_MS) return;
    if (inFlight) { droppedFrames++; return; }
    lastSubmittedAt = timestamp;
    inFlight = true;
    createImageBitmap(currentVideo, { resizeWidth: 640, resizeHeight: 480 }).then((bitmap) => {
      if (!running || !worker) { bitmap.close(); inFlight = false; return; }
      worker.postMessage({ type: "frame", bitmap, timestamp, context }, [bitmap]);
    }).catch(() => {
      inFlight = false;
      droppedFrames++;
    });
  }

  function scheduleVideoFrames() {
    if (!running || !video || scheduledVideo === video || typeof video.requestVideoFrameCallback !== "function") return;
    scheduledVideo = video;
    const owner = video;
    const callback = (now) => {
      if (!running) return;
      if (video === owner) submitFrame(owner, now, getContext());
      scheduledVideo = null;
      scheduleVideoFrames();
    };
    owner.requestVideoFrameCallback(callback);
  }

  let getContext = () => ({ turnId: null, speakerId: null, phase: "unclassified" });

  async function start({ video: nextVideo, getContext: contextProvider } = {}) {
    if (running) return;
    video = nextVideo || video;
    getContext = typeof contextProvider === "function" ? contextProvider : getContext;
    if (!video) throw new Error("尚未連接可分析的攝影機畫面。");
    status = "loading-model";
    errorMessage = "";
    startedAt = performance.now();
    lastSubmittedAt = 0;
    sampleCount = 0;
    firstSampleAt = null;
    droppedFrames = 0;
    baseline = [];
    neutralYaw = null;
    lastSample = null;
    segments = new Map();
    // MediaPipe Tasks loads its WebAssembly glue with importScripts(). Keep this
    // as a classic worker; module workers do not expose importScripts().
    worker = new Worker(new URL("./camera-analysis-worker.js", import.meta.url), { name: "vivaprep-camera-analysis" });
    modelReady = false;
    worker.onmessage = onWorkerMessage;
    worker.onerror = () => {
      status = "unavailable";
      errorMessage = "本機視覺工作執行緒無法啟動。";
      running = false;
      modelReady = false;
      rejectReady?.(new Error(errorMessage));
      resolveReady = null;
      rejectReady = null;
      notify();
    };
    running = true;
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const timeout = window.setTimeout(() => {
      if (!modelReady) {
        status = "unavailable";
        errorMessage = "本機視覺模型載入逾時，已停止鏡頭分析。";
        running = false;
        worker?.terminate();
        worker = null;
        rejectReady?.(new Error(errorMessage));
        resolveReady = null;
        rejectReady = null;
        notify();
      }
    }, 90000);
    worker.postMessage({ type: "init" });
    scheduleVideoFrames();
    loopTimer = window.setInterval(() => {
      if (!running || !video || typeof video.requestVideoFrameCallback === "function") return;
      if (!modelReady) return;
      const now = performance.now();
      if (now - lastSubmittedAt >= MIN_SAMPLE_INTERVAL_MS) submitFrame(video, now, getContext());
    }, 30);
    notify();
    try { await ready; }
    finally { window.clearTimeout(timeout); }
  }

  function setVideo(nextVideo) {
    video = nextVideo;
    if (running) scheduleVideoFrames();
  }

  function snapshot() { return buildSummary(); }

  function stop({ keepSummary = true } = {}) {
    const result = buildSummary();
    running = false;
    modelReady = false;
    rejectReady?.(new Error("鏡頭試測已停止。"));
    resolveReady = null;
    rejectReady = null;
    if (loopTimer) window.clearInterval(loopTimer);
    loopTimer = 0;
    worker?.terminate();
    worker = null;
    inFlight = false;
    scheduledVideo = null;
    video = null;
    status = "stopped";
    if (!keepSummary) segments = new Map();
    return keepSummary ? { ...result, status: "stopped" } : null;
  }

  return { start, setVideo, snapshot, stop };
}

export { percent };
