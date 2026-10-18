"""A bounded ASGI gateway around WhisperLiveKit's native PCM WebSocket API.

Importing this module needs only the standard library. Model imports/downloads
occur on ASGI startup; contract tests use a fake ASGI backend instead.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
from time import perf_counter
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class Limits:
    session_seconds: float = 300
    inactivity_seconds: float = 15
    finish_seconds: float = 30
    max_frame_bytes: int = 32_000
    max_audio_bytes: int = 300 * 32_000


@dataclass(frozen=True)
class SpeechProfile:
    model: str = "large-v3-turbo"
    coalesce_seconds: float = 1.5
    queue_samples: int = 240_000


def speech_profile():
    """A private process setting; browsers cannot change the model/policy."""
    model = os.environ.get("SPEECH_MODEL", "large-v3-turbo")
    if model == "large-v3-turbo":
        return SpeechProfile()
    if model == "base":
        # Preserve the original complete profile for comparison and rollback.
        return SpeechProfile(model="base", coalesce_seconds=0.0, queue_samples=80_000)
    raise ValueError("SPEECH_MODEL must be large-v3-turbo or base.")


class SessionAbort(BaseException):
    """Bypass upstream exception handlers, while still running their cleanup."""

    def __init__(self, code: str, message: str, close_code: int = 1008):
        self.code, self.message, self.close_code = code, message, close_code


class AudioQueue(asyncio.Queue):
    """Bound queued PCM samples, including variable-size VAD audio slices.

    WLK 0.2.26 uses plain unbounded asyncio queues. Its consumer also inspects
    Queue._queue, so preserve that interface and only bound producer admission.
    """

    def __init__(self, max_samples=240_000, timeout=2.0):
        # VAD emits 40 ms / 640-sample slices. The item bound must admit the
        # full audio budget plus a bounded number of silence/control events.
        super().__init__(maxsize=max(256, (max_samples + 639) // 640 + 64))
        self.max_samples, self.timeout = max_samples, timeout
        self.samples = 0
        self.space = asyncio.Event()

    @staticmethod
    def sample_count(item):
        return int(getattr(item, "size", 0))

    async def put(self, item):
        count = self.sample_count(item)
        try:
            async with asyncio.timeout(self.timeout):
                while self.full() or self.samples + count > self.max_samples:
                    self.space.clear()
                    await self.space.wait()
                self.put_nowait(item)
        except TimeoutError:
            raise SessionAbort("overloaded", "Speech recognition is falling behind. Start recording again.", 1013) from None

    def put_nowait(self, item):
        if self.samples + self.sample_count(item) > self.max_samples:
            raise asyncio.QueueFull
        super().put_nowait(item)

    def _put(self, item):
        super()._put(item)
        self.samples += self.sample_count(item)

    def _get(self):
        item = super()._get()
        self.samples -= self.sample_count(item)
        self.space.set()
        return item


class InferenceGuard:
    """Track model threads across cancellation of their owning socket tasks."""

    def __init__(self):
        self.tasks = set()

    @property
    def busy(self):
        return any(not task.done() for task in self.tasks)

    def _completed(self, task):
        self.tasks.discard(task)
        if not task.cancelled():
            task.exception()  # Observe failures even if the socket disconnected.

    async def call(self, method, *args):
        task = asyncio.create_task(asyncio.to_thread(method, *args))
        self.tasks.add(task)
        task.add_done_callback(self._completed)
        # Cancelling an asyncio waiter cannot stop a running Python/Metal
        # thread. Keep its real completion tracked rather than cancelling this
        # task and making the engine appear idle prematurely.
        return await asyncio.shield(task)

    async def drain(self, timeout=30.0):
        pending = {task for task in self.tasks if not task.done()}
        if not pending:
            return True
        _, pending = await asyncio.wait(pending, timeout=timeout)
        return not pending


def native_backend(secret: str, drain_seconds=30.0):
    """Adapt the released public Python API to the native full-mode protocol."""
    profile = speech_profile()
    # WLK debug logs can contain transcription text. Discard its entire logger
    # tree; our gateway emits neither audio nor transcripts to a log sink.
    logger = logging.getLogger("whisperlivekit")
    logger.handlers = [logging.NullHandler()]
    logger.propagate = False
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect
    from whisperlivekit import AudioProcessor, TranscriptionEngine, WhisperLiveKitConfig

    inference_guard = InferenceGuard()

    class GuardedAudioProcessor(AudioProcessor):
        async def _run_counted_transcription_call(self, method, *args):
            started = perf_counter()
            tokens, processed_upto = await inference_guard.call(method, *args)
            self.metrics.transcription_durations.append(perf_counter() - started)
            self.metrics.n_transcription_calls += 1
            tokens = tokens or []
            self.metrics.n_tokens_produced += len(tokens)
            return tokens, processed_upto

    config = WhisperLiveKitConfig(
        host="127.0.0.1", port=8000, api_token=secret,
        backend="mlx-whisper", backend_policy="localagreement",
        model_size=profile.model, lan="en", pcm_input=True,
        min_chunk_size=0.5, asr_coalesce_min_s=profile.coalesce_seconds,
        confidence_validation=False, vac=True, vad=True,
        diarization=False, target_language="", direct_english_translation=False,
        log_level="ERROR",
    )

    @asynccontextmanager
    async def lifespan(app):
        app.state.transcription_engine = TranscriptionEngine(config=config)
        yield

    app = FastAPI(lifespan=lifespan)
    app.state.config = config
    app.inference_guard = inference_guard

    async def endpoint(websocket):
        processor = GuardedAudioProcessor(transcription_engine=app.state.transcription_engine,
                                          language="en", mode="full", pcm_input=True)
        # This package release has no max_buffered_audio configuration. Bound
        # its transcription queue before any processing tasks start instead.
        processor.transcription_queue = AudioQueue(max_samples=profile.queue_samples)
        results_task = input_task = None
        try:
            await websocket.accept()
            await websocket.send_json({"type": "config", "useAudioWorklet": True, "mode": "full"})
            results = await processor.create_tasks()

            async def forward_results():
                async for response in results:
                    event = response.to_dict()
                    if event.get("status") == "error":
                        raise SessionAbort("service_error", "Speech recognition failed. Your confirmed text is preserved.", 1011)
                    await websocket.send_json(event)
                await websocket.send_json({"type": "ready_to_stop"})

            async def read_audio():
                while True:
                    frame = await websocket.receive_bytes()
                    await processor.process_audio(frame)
                    if not frame:
                        try:
                            await asyncio.wait_for(asyncio.shield(results_task), 30)
                        except TimeoutError:
                            raise SessionAbort("inactivity", "Final transcription timed out. Your confirmed text is preserved.") from None
                        return

            results_task = asyncio.create_task(forward_results())
            input_task = asyncio.create_task(read_audio())
            done, _ = await asyncio.wait({results_task, input_task}, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                await task
        except WebSocketDisconnect:
            pass
        finally:
            for task in (results_task, input_task):
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.gather(*(task for task in (results_task, input_task) if task is not None), return_exceptions=True)
            try:
                await processor.cleanup()
            finally:
                # Usually the current inference finishes within milliseconds.
                # Bound socket cleanup; a slower surviving call remains in the
                # shared guard and prevents admission until it really ends.
                await inference_guard.drain(drain_seconds)

    # Keep import-time contract tests free of FastAPI/ML dependencies while
    # providing the concrete annotation FastAPI uses to inject a WebSocket.
    endpoint.__annotations__["websocket"] = WebSocket
    app.add_api_websocket_route("/asr", endpoint)
    return app


class SpeechGateway:
    def __init__(self, secret: str, backend_factory: Callable[[], Any], limits: Limits | None = None):
        if not secret or not secret.strip():
            raise ValueError("SPEECH_SERVICE_SECRET is required.")
        self._secret = secret
        self._backend_factory = backend_factory
        self._backend = None
        self.limits = limits or Limits()
        self.available = False
        self.busy = False

    @property
    def is_busy(self):
        guard = getattr(self._backend, "inference_guard", None)
        return self.busy or bool(guard and guard.busy)

    def _authorized(self, scope):
        values = [value for key, value in scope.get("headers", []) if key.lower() == b"authorization"]
        if len(values) != 1:
            return False
        value = values[0]
        return value[:7].lower() == b"bearer " and hmac.compare_digest(value[7:], self._secret.encode())

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind == "lifespan":
            await self._lifespan(scope, receive, send)
        elif kind == "http":
            await self._http(scope, send)
        elif kind == "websocket":
            await self._websocket(scope, receive, send)

    async def _lifespan(self, scope, receive, send):
        started = failed = False
        try:
            self._backend = self._backend_factory()
            async def lifecycle_send(message):
                nonlocal started, failed
                if message["type"] == "lifespan.startup.complete":
                    self.available = True
                    started = True
                elif message["type"] in ("lifespan.shutdown.complete", "lifespan.startup.failed"):
                    self.available = False
                # Startup tracebacks may contain local paths. Keep failure
                # messages generic even when upstream initialization fails.
                if message["type"].endswith(".failed"):
                    failed = True
                    message = {"type": message["type"], "message": "Speech service could not start."}
                await send(message)
            await self._backend(scope, receive, lifecycle_send)
        except Exception:
            if not failed:
                await send({"type": "lifespan.shutdown.failed" if started else "lifespan.startup.failed", "message": "Speech service could not start."})
        finally:
            self.available = False

    async def _http(self, scope, send):
        if not self._authorized(scope):
            status, body = 401, {"error": "Unauthorized."}
        elif scope.get("path") != "/health" or scope.get("method") != "GET":
            status, body = 404, {"error": "Not found."}
        else:
            status = 200 if self.available else 503
            body = {"available": self.available, "busy": self.is_busy}
        await send({"type": "http.response.start", "status": status, "headers": [
            (b"content-type", b"application/json"), (b"cache-control", b"no-store"),
        ]})
        await send({"type": "http.response.body", "body": json.dumps(body).encode()})

    async def _reject(self, receive, send, code, message, close_code):
        if (await receive())["type"] != "websocket.connect":
            return
        await send({"type": "websocket.accept"})
        await send({"type": "websocket.send", "text": json.dumps({"type": "error", "code": code, "message": message})})
        await send({"type": "websocket.close", "code": close_code, "reason": message})

    async def _websocket(self, scope, receive, send):
        if not self._authorized(scope):
            await send({"type": "websocket.close", "code": 4401, "reason": "Unauthorized."})
            return
        if scope.get("path") != "/asr":
            await send({"type": "websocket.close", "code": 4404, "reason": "Not found."})
            return
        if not self.available or self._backend is None:
            await self._reject(receive, send, "unavailable", "Speech recognition is starting. Try again shortly.", 1013)
            return
        # There is no await between testing and claiming the slot. One ASGI
        # process/worker therefore admits exactly one active model session.
        if self.is_busy:
            await self._reject(receive, send, "busy", "Transcription is busy. Try again shortly.", 1013)
            return
        self.busy = True
        accepted = closed = eof = False
        audio_bytes = 0
        finished = asyncio.Event()
        native_task = finish_task = None

        async def guarded_receive():
            nonlocal audio_bytes, eof
            try:
                message = await asyncio.wait_for(receive(), self.limits.finish_seconds if eof else self.limits.inactivity_seconds)
            except TimeoutError:
                raise SessionAbort("inactivity", "Dictation timed out. Start recording again.") from None
            if message["type"] != "websocket.receive":
                return message
            frame = message.get("bytes")
            if frame is None or len(frame) % 2:
                raise SessionAbort("invalid_audio", "Dictation requires mono 16 kHz PCM audio.", 1003)
            if eof:
                raise SessionAbort("invalid_audio", "Recording has already stopped.", 1003)
            if len(frame) > self.limits.max_frame_bytes:
                raise SessionAbort("audio_limit", "An audio frame exceeded the recording limit.", 1009)
            audio_bytes += len(frame)
            if audio_bytes > self.limits.max_audio_bytes:
                raise SessionAbort("audio_limit", "The recording reached its maximum length.", 1009)
            eof = not frame
            return message

        async def guarded_send(message):
            nonlocal accepted, closed
            if closed:
                return
            if message["type"] == "websocket.accept":
                accepted = True
            elif message["type"] == "websocket.close":
                closed = True
            elif message["type"] == "websocket.send" and "text" in message:
                try:
                    event = json.loads(message["text"])
                except (ValueError, TypeError):
                    raise SessionAbort("service_error", "Speech recognition failed. Try again.", 1011) from None
                if event.get("type") == "error" or event.get("status") == "error":
                    message = {"type": "websocket.send", "text": json.dumps({
                        "type": "error", "code": "service_error", "message": "Speech recognition failed. Your confirmed text is preserved.",
                    })}
                if event.get("type") == "ready_to_stop":
                    await send(message)
                    finished.set()
                    return
            await send(message)

        async def fail(error):
            nonlocal closed
            if not closed:
                if accepted:
                    await send({"type": "websocket.send", "text": json.dumps({
                        "type": "error", "code": error.code, "message": error.message,
                    })})
                await send({"type": "websocket.close", "code": error.close_code, "reason": error.message})
                closed = True

        try:
            # Fix the server policy. Do not accept remote context, language,
            # translation, API token or mode overrides in URL query strings.
            native_scope = {**scope, "query_string": b"mode=full"}
            native_task = asyncio.create_task(self._backend(native_scope, guarded_receive, guarded_send))
            finish_task = asyncio.create_task(finished.wait())
            done, _ = await asyncio.wait({native_task, finish_task}, timeout=self.limits.session_seconds, return_when=asyncio.FIRST_COMPLETED)
            if not done:
                await fail(SessionAbort("session_limit", "Dictation reached its five minute limit. Start recording again."))
            elif native_task in done:
                await native_task
            elif not closed:
                await send({"type": "websocket.close", "code": 1000, "reason": "Dictation complete."})
                closed = True
        except SessionAbort as error:
            await fail(error)
        except Exception:
            await fail(SessionAbort("service_error", "Speech recognition failed. Your confirmed text is preserved.", 1011))
        finally:
            for task in (native_task, finish_task):
                if task is not None and not task.done():
                    task.cancel()
            await asyncio.gather(*(task for task in (native_task, finish_task) if task is not None), return_exceptions=True)
            self.busy = False


def create_app(secret: str | None = None, backend_factory=None, limits: Limits | None = None):
    service_secret = os.environ.get("SPEECH_SERVICE_SECRET", "") if secret is None else secret
    return SpeechGateway(service_secret, backend_factory or (lambda: native_backend(service_secret)), limits)


def main():
    import uvicorn
    uvicorn.run(create_app(), host="127.0.0.1", port=8000, workers=1, lifespan="on",
                access_log=False, log_level="warning", ws_max_size=32_000, ws_max_queue=4)


if __name__ == "__main__":
    main()
