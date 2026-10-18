# Local speech service

Run from the isolated judges checkout root on native Apple Silicon Python 3.11.
`requirements.txt` includes `requirements.lock`, the exact 73-package environment
verified with real Worker-to-MLX transcription, and explicitly enables the MLX
extra. This lock targets macOS ARM64 / CPython 3.11 and is not a Linux/CUDA lock.

```sh
python3.11 -m venv speech/.venv
speech/.venv/bin/python -m pip install -r speech/requirements.txt
speech/.venv/bin/python -m speech.app
```

`SPEECH_SERVICE_SECRET` must be set in the service environment and match the
Worker's secret. The judges launcher supplies it; do not put it in browser code,
URLs, screenshots or tracked files. The service binds `127.0.0.1:8000` with one
process. Never run extra ASGI workers: capacity is one dictation per process.
Only the Worker is exposed through the public tunnel.

The adapter uses WhisperLiveKit 0.2.26's released public `AudioProcessor` and
`TranscriptionEngine` APIs, rather than its CLI or development-only app factory.
It shares one initialized engine and creates a fresh audio processor, VAD state,
bounded transcription queue and transcript state for every connection. Model
calls run in tracked, shielded worker threads: disconnecting stops session
tasks, then waits up to 30 seconds for current inference to finish. If that
cleanup deadline expires, health/admission remain busy until the tracked model
call really ends, so a retry cannot overlap it on the shared engine. A stuck
native call requires stopping/restarting the service; Python cannot kill an
individual running model thread. It uses
MLX Whisper, LocalAgreement, `large-v3-turbo` with English
transcription, PCM input and VAD. It coalesces 1.5 seconds of new speech per
recognition pass and keeps agreement between predictions before committing
words (`confidence_validation=False` prevents confidence-only early commits).
The model weights are approximately 1.6 GB; total runtime memory must be
measured on the actual Mac, separately from weight size.
Translation and speaker diarization are
disabled. First startup downloads the model into the package cache and loads it.
VAD weights are bundled in the Python package. Subsequent startup reuses the weights;
the service is ready only after successful model initialization. Python/ML
dependencies need several GB beyond the model. FFmpeg is not needed for this
raw PCM route. This is not a benchmark or a promise of M1 Pro latency.

The service accepts authenticated `GET /health` and WebSocket `/asr?mode=full`.
Both require `Authorization: Bearer <SPEECH_SERVICE_SECRET>`. Health is exactly
`{"available":true,"busy":false}` when ready; unavailable is HTTP 503. Other
native package routes, REST uploads, model lists and docs are not exposed.

The native WebSocket sends a `config` message with `useAudioWorklet:true`.
Send mono, signed little-endian PCM16 at 16 kHz, typically 16,000-byte frames
every half second. Transcription messages have cumulative committed `lines`
plus replaceable `buffer_transcription`. Skip silence lines (`speaker:-2`).
On Stop flush the last audio and send an empty binary frame; keep reading until
the final transcript and `{"type":"ready_to_stop"}`, followed by close 1000.
The gateway fixes mode/language/model and ignores user query overrides.

One live session is allowed. Another receives `{type:"error",code:"busy",message:...}`
and close 1013. Each session has a 300-second hard deadline, 15-second input idle
deadline, 32,000-byte frame limit and 9,600,000-byte total PCM limit. The native
pending processing buffer is limited to 15 seconds with a two-second
backpressure timeout; the transport buffers at most four frames. Stop capture
before the hard deadline to allow final transcription. After EOF, finalization
has up to 30 seconds within that deadline. Errors preserve text already
confirmed in the browser. Reconnecting starts a fresh session.

Audio stays in process memory, is not recorded, and is released by native session
cleanup. Gateway code emits no audio/transcript/request logs; native WLK logging
is discarded, and backend error details are replaced with generic messages.
Model weights remain cached. There is no retained recording to recover after
disconnect or failure.

For a deliberate rollback/comparison, `SPEECH_MODEL=base` selects the original
model, zero coalescing and five-second queue. The default is always
`large-v3-turbo`; unsupported profile values fail startup rather than silently
falling back. This setting is private to the process environment; WebSocket
queries cannot change it. Model caches are retained when switching profiles.

Run the gateway, public-API adapter, inference-cancellation, profile, bounded-queue
and benchmark metric tests without installing any dependencies or downloading
models (one additional installed-API test skips
by default):

```sh
python3 -m unittest speech.test_app speech.test_benchmark_metrics -v
```

After installation, explicitly check compatibility with the installed release
without loading/downloading a model:

```sh
SPEECH_API_SMOKE=1 speech/.venv/bin/python -m unittest speech.test_app.InstalledAPISmokeTests -v
```

That optional check requires a native Mac terminal with access to Metal;
sandboxed/headless execution can report no Metal device despite the Mac having
a compatible GPU.

For explicit browser/proxy tests with predetermined output and no model, run
`python -m speech.fake_server` in a Python environment containing `uvicorn`.
It uses the same port, secret, gateway and protocol. Stop the fixture before
starting the real service; its output is clearly labeled synthetic.

For actual model comparisons, see [JUDGES.md](../JUDGES.md). The opt-in
`tests/dictation-fixtures.py` generator uses Mac voices rather than a microphone.
`tests/dictation-live.py --reference expected.txt --report result.json` scores
the actual editor reducer's additions against a reference and checks note
save/reload with surrounding typed text. `--tail-seconds 10` checks quiet endings;
`--disconnect-after 4` checks cancellation and safe slot release. Benchmark
reports are local QA artifacts, separate from the live service's logging policy.
