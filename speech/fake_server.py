"""Explicit synthetic ASGI fixture for browser/proxy tests; never runs a model."""

import json

from speech.app import create_app


async def fake_backend(scope, receive, send):
    if scope["type"] == "lifespan":
        await receive()
        await send({"type": "lifespan.startup.complete"})
        await receive()
        await send({"type": "lifespan.shutdown.complete"})
        return
    await receive()
    await send({"type": "websocket.accept"})
    await send({"type": "websocket.send", "text": json.dumps({
        "type": "config", "useAudioWorklet": True, "mode": "full",
    })})
    while True:
        event = await receive()
        if event["type"] == "websocket.disconnect":
            return
        eof = not event.get("bytes")
        await send({"type": "websocket.send", "text": json.dumps({
            "status": "active_transcription",
            "lines": [{"speaker": 1, "text": "Synthetic dictation fixture.", "start": "0:00:00", "end": "0:00:01"}],
            "buffer_transcription": "" if eof else "Test preview",
        })})
        if eof:
            await send({"type": "websocket.send", "text": '{"type":"ready_to_stop"}'})


if __name__ == "__main__":
    import uvicorn
    print("SYNTHETIC speech fixture: output is predetermined, no transcription model.")
    uvicorn.run(create_app(backend_factory=lambda: fake_backend), host="127.0.0.1", port=8000,
                workers=1, lifespan="on", access_log=False, log_level="warning",
                ws_max_size=32_000, ws_max_queue=4)
