"""ASGI contract tests. No model, server, third-party packages or network."""

import asyncio
import json
import os
import sys
import threading
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from speech.app import AudioQueue, InferenceGuard, Limits, SessionAbort, create_app, native_backend, speech_profile

SECRET = "test-only-service-secret"
AUTH = [(b"authorization", f"Bearer {SECRET}".encode())]


class FakeNative:
    def __init__(self):
        self.frames = []
        self.query = None
        self.cleanups = 0
        self.error = None

    async def __call__(self, scope, receive, send):
        if scope["type"] == "lifespan":
            self.assert_startup = await receive()
            await send({"type": "lifespan.startup.complete"})
            await receive()
            await send({"type": "lifespan.shutdown.complete"})
            return
        self.query = scope["query_string"]
        await receive()
        await send({"type": "websocket.accept"})
        await send({"type": "websocket.send", "text": json.dumps({"type": "config", "useAudioWorklet": True, "mode": "full"})})
        try:
            while True:
                message = await receive()
                if message["type"] == "websocket.disconnect":
                    return
                frame = message["bytes"]
                self.frames.append(frame)
                if self.error:
                    await send({"type": "websocket.send", "text": json.dumps(self.error)})
                    await send({"type": "websocket.close", "code": 1011})
                    return
                await send({"type": "websocket.send", "text": json.dumps({
                    "status": "active_transcription",
                    "lines": [{"speaker": 1, "text": "Confirmed words.", "start": "0:00:00", "end": "0:00:01"}],
                    "buffer_transcription": "" if not frame else "provisional",
                })})
                if not frame:
                    await send({"type": "websocket.send", "text": '{"type":"ready_to_stop"}'})
        finally:
            self.cleanups += 1


