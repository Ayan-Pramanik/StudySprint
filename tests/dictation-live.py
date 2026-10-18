"""Opt-in real Worker + speech service integration test using synthetic audio.

Run with speech/.venv/bin/python tests/dictation-live.py --audio sample.aiff.
All notes are test-only, created in the selected server and deleted afterward.
No microphones, paid APIs, or external transcription services are used.
"""
import argparse
import asyncio
import json
import math
from pathlib import Path
import re
import sys
import time
import uuid
import urllib.request
from urllib.error import HTTPError

import numpy as np
import soundfile
from scipy.signal import resample_poly
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from speech.benchmark_metrics import audio_time, percentile, word_errors


def api(base, path, cookie="", payload=None):
    headers = {"Cookie": cookie}
    if payload is not None:
        headers.update({"Origin": base, "Content-Type": "application/json"})
    request = urllib.request.Request(base + path, headers=headers,
                                    data=None if payload is None else json.dumps(payload).encode())
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response), response.headers.get("Set-Cookie", "").split(";")[0]


def create_session(base):
    _, cookie = api(base, '/api/auth/signup', payload={"name":"Dictation QA", "email":f"dictation-{uuid.uuid4()}@example.invalid", "password":str(uuid.uuid4())})
    api(base, '/api/workspace', cookie)
    return cookie


