"""Generate repeatable synthetic Mac speech fixtures; never capture a microphone."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
import soundfile as sf


CASES = [
    ("ordinary", "Daniel", ["Photosynthesis transforms sunlight into chemical energy. Plants use carbon dioxide and water to produce glucose and oxygen. These notes help students connect ideas and remember important information."]),
    ("red-bull", "Rishi", ["Today I had a Red Bull drink. I thought I would get caffeine hit, but did not get any. I still feel sleepy. I think I should have one more Red Bull drink. What do you say? I don't know."]),
    ("technical-numbers-pauses", "Karen", ["First, photosynthesis converts sunlight into chemical energy. The experiment used twenty five drops of water and thirteen grams of glucose.", "Neurons transmit electrical signals across synapses. The mitochondria produce energy through cellular respiration. Finish this note with the word oxygen."]),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=".sites-runtime/dictation-accuracy")
    options = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("These fixtures use macOS say voices Daniel, Rishi and Karen.")
    root = Path(options.output)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = []
    for name, voice, parts in CASES:
        arrays, rate = [], None
        for index, part in enumerate(parts):
            source = root / f"{name}-{index}.aiff"
            subprocess.run(["/usr/bin/say", "-v", voice, "-r", "155", "-o", str(source), part], check=True)
            data, current_rate = sf.read(source, dtype="float32")
            if rate is not None:
                assert rate == current_rate
                arrays.append(np.zeros(int(rate * 1.5), dtype="float32"))
            rate = current_rate
            arrays.append(data)
        audio, reference = root / f"{name}.wav", root / f"{name}.txt"
        sf.write(audio, np.concatenate(arrays), rate, subtype="PCM_16")
        reference.write_text(" ".join(parts) + "\n")
        manifest.append({"name": name, "voice": voice, "audio": str(audio), "reference": str(reference),
                         "audio_sha256": hashlib.sha256(audio.read_bytes()).hexdigest()})
    (root / "fixtures.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Generated {len(manifest)} local synthetic fixtures in {root}.")


if __name__ == "__main__":
    main()
