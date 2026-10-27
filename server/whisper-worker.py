"""Persistent local STT worker. Audio travels over stdin; no recording files."""
import base64
import io
import json
import os
import sys
import time
import traceback

sys.stdin.reconfigure(encoding="utf-8")

os.environ["HF_HUB_OFFLINE"] = "1"
from faster_whisper import WhisperModel
from opencc import OpenCC

def emit(payload):
    print(json.dumps(payload, ensure_ascii=True), flush=True)

try:
    model = WhisperModel(sys.argv[1], device="cpu", compute_type="int8",
                         cpu_threads=min(4, os.cpu_count() or 2), local_files_only=True)
    converter = OpenCC("s2twp")
    emit({"type": "ready"})
except Exception:
    emit({"type": "startup_error"})
    sys.exit(1)

for line in sys.stdin:
    request = None
    audio = None
    try:
        request = json.loads(line)
        encoded = request.pop("audio")
        if len(encoded) > 12 * 1024 * 1024:
            raise ValueError("oversize")
        audio = io.BytesIO(base64.b64decode(encoded, validate=True))
        del encoded
        started = time.perf_counter()
        # Technical vocabulary is context, never a requested answer. VAD removes
        # the initial waiting silence and the trailing endpoint pause.
        segments, info = model.transcribe(
            audio, language="zh", beam_size=1, best_of=1, temperature=0,
            condition_on_previous_text=False, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 450, "speech_pad_ms": 200},
            initial_prompt="繁體中文面試逐字稿。" + str(request.get("vocabulary", ""))[:240],
            hallucination_silence_threshold=1.5,
        )
        texts = []
        for segment in segments:
            if segment.no_speech_prob > 0.6 and segment.avg_logprob < -1:
                continue
            if segment.compression_ratio > 2.4:
                continue
            texts.append(segment.text.strip())
        transcript = converter.convert("".join(texts)).strip()[:8000]
        emit({"id": request["id"], "transcript": transcript,
              "durationMs": round((time.perf_counter() - started) * 1000)})
    except Exception as error:
        frames=traceback.extract_tb(error.__traceback__)
        emit({"id": request.get("id") if request else None, "error": "TRANSCRIPTION_FAILED", "reason": type(error).__name__ + ":" + ",".join(str(frame.lineno) for frame in frames)})
    finally:
        if audio:
            audio.close()
        request = None