async def main(options):
    base = options.url.rstrip("/")
    if not base.startswith("http://127.0.0.1:"):
        raise ValueError("This test creates disposable notes; use an isolated local QA server.")
    if options.disconnect_after and not options.audio:
        raise ValueError("Disconnect testing requires a synthetic audio fixture.")
    cookie = create_session(base)
    result, _ = api(base, "/api/workspace", cookie, {
        "action": "note", "title": f"Synthetic dictation check {time.time_ns()}", "body": "", "subject": "",
    })
    note = result["workspace"]["notes"][-1]["id"]
    address = base.replace("http://", "ws://", 1) + "/api/dictation?noteId=" + note
    print("Created disposable integration note; checking isolation and origin.", flush=True)
    try:
        other_cookie = create_session(base)
        for rejected_cookie, origin, expected in ((other_cookie, base, 404), (cookie, "https://attacker.example", 403)):
            try:
                async with connect(address, origin=origin, additional_headers={"Cookie": rejected_cookie}):
                    raise AssertionError("Unauthorized WebSocket was accepted")
            except InvalidStatus as error:
                assert error.response.status_code == expected, error.response.status_code
        status, _ = api(base, "/api/dictation/status", cookie)
        assert status == {"configured": True, "available": True, "busy": False}, status

        if options.audio:
            audio, rate = soundfile.read(options.audio, dtype="float32", always_2d=True)
            audio = audio.mean(axis=1)
            factor = math.gcd(rate, 16000)
            audio = resample_poly(audio, 16000 // factor, rate // factor).astype(np.float32)
            if options.seconds:
                audio = np.tile(audio, math.ceil(options.seconds * 16000 / len(audio)))[:int(options.seconds * 16000)]
        else:
            audio = np.zeros(16000, dtype=np.float32)
        # A short silence tail lets VAD close the last spoken phrase.
        audio = np.concatenate((audio, np.zeros(16000, dtype=np.float32)))
        if options.tail_seconds > 1:
            audio = np.concatenate((audio, np.zeros(int((options.tail_seconds - 1) * 16000), dtype=np.float32)))
        pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
        events, text_updates, rss_samples = [], [], []
        timed_events, pressure_samples, swap_samples = [], [], []
        async with connect(address, origin=base, additional_headers={"Cookie": cookie}, max_size=1_000_000) as socket:
            config = json.loads(await asyncio.wait_for(socket.recv(), 10))
            assert config.get("type") == "config" and config.get("useAudioWorklet") is True, config
            async with connect(address, origin=base, additional_headers={"Cookie": cookie}) as second:
                busy = json.loads(await asyncio.wait_for(second.recv(), 5))
                assert busy.get("code") == "busy", busy
            started = time.monotonic()

            async def receive():
                async for raw in socket:
                    event = json.loads(raw)
                    events.append(event)
                    timed_events.append({"at": time.monotonic() - started, "event": event})
                    assert event.get("type") != "error", event
                    committed = " ".join(line.get("text", "") for line in event.get("lines", []) if line.get("speaker") != -2)
                    if committed.strip() or event.get("buffer_transcription", "").strip():
                        text_updates.append((time.monotonic() - started, committed, event.get("buffer_transcription", "")))
                    if event.get("type") == "ready_to_stop":
                        return
                raise AssertionError("Speech socket closed without ready_to_stop")

            receiver = asyncio.create_task(receive())
            async def sample_memory():
                while True:
                    process = await asyncio.create_subprocess_exec('/bin/ps', '-p', str(options.speech_pid), '-o', 'rss=', stdout=asyncio.subprocess.PIPE)
                    output, _ = await process.communicate()
                    if process.returncode == 0 and output.strip():
                        rss_samples.append(int(output.strip()) / 1024)
                    pressure = await asyncio.create_subprocess_exec('/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level', 'vm.swapusage', stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                    output, _ = await pressure.communicate()
                    if pressure.returncode == 0:
                        lines = output.decode().splitlines()
                        if lines and lines[0].strip().isdigit():
                            pressure_samples.append(int(lines[0]))
                        match = re.search(r'used\s*=\s*([\d.]+)M', output.decode())
                        if match:
                            swap_samples.append(float(match[1]))
                    await asyncio.sleep(2)
            monitor = asyncio.create_task(sample_memory()) if options.speech_pid else None
            disconnected = False
            sent_audio_bytes = 0
            try:
                for offset in range(0, len(pcm), 16000):
                    frame = pcm[offset:offset + 16000]
                    await socket.send(frame)
                    sent_audio_bytes += len(frame)
                    await asyncio.sleep(0.5)
                    if receiver.done():
                        await receiver
                        raise AssertionError("Speech session ended before audio was sent")
                    if options.disconnect_after and time.monotonic() - started >= options.disconnect_after:
                        disconnected = True
                        receiver.cancel()
                        await asyncio.gather(receiver, return_exceptions=True)
                        await socket.close()
                        break
                sent_at = time.monotonic()
                if not disconnected:
                    await socket.send(b"")
                    await asyncio.wait_for(receiver, 30)
                duration = time.monotonic() - started
            finally:
                if not receiver.done():
                    receiver.cancel()
                    await asyncio.gather(receiver, return_exceptions=True)
                if monitor:
                    monitor.cancel()
                    await asyncio.gather(monitor, return_exceptions=True)
        backend_text = next((" ".join(line.get("text", "") for line in event.get("lines", []) if line.get("speaker") != -2)
                     for event in reversed(events) if event.get("lines")), "")
        replay = await asyncio.create_subprocess_exec('node', 'scripts/local-run.mjs', '--experimental-strip-types', 'tests/dictation-editor-replay.mjs',
                     stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        replay_output, replay_errors = await replay.communicate(json.dumps(timed_events).encode())
        assert replay.returncode == 0, replay_errors.decode()
        editor = json.loads(replay_output)
        text = editor["text"]
        committed_updates = [(update["at"], max(0, update["at"] - audio_time(update["spanStart"])))
                             for update in editor["confirmations"] if audio_time(update.get("spanStart")) is not None]
        if options.audio and not disconnected:
            assert text.strip(), "Real model produced no confirmed words"
            if options.expect:
                assert options.expect.lower() in text.lower(), text
            assert any(update[0] < sent_at - started for update in text_updates), "Text only appeared after Stop"
        elif not options.audio:
            assert not text.strip(), "A silent new session inherited or invented confirmed speech"
        released_at = time.monotonic()
        for _ in range(350):
            status, _ = api(base, "/api/dictation/status", cookie)
            if not status["busy"]:
                break
            await asyncio.sleep(0.1)
        assert not status["busy"], "Session slot was not released"
        release_wait = round(time.monotonic() - released_at, 2)
        saved_body = "Typed before dictation.\n" + text + "\nTyped after dictation."
        api(base, "/api/workspace", cookie, {"action": "note", "id": note, "title": "Synthetic dictation save check", "body": saved_body, "subject": ""})
        reloaded, _ = api(base, "/api/notes/" + note, cookie)
        assert reloaded["note"]["body"] == saved_body, "Confirmed text or typing was lost on save/reload"
        lags = [lag for _, lag in committed_updates if lag is not None]
        report = {
            "audio_seconds": round(len(audio) / 16000, 2),
            "sent_audio_seconds": round(sent_audio_bytes / 32000, 2),
            "first_text_seconds": round(text_updates[0][0], 2) if text_updates else None,
            "first_confirmed_seconds": round(committed_updates[0][0], 2) if committed_updates else None,
            "p95_confirmed_span_lag_upper_estimate_seconds": round(percentile(lags, 95), 2) if lags else None,
            "max_confirmed_span_lag_upper_estimate_seconds": round(max(lags), 2) if lags else None,
            "finalization_seconds": None if disconnected else round(duration - (sent_at - started), 2),
            "disconnected_during_recording": disconnected,
            "slot_release_wait_seconds": release_wait,
            "text_updates": len(text_updates), "confirmed_characters": len(text),
            "peak_speech_process_rss_mib": round(max(rss_samples), 1) if rss_samples else None,
            "system_memory_pressure_levels": sorted(set(pressure_samples)),
            "system_swap_used_mib_start": swap_samples[0] if swap_samples else None,
            "system_swap_used_mib_peak": max(swap_samples) if swap_samples else None,
            "transcript": text,
            "backend_final_transcript": backend_text,
            "transcript_preview": text[:220], "checks": "origin, ownership, HTTP101 proxy, busy, streaming, " + ("disconnect" if disconnected else "EOF") + ", slot release, actual editor reducer, typed text and note save/reload",
        }
        if options.reference:
            report.update(word_errors(Path(options.reference).read_text(), text))
        if options.report:
            Path(options.report).write_text(json.dumps(report, indent=2) + "\n")
            # Synthetic fixture messages only, for independent reducer replay.
            Path(options.report + '.events.json').write_text(json.dumps(timed_events) + "\n")
        print(json.dumps(report, indent=2), flush=True)
    finally:
        api(base, "/api/workspace", cookie, {"action": "deleteNote", "id": note})


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8789")
    parser.add_argument("--audio")
    parser.add_argument("--seconds", type=float, default=0)
    parser.add_argument("--expect")
    parser.add_argument("--reference", help="UTF-8 expected transcript; computes case/punctuation/number-normalized word errors.")
    parser.add_argument("--report", help="Save synthetic QA metrics and transcript to this JSON file.")
    parser.add_argument("--tail-seconds", type=float, default=1, help="Trailing silence for hallucination checks (default 1 second).")
    parser.add_argument("--disconnect-after", type=float, default=0, help="Close a synthetic recording early, then verify safe slot release.")
    parser.add_argument("--speech-pid", type=int, help="Optional owned speech process PID; RSS excludes other processes and may exclude GPU allocations.")
    asyncio.run(main(parser.parse_args()))
