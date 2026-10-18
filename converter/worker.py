"""Disposable conversion process. Structured errors keep tool output out of API responses."""

import json
import sys
import time
import resource
from pathlib import Path

from .conversion import ConversionError, convert


def main() -> int:
    started = time.monotonic()
    source, work, languages = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    try:
        mode = sys.argv[4] if len(sys.argv) > 4 else 'convert'
        base = work / 'base.pdf'
        if mode == 'export':
            from .pdf_tools import export_annotated
            export_annotated(source, work / 'annotated.pdf', json.loads((work / 'annotations.json').read_text()))
            result = {'export': True, 'preview': False}
        else:
            result = convert(source, work, languages, base if base.is_file() else None, mode == 'prepare')
        result['metrics'] = {'seconds':round(time.monotonic()-started,3),'peakMemoryBytes':int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024))}
        (work / "result.json").write_text(json.dumps(result), encoding="utf-8")
        return 0
    except ConversionError as error:
        (work / "error.json").write_text(json.dumps({"error": str(error)}), encoding="utf-8")
        return 2
    except Exception:
        # Detailed trace is private server stderr, never returned to the browser.
        import traceback
        traceback.print_exc()
        (work / "error.json").write_text(json.dumps({"error": "The document could not be converted. Check the file and retry."}), encoding="utf-8")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
