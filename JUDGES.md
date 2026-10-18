# Share StudySprint from an Apple Silicon Mac

This checkout can serve StudySprint through one stable ngrok HTTPS URL while Whisper runs privately on the Mac. The default application port is **8789**, speech listens on **8000**, and ngrok's local agent API uses **4040**. The launcher refuses occupied ports; it never stops another chat's server.

## First setup

Use native ARM Node 22.13+ and Python 3.11 on the M1 Pro. Allow at least 7 GiB of free disk space for dependencies, the model and builds on a fresh setup. The speech service uses `large-v3-turbo` with English recognition, MLX and streaming transcription. Its model weights are about 1.6 GB. It accepts one active recording at a time, with up to four minutes of capture and additional time to finish the last words. Recognition waits for 1.5 seconds of new speech per pass and agreement between predictions; confirmed text can appear several seconds behind speech.

The editor displays unconfirmed speech inline in purple as soon as the engine sends it. These live words can change and are kept outside the saved note until confirmed; typing remains editable. A local microphone level indicator responds before recognition results arrive. The first draft can still take a few seconds. Stopping keeps the draft visible while the final words are processed, then clears it when the session ends.

1. Create or sign in to a **free** [ngrok account](https://dashboard.ngrok.com/signup). Copy the stable HTTPS domain assigned to that account. No paid plan, card or automatic billing is needed for this workflow. Free service limits still apply.
2. In your own terminal, follow ngrok's account instructions to authenticate the agent (`ngrok config add-authtoken YOUR_TOKEN`). Keep the real token private. Keep ngrok's local `web_addr` at its default `127.0.0.1:4040`.
3. From this checkout, install its locked JavaScript dependencies and set up speech:

```sh
npm ci
npm run judges:setup -- --public-url https://YOUR-ASSIGNED-DOMAIN
```

If Python 3.11 or ngrok is missing, install them yourself or explicitly allow the setup script to install missing Homebrew packages:

```sh
npm run judges:setup -- --public-url https://YOUR-ASSIGNED-DOMAIN --install-prerequisites
```

Homebrew itself must already be installed. `SPEECH_PYTHON=/absolute/path/to/python3.11` selects a native ARM Python interpreter when needed. Setup installs the pinned speech package into `speech/.venv` and creates an owner-readable random service secret in ignored `.sites-runtime/judges.env`. Tokens are never put in source files or printed by the launcher.

## Start and stop

```sh
npm run judges:start
```

The launcher rebuilds this checkout, prepares its separate persistent database, loads Whisper, checks speech through the app, and starts ngrok last. The first start downloads the model and VAD caches and can take several minutes. It prints **Ready to share** only after the exact configured public URL returns the app, a Secure guest cookie, healthy dictation and a successful same-origin write probe. That probe uses an invalid action and does not create a note.

Keep the terminal open and the Mac plugged in, online and with its lid open. `caffeinate` prevents idle sleep only while the launcher runs. Closing the lid, logout, restarting or losing Internet makes the link unavailable. ngrok's free browser warning may require visitors to click **Visit Site** once.

To stop the judging session, press **Ctrl+C** in its terminal, or run this from another terminal in the same checkout:

```sh
npm run judges:stop
```

Stop checks recorded process identities and process groups before signalling only this checkout's owned processes. It records descendants before stopping group leaders, so a slow child can still be stopped safely after its leader exits. If remaining ownership cannot be proved, it keeps the manifest and startup lock for inspection instead of claiming cleanup succeeded. It preserves the database, config and model caches. It does not kill unrelated processes or reset occupied ports.

For a local warmup and readiness check without exposing an Internet endpoint:

```sh
npm run judges:setup -- --local-only
npm run judges:start -- --local-only
```

Local setup needs no ngrok account or assigned domain. Local mode omits the public-origin override so HTTP note saves and microphone WebSockets use the local browser origin correctly. To share later, rerun setup with the assigned HTTPS URL and start without `--local-only`.

The original model and buffering remain available for comparison or rollback. Stop this checkout's judging session before switching profiles; then run:

```sh
SPEECH_MODEL=base npm run judges:start -- --local-only
```

Start normally to return to `large-v3-turbo`. There is no automatic fallback to the smaller model, and browsers cannot select or override the service model. Existing model caches are preserved.

To choose a different application port, rerun setup with `--port 8790`, or set `STUDYSPRINT_PORT` in the launching environment. Speech and ngrok's local API retain ports 8000 and 4040. Do not expose either private service directly.

## Test before sharing

On 18 October 2026, the original `base` profile and the accuracy profile were compared sequentially on this M1 Pro using identical synthetic Mac speech, sent in real time through the built app's WebSocket proxy. Scoring replays the actual editor reducer, so it measures the confirmed words inserted into a note, rather than later backend revisions. Case, punctuation and equivalent positive integer formatting are normalized for word-error scoring.

| Synthetic sample | Reference words | `base` word errors | `large-v3-turbo` word errors |
| --- | ---: | ---: | ---: |
| Ordinary notes, Daniel voice | 27 | 1 | 0 |
| Red Bull example, Rishi voice | 40 | 1 | 1 |
| Technical terms, numbers and a pause, Karen voice | 40 | 2 | 0 |
| Total | 107 | 4 (3.74%) | 1 (0.93%) |

The remaining substitution was **Today → Yesterday** in the Red Bull sample. Both profiles recognized Red Bull in this synthetic recording, and neither repeated “I don't know” during the ten-second quiet tail. This does not reproduce or rule out the user's microphone-specific errors. The upgraded transcript still had punctuation issues; the word score does not measure punctuation quality.

The upgraded profile's first confirmed words arrived after 3.56–7.67 seconds, with 2.33–7.23 seconds to finalize after Stop. Conservative estimates for the earliest words in newly confirmed spans reached 11.87–14.60 seconds, exceeding the ten-second target. Accuracy takes priority: the launcher does not silently select a smaller model to improve these timings. These are narrow synthetic-stream observations, not a guarantee for real voices, other accents, microphones, Internet latency or other workloads.

The evaluated MLX weights were `mlx-community/whisper-large-v3-turbo` revision `a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb` (1,613,977,612 weight bytes). Model download size is separate from runtime RAM usage. Browser microphone and public-link checks below remain necessary.

A four-minute recording test (240 seconds plus one second of quiet tail) completed without a backlog error: first confirmed text at 3.47 seconds, finalization in 8.49 seconds, and a conservative confirmation-span lag estimate of 14.69 seconds at the 95th percentile (15.49 seconds maximum). Some instances of “mitochondria” were still misspelled during this longer stream. Disconnecting an active recording released the session slot safely; a subsequent silent session produced no transcript. Confirmed text and surrounding typed text survived note save/reload in these checks.

macOS `vmmap -summary` reported a peak physical footprint of **2.2G** for the original profile after the comparison set and **4.5G** for the upgraded process after the four-minute stream. These are observed process footprints on this machine, not minimum system RAM requirements. The system already had swap in use; its sampled usage stayed unchanged during the long run, while other apps remained open.

The complete local launcher also passed startup and shutdown with the actual model. Browser typing, autosave, reload persistence, busy status and recovery to the ready state were checked. Stopping this checkout left the other local server on port 8787 running.

Repeat the opt-in local integration test against an isolated QA server using an existing synthetic audio file:

```sh
speech/.venv/bin/python tests/dictation-live.py --audio /absolute/path/to/sample.aiff --seconds 180
```

The test creates and deletes only its own disposable note, checks guest/origin isolation and concurrent-session rejection, and requires text before Stop plus final acknowledgement. It accepts only a loopback QA server; it does not record a microphone.

Generate the comparison fixtures locally, then test each profile against the same files without regenerating between profiles:

```sh
speech/.venv/bin/python tests/dictation-fixtures.py
speech/.venv/bin/python tests/dictation-live.py --audio .sites-runtime/dictation-accuracy/red-bull.wav --reference .sites-runtime/dictation-accuracy/red-bull.txt --tail-seconds 10 --report .sites-runtime/dictation-accuracy/red-bull-check.json
```

The ignored `.sites-runtime/dictation-accuracy/` folder stores generated synthetic audio, reference text, audio hashes, measurements and optional message replays. This QA storage is separate from live microphone dictation, which does not save recordings. `--speech-pid OWNED_SPEECH_PID` adds process RSS and system memory-pressure/swap samples; RSS alone excludes important GPU allocations and must not be presented as the model's RAM requirement. `vmmap -summary OWNED_SPEECH_PID` provides an additional physical-footprint measurement. System swap and pressure also reflect other apps.

Open the printed HTTPS URL on a phone or second computer. Allow microphone access, open a note, start dictation, speak a sentence, stop, and confirm the final text and **Saved** status after a reload. Test Safari and Chrome where available, plus a second visitor attempting to dictate while the first is recording: that visitor should see the service is busy. Readiness checks establish connectivity; they do not verify microphone quality or end-to-end transcription accuracy.

Typing and the rest of StudySprint remain usable while another visitor dictates. The dictation feature sends audio through ngrok to this Mac. Raw audio is processed transiently rather than saved as a recording; inserted transcript text is saved with the note. The launcher disables ngrok HTTP inspection and speech access logs; ngrok still transports the encrypted connection and its service terms apply. Share the URL with intended testers; anyone with it can reach the guest app.

## Data and troubleshooting

- Each browser receives a separate guest workspace. There are no accounts or automatic cross-device sync. Keep the same assigned URL across judging sessions; clearing cookies or changing hostname loses that browser's access until a backup is restored.
- Judging data lives in `.wrangler/judges-state`, separate from ordinary `.wrangler/state`. The launcher checks for the committed initial schema and applies it only to a fresh database, first copying the local state into `.sites-runtime/judges/backups`. It refuses partial schemas and never blindly replays migrations.
- Private settings live outside the build in `.sites-runtime/judges.env`. A fresh `dist/server/.dev.vars` is generated for this run after each build, containing only the public origin, loopback speech URL and private service secret. Downloaded models and runtime caches also stay inside this checkout's ignored `.sites-runtime` directory.
- Private service logs and process ownership records live under `.sites-runtime/judges/`. A failed startup cleans up owned processes. Inspect these logs locally when the launcher reports a readiness failure; do not publish them or credentials.
- A port collision means another process already owns that port. Stop that process yourself if appropriate, or choose a different app port. No launcher command replaces it automatically.
- If ngrok fails, confirm account authentication, the exact assigned domain, the free account's current limits and default local API address. The scripts never create a paid subscription or change billing settings.

References: [ngrok CLI](https://ngrok.com/docs/gateway/agent/cli), [ngrok agent configuration](https://ngrok.com/docs/gateway/agent/config/v3), and [WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit).
