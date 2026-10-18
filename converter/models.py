"""Prefetch immutable model revisions; inference never needs Internet access."""
from pathlib import Path
import argparse
import hashlib
import json
import os

REVISIONS = {
    "docling-project/docling-layout-heron": "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8",
    "docling-project/docling-layout-heron-onnx": "40bde044036bb181c130ddf6c51792187268748f",
    "docling-project/docling-models": "fc0f2d45e2218ea24bce5045f58a389aed16dc23",
}

def root():
    return Path(os.environ.get("CONVERTER_MODEL_DIR", Path(__file__).parent.parent / ".sites-runtime/docling-models")).resolve()

def models_ready():
    try:
        manifest = json.loads((root()/"studysprint-models.json").read_text())
        return manifest["revisions"] == REVISIONS and all((root()/name).is_file() and (root()/name).stat().st_size == entry["size"] for name,entry in manifest["files"].items())
    except (OSError, ValueError, KeyError):
        return False

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--verify',action='store_true');args=parser.parse_args()
    if not args.verify:
        from huggingface_hub import snapshot_download
        for repository, revision in REVISIONS.items():
            patterns = ["model_artifacts/tableformer/**", "config.json", "README.md", ".gitattributes"] if repository.endswith("docling-models") else None
            snapshot_download(repository, revision=revision, local_dir=root()/repository.replace('/','--'), allow_patterns=patterns)
        files={str(p.relative_to(root())):{"size":p.stat().st_size,"sha256":hashlib.sha256(p.read_bytes()).hexdigest()} for p in root().rglob('*') if p.is_file() and '.cache' not in p.parts and p.name!='studysprint-models.json'}
        (root()/"studysprint-models.json").write_text(json.dumps({"revisions":REVISIONS,"files":files},indent=2))
    if not models_ready():
        raise SystemExit('Local model files are missing or incomplete. Run converter setup.')
    manifest=json.loads((root()/"studysprint-models.json").read_text())
    for name, entry in manifest['files'].items():
        if hashlib.sha256((root()/name).read_bytes()).hexdigest()!=entry['sha256']:
            raise SystemExit('A local model checksum does not match. Run converter setup again.')
    print('Pinned local layout and table models are ready.')

if __name__=='__main__':main()