class Socket:
    def __init__(self, app, headers=None, path="/asr", query=b"mode=full"):
        self.incoming = asyncio.Queue()
        self.incoming.put_nowait({"type": "websocket.connect"})
        self.sent = []
        self.task = asyncio.create_task(app({
            "type": "websocket", "path": path, "query_string": query,
            "headers": AUTH if headers is None else headers,
        }, self.incoming.get, self.send))

    async def send(self, message):
        self.sent.append(message)

    @property
    def events(self):
        return [json.loads(message["text"]) for message in self.sent if message["type"] == "websocket.send"]

    async def wait_for(self, predicate):
        async def poll():
            while not predicate():
                if self.task.done():
                    await self.task
                    raise AssertionError("Socket ended before expected output")
                await asyncio.sleep(0)
        await asyncio.wait_for(poll(), 1)

    def frame(self, value):
        self.incoming.put_nowait({"type": "websocket.receive", "bytes": value})

    async def close(self):
        self.incoming.put_nowait({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(self.task, 1)


class GatewayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.native = FakeNative()
        self.app = create_app(SECRET, lambda: self.native)
        self.app._backend = self.native
        self.app.available = True

    async def http(self, headers=None, path="/health", method="GET"):
        sent = []
        async def send(message):
            sent.append(message)
        await self.app({"type": "http", "path": path, "method": method, "headers": AUTH if headers is None else headers}, None, send)
        return sent[0]["status"], json.loads(sent[1]["body"]), sent[0]["headers"]

    def test_secret_required(self):
        with self.assertRaisesRegex(ValueError, "SPEECH_SERVICE_SECRET"):
            create_app("", lambda: self.native)

    async def test_health_is_authenticated_minimal_and_uncached(self):
        self.assertEqual((await self.http(headers=[]))[:2], (401, {"error": "Unauthorized."}))
        self.assertEqual((await self.http())[:2], (200, {"available": True, "busy": False}))
        self.assertIn((b"cache-control", b"no-store"), (await self.http())[2])
        self.app.available = False
        self.assertEqual((await self.http())[:2], (503, {"available": False, "busy": False}))

    async def test_no_upstream_rest_ui_or_models_routes(self):
        for path in ("/", "/v1/models", "/v1/audio/transcriptions", "/docs"):
            self.assertEqual((await self.http(path=path))[0], 404)
        self.assertEqual((await self.http(method="POST"))[0], 404)

    async def test_missing_wrong_duplicate_and_query_tokens_rejected(self):
        for headers in ([], [(b"authorization", b"Bearer wrong")], AUTH + AUTH):
            socket = Socket(self.app, headers=headers, query=f"token={SECRET}".encode())
            await socket.task
            self.assertEqual(socket.sent, [{"type": "websocket.close", "code": 4401, "reason": "Unauthorized."}])
        self.assertFalse(self.app.busy)

    async def test_unavailable_and_wrong_socket_path(self):
        socket = Socket(self.app, path="/v1/listen")
        await socket.task
        self.assertEqual(socket.sent[-1]["code"], 4404)
        self.app.available = False
        socket = Socket(self.app)
        await socket.task
        self.assertEqual(socket.events[0]["code"], "unavailable")
        self.assertEqual(socket.sent[-1]["code"], 1013)

    async def test_second_session_busy_and_release_after_disconnect(self):
        first = Socket(self.app)
        await first.wait_for(lambda: bool(first.events))
        self.assertEqual((await self.http())[1], {"available": True, "busy": True})
        second = Socket(self.app)
        await second.task
        self.assertEqual(second.events[0]["code"], "busy")
        self.assertEqual(second.sent[-1]["code"], 1013)
        await first.close()
        self.assertEqual(self.native.cleanups, 1)
        self.assertFalse(self.app.busy)
        third = Socket(self.app)
        await third.wait_for(lambda: bool(third.events))
        await third.close()

    async def test_native_protocol_audio_eof_final_update_and_slot_release(self):
        socket = Socket(self.app, query=b"mode=diff&language=fr&context=private&token=nope")
        await socket.wait_for(lambda: bool(socket.events))
        self.assertEqual(self.native.query, b"mode=full")
        self.assertEqual(socket.events[0], {"type": "config", "useAudioWorklet": True, "mode": "full"})
        audio = b"\x01\x00" * 8000
        socket.frame(audio)
        await socket.wait_for(lambda: len(socket.events) == 2)
        self.assertEqual(socket.events[1]["buffer_transcription"], "provisional")
        socket.frame(b"")
        await socket.task
        self.assertEqual(self.native.frames, [audio, b""])
        self.assertEqual(socket.events[-2]["lines"][0]["text"], "Confirmed words.")
        self.assertEqual(socket.events[-2]["buffer_transcription"], "")
        self.assertEqual(socket.events[-1], {"type": "ready_to_stop"})
        self.assertEqual(socket.sent[-1]["code"], 1000)
        self.assertEqual(self.native.cleanups, 1)
        self.assertFalse(self.app.busy)

    async def assert_frame_rejected(self, frames, limits, code):
        self.app.limits = limits
        socket = Socket(self.app)
        await socket.wait_for(lambda: bool(socket.events))
        for frame in frames:
            socket.frame(frame)
        await socket.task
        self.assertEqual(socket.events[-1]["code"], code)
        self.assertFalse(self.app.busy)
        self.assertEqual(self.native.cleanups, 1)

    async def test_odd_length_pcm_rejected(self):
        await self.assert_frame_rejected([b"\x00"], Limits(), "invalid_audio")

    async def test_frame_bytes_bounded_before_upstream(self):
        await self.assert_frame_rejected([b"\x00" * 32002], Limits(), "audio_limit")
        self.assertEqual(self.native.frames, [])

    async def test_total_audio_bounded(self):
        await self.assert_frame_rejected([b"\x00" * 8, b"\x00" * 4], Limits(max_audio_bytes=10), "audio_limit")
        self.assertEqual(len(self.native.frames), 1)

    async def test_text_frames_rejected(self):
        socket = Socket(self.app)
        await socket.wait_for(lambda: bool(socket.events))
        socket.incoming.put_nowait({"type": "websocket.receive", "text": "raw audio is forbidden"})
        await socket.task
        self.assertEqual(socket.events[-1]["code"], "invalid_audio")

    async def test_inactivity_deadline_releases_slot(self):
        self.app.limits = Limits(inactivity_seconds=0.01)
        socket = Socket(self.app)
        await socket.task
        self.assertEqual(socket.events[-1]["code"], "inactivity")
        self.assertFalse(self.app.busy)

    async def test_wall_clock_deadline_cannot_be_extended_with_frames(self):
        self.app.limits = Limits(session_seconds=0.02)
        socket = Socket(self.app)
        await socket.wait_for(lambda: bool(socket.events))
        socket.frame(b"\x00\x00")
        await socket.task
        self.assertEqual(socket.events[-1]["code"], "session_limit")
        self.assertFalse(self.app.busy)
        self.assertEqual(self.native.cleanups, 1)

    async def test_upstream_errors_are_sanitized(self):
        self.native.error = {"status": "error", "error": f"/Users/private/recording.wav secret={SECRET}", "buffer_transcription": "private text"}
        socket = Socket(self.app)
        await socket.wait_for(lambda: bool(socket.events))
        socket.frame(b"\x00\x00")
        await socket.task
        serialized = json.dumps(socket.sent)
        for private in ("/Users/private", SECRET, "private text", "recording.wav"):
            self.assertNotIn(private, serialized)
        self.assertEqual(socket.events[-1]["code"], "service_error")
        self.assertFalse(self.app.busy)

    async def test_cancellation_cleans_up_and_releases_slot(self):
        socket = Socket(self.app)
        await socket.wait_for(lambda: bool(socket.events))
        socket.task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await socket.task
        self.assertFalse(self.app.busy)
        self.assertEqual(self.native.cleanups, 1)

    async def test_lifespan_readiness_and_shutdown(self):
        self.app.available = False
        incoming, sent = asyncio.Queue(), []
        async def send(message):
            sent.append(message)
        task = asyncio.create_task(self.app({"type": "lifespan"}, incoming.get, send))
        incoming.put_nowait({"type": "lifespan.startup"})
        await asyncio.sleep(0)
        self.assertTrue(self.app.available)
        incoming.put_nowait({"type": "lifespan.shutdown"})
        await task
        self.assertEqual([item["type"] for item in sent], ["lifespan.startup.complete", "lifespan.shutdown.complete"])
        self.assertFalse(self.app.available)

    async def test_failed_initialization_is_not_ready_and_hides_details(self):
        def broken():
            raise RuntimeError(f"private path and {SECRET}")
        app = create_app(SECRET, broken)
        sent = []
        async def send(message):
            sent.append(message)
        await app({"type": "lifespan"}, None, send)
        self.assertEqual(sent, [{"type": "lifespan.startup.failed", "message": "Speech service could not start."}])
        self.assertFalse(app.available)

    async def test_native_startup_failure_is_sent_once_without_traceback(self):
        async def broken(scope, receive, send):
            await send({"type": "lifespan.startup.failed", "message": f"private traceback {SECRET}"})
            raise RuntimeError("private backend initialization failure")
        app = create_app(SECRET, lambda: broken)
        sent = []
        async def send(message):
            sent.append(message)
        await app({"type": "lifespan"}, None, send)
        self.assertEqual(sent, [{"type": "lifespan.startup.failed", "message": "Speech service could not start."}])
        self.assertFalse(app.available)

    async def test_backend_exception_is_sanitized_and_releases_slot(self):
        async def broken(scope, receive, send):
            await receive()
            await send({"type": "websocket.accept"})
            raise RuntimeError(f"private traceback {SECRET}")
        self.app._backend = broken
        socket = Socket(self.app)
        await socket.task
        self.assertEqual(socket.events[0]["code"], "service_error")
        self.assertNotIn(SECRET, json.dumps(socket.sent))
        self.assertNotIn("private traceback", json.dumps(socket.sent))
        self.assertFalse(self.app.busy)


class QueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_default_holds_fifteen_seconds_of_real_vad_slices(self):
        queue = AudioQueue(timeout=0.01)
        for _ in range(375):
            await queue.put(SimpleNamespace(size=640))
        self.assertEqual(queue.samples, 240_000)
        with self.assertRaises(SessionAbort):
            await queue.put(SimpleNamespace(size=1))
        self.assertEqual(queue.samples, 240_000)

    async def test_audio_samples_bound_variable_sized_slices(self):
        queue = AudioQueue(max_samples=4)
        first, second = SimpleNamespace(size=3), SimpleNamespace(size=2)
        await queue.put(first)
        producer = asyncio.create_task(queue.put(second))
        await asyncio.sleep(0)
        self.assertFalse(producer.done())
        self.assertEqual(queue.samples, 3)
        self.assertIs(await queue.get(), first)
        await producer
        self.assertEqual(queue.samples, 2)
        self.assertIs(await queue.get(), second)
        self.assertEqual(queue.samples, 0)

    async def test_stalled_consumer_times_out_without_growing_queue(self):
        queue = AudioQueue(max_samples=4, timeout=0.01)
        await queue.put(SimpleNamespace(size=4))
        with self.assertRaises(SessionAbort) as caught:
            await queue.put(SimpleNamespace(size=1))
        self.assertEqual(caught.exception.code, "overloaded")
        self.assertEqual(queue.samples, 4)
        self.assertEqual(queue.qsize(), 1)

    async def test_single_oversized_slice_is_never_admitted(self):
        queue = AudioQueue(max_samples=4, timeout=0.01)
        with self.assertRaises(SessionAbort):
            await queue.put(SimpleNamespace(size=5))
        self.assertEqual(queue.samples, 0)
        self.assertEqual(queue.qsize(), 0)

    async def test_non_audio_control_items_have_item_count_bound(self):
        queue = AudioQueue(timeout=0.01)
        for _ in range(queue.maxsize):
            await queue.put(object())
        with self.assertRaises(SessionAbort):
            await queue.put(object())
        self.assertEqual(queue.qsize(), queue.maxsize)
        self.assertLessEqual(queue.maxsize, 512)
        self.assertEqual(queue.samples, 0)


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnected_slow_thread_keeps_retry_busy_until_compute_ends(self):
        started, release = threading.Event(), threading.Event()
        class Disconnect(Exception):
            pass
        class FakeWebSocket:
            def __init__(self, receive, send):
                self.receive, self.send = receive, send
            async def accept(self):
                await self.receive()
                await self.send({"type": "websocket.accept"})
            async def receive_bytes(self):
                event = await self.receive()
                if event["type"] == "websocket.disconnect":
                    raise Disconnect()
                return event["bytes"]
            async def send_json(self, event):
                await self.send({"type": "websocket.send", "text": json.dumps(event)})
        class FakeApp:
            def __init__(self, lifespan):
                self.lifespan, self.state = lifespan, SimpleNamespace()
            def add_api_websocket_route(self, path, endpoint):
                self.endpoint = endpoint
            async def __call__(self, scope, receive, send):
                await self.endpoint(FakeWebSocket(receive, send))
        class FakeProcessor:
            def __init__(self, **kwargs):
                self.task = None
                self.metrics = SimpleNamespace(transcription_durations=[], n_transcription_calls=0, n_tokens_produced=0)
            async def create_tasks(self):
                async def results():
                    await asyncio.Event().wait()
                    yield None
                return results()
            @staticmethod
            def slow_model():
                started.set()
                release.wait(2)
                return [], 0
            async def process_audio(self, frame):
                self.task = asyncio.create_task(self._run_counted_transcription_call(self.slow_model))
            async def cleanup(self):
                if self.task is not None:
                    self.task.cancel()
                    await asyncio.gather(self.task, return_exceptions=True)
        fake_fastapi, fake_wlk = ModuleType("fastapi"), ModuleType("whisperlivekit")
        fake_fastapi.FastAPI, fake_fastapi.WebSocket, fake_fastapi.WebSocketDisconnect = FakeApp, FakeWebSocket, Disconnect
        fake_wlk.AudioProcessor = FakeProcessor
        fake_wlk.TranscriptionEngine = lambda config: SimpleNamespace(config=config)
        fake_wlk.WhisperLiveKitConfig = lambda **kwargs: SimpleNamespace(**kwargs)
        with patch.dict(sys.modules, {"fastapi": fake_fastapi, "whisperlivekit": fake_wlk}):
            native = native_backend(SECRET, drain_seconds=0.01)
        gateway = create_app(SECRET, lambda: native)
        gateway._backend, gateway.available = native, True
        first = second = third = None
        try:
            async with native.lifespan(native):
                first = Socket(gateway)
                await first.wait_for(lambda: bool(first.events))
                first.frame(b"\x01\x00")
                await first.wait_for(started.is_set)
                first.incoming.put_nowait({"type": "websocket.disconnect", "code": 1000})
                # Socket cleanup is bounded, while the real worker thread is
                # deliberately still running after asyncio task cancellation.
                await asyncio.wait_for(first.task, 1)
                self.assertTrue(native.inference_guard.busy)
                self.assertTrue(gateway.is_busy)
                health = []
                async def send(message):
                    health.append(message)
                await gateway({"type": "http", "path": "/health", "method": "GET", "headers": AUTH}, None, send)
                self.assertEqual(json.loads(health[-1]["body"]), {"available": True, "busy": True})
                second = Socket(gateway)
                await second.task
                self.assertEqual(second.events[-1]["code"], "busy")
                self.assertEqual(second.sent[-1]["code"], 1013)
                release.set()
                self.assertTrue(await native.inference_guard.drain(1))
                self.assertFalse(gateway.is_busy)
                third = Socket(gateway)
                await third.wait_for(lambda: bool(third.events))
                self.assertEqual(third.events[0]["type"], "config")
                await third.close()
        finally:
            release.set()
            for socket in (first, second, third):
                if socket is not None and not socket.task.done():
                    socket.task.cancel()
            await asyncio.gather(*(socket.task for socket in (first, second, third) if socket is not None), return_exceptions=True)
            await native.inference_guard.drain(1)

    async def test_released_public_api_lifecycle_and_native_protocol(self):
        class FakeFastAPI:
            def __init__(self, lifespan):
                self.lifespan, self.state, self.routes = lifespan, SimpleNamespace(), []
            def add_api_websocket_route(self, path, endpoint):
                self.routes.append(SimpleNamespace(path=path, endpoint=endpoint))

        class FakeWebSocket:
            def __init__(self):
                self.frames = asyncio.Queue()
                self.frames.put_nowait(b"\x01\x00" * 8000)
                self.frames.put_nowait(b"")
                self.sent = []
            async def accept(self):
                self.accepted = True
            async def receive_bytes(self):
                return await self.frames.get()
            async def send_json(self, message):
                self.sent.append(message)

        class FakeProcessor:
            created = []
            def __init__(self, **kwargs):
                self.kwargs, self.outputs, self.cleaned = kwargs, asyncio.Queue(), False
                self.created.append(self)
            async def create_tasks(self):
                async def outputs():
                    while True:
                        event = await self.outputs.get()
                        if event is None:
                            return
                        yield SimpleNamespace(to_dict=lambda: event)
                return outputs()
            async def process_audio(self, frame):
                await self.outputs.put({"status": "active_transcription", "lines": [], "buffer_transcription": "preview" if frame else ""})
                if not frame:
                    await self.outputs.put(None)
            async def cleanup(self):
                self.cleaned = True

        fake_fastapi, fake_wlk = ModuleType("fastapi"), ModuleType("whisperlivekit")
        fake_fastapi.FastAPI, fake_fastapi.WebSocket, fake_fastapi.WebSocketDisconnect = FakeFastAPI, FakeWebSocket, type("Disconnect", (Exception,), {})
        fake_wlk.AudioProcessor = FakeProcessor
        fake_wlk.TranscriptionEngine = lambda config: SimpleNamespace(config=config)
        fake_wlk.WhisperLiveKitConfig = lambda **kwargs: SimpleNamespace(**kwargs)
        with patch.dict(sys.modules, {"fastapi": fake_fastapi, "whisperlivekit": fake_wlk}):
            app = native_backend(SECRET)
        config = app.state.config
        self.assertEqual((config.backend, config.backend_policy, config.model_size, config.lan), ("mlx-whisper", "localagreement", "large-v3-turbo", "en"))
        self.assertEqual(config.asr_coalesce_min_s, 1.5)
        self.assertFalse(config.confidence_validation)
        self.assertTrue(config.pcm_input and config.vad and config.vac)
        self.assertFalse(config.diarization or config.target_language)
        self.assertEqual(app.routes[0].path, "/asr")
        self.assertIs(app.routes[0].endpoint.__annotations__["websocket"], FakeWebSocket)
        websocket = FakeWebSocket()
        async with app.lifespan(app):
            await app.routes[0].endpoint(websocket)
        self.assertTrue(websocket.accepted)
        self.assertEqual(websocket.sent[0], {"type": "config", "useAudioWorklet": True, "mode": "full"})
        self.assertEqual(websocket.sent[-1], {"type": "ready_to_stop"})
        processor = FakeProcessor.created[0]
        self.assertIsInstance(processor.transcription_queue, AudioQueue)
        self.assertEqual(processor.transcription_queue.max_samples, 240_000)
        self.assertTrue(processor.cleaned)
        self.assertTrue(processor.kwargs["pcm_input"])


class InferenceGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_and_drain_timeout_do_not_hide_a_running_thread(self):
        guard = InferenceGuard()
        started, release = threading.Event(), threading.Event()
        def slow_model():
            started.set()
            release.wait(2)
            return "finished"
        call = asyncio.create_task(guard.call(slow_model))
        try:
            while not started.is_set():
                await asyncio.sleep(0)
            call.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await call
            self.assertTrue(guard.busy)
            self.assertFalse(await guard.drain(0.01))
            self.assertTrue(guard.busy)
            release.set()
            self.assertTrue(await guard.drain(1))
            self.assertFalse(guard.busy)
        finally:
            release.set()
            await guard.drain(1)


class ProfileTests(unittest.TestCase):
    def test_accuracy_default_and_explicit_original_profile(self):
        with patch.dict(os.environ, {}, clear=True):
            profile = speech_profile()
            self.assertEqual((profile.model, profile.coalesce_seconds, profile.queue_samples), ("large-v3-turbo", 1.5, 240_000))
        with patch.dict(os.environ, {"SPEECH_MODEL": "base"}, clear=True):
            profile = speech_profile()
            self.assertEqual((profile.model, profile.coalesce_seconds, profile.queue_samples), ("base", 0.0, 80_000))

    def test_invalid_model_fails_before_native_import_or_download(self):
        with patch.dict(os.environ, {"SPEECH_MODEL": "remote-model"}, clear=True):
            with self.assertRaisesRegex(ValueError, "SPEECH_MODEL"):
                native_backend(SECRET)


@unittest.skipUnless(os.environ.get("SPEECH_API_SMOKE") == "1", "Opt in with SPEECH_API_SMOKE=1 on an Apple Silicon Mac with Metal access.")
class InstalledAPISmokeTests(unittest.TestCase):
    def test_installed_release_public_api_without_model_loading(self):
        from importlib.metadata import PackageNotFoundError, version
        try:
            installed = version("whisperlivekit")
        except PackageNotFoundError:
            self.skipTest("Install speech/requirements.txt in the speech virtual environment.")
        self.assertEqual(installed, "0.2.26")
        app = native_backend("local-installed-api-check")
        self.assertEqual(app.state.config.model_size, "large-v3-turbo")
        self.assertEqual(app.state.config.asr_coalesce_min_s, 1.5)
        self.assertEqual(app.state.config.backend, "mlx-whisper")
        self.assertTrue(any(getattr(route, "path", None) == "/asr" for route in app.routes))


if __name__ == "__main__":
    unittest.main()
