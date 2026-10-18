"""Run supplied acceptance documents in isolated workers and record native metrics."""
import json
import subprocess
import sys
import tempfile
import re
from pathlib import Path
repo=Path(__file__).resolve().parent.parent
samples=[repo.parent/'somatosensory.pdf',repo.parent/'Dickinson_Sample_Slides.pptx']
report=[]
for source in samples:
    if not source.is_file():raise SystemExit(f'Missing acceptance file: {source}')
    work=Path(tempfile.mkdtemp(prefix='studysprint-acceptance-'))
    copy=work/('source'+source.suffix);copy.write_bytes(source.read_bytes())
    result=subprocess.run([sys.executable,'-m','converter.worker',str(copy),str(work),'eng'],cwd=repo,capture_output=True,text=True)
    if result.returncode:raise RuntimeError((work/'error.json').read_text() if (work/'error.json').exists() else result.stderr[-2000:])
    value=json.loads((work/'result.json').read_text());body=value['markdown']
    if source.suffix=='.pdf':
        assert len(value['assets'])==3
        assert all(f'Figure {i}:' in body for i in (1,2,3))
        assert '| Rapidly adapting' in body or 'Rapidly adapting' in body
        assert '> This is a sample document' in body
        assert '> Notice how figure captions' in body
        assert '## Cutaneous receptors' in body
        assert 'De- tect' not in body and 'spa- tial' not in body
    else:
        assert body.count('## Slide ')==9
        assert len(value['assets'])==5
        assert all(f'## Slide {i}' in body for i in range(1,10))
        assert '### Speaker notes' in body
        assert 'Cover slide option #1' in body and 'Cover slide option #3' in body
        assert len(re.findall(r'^- ',body,re.MULTILINE))==7
        assert 'Graph information' in body and '($1.0)' in body and '$6.5' in body
        assert '4.300000000000001' not in body
    (work/'note.md').write_text(body)
    value['metrics']['peakMemoryMiB']=round(value['metrics']['peakMemoryBytes']/1024/1024,1)
    export_work=Path(tempfile.mkdtemp(prefix='studysprint-export-benchmark-'))
    left,bottom,right,top=value['base']['pages'][0]['cropBox']
    marks=[{'id':'benchmark','data':{'type':'comment','page':1,'color':'#ff0000','anchor':[left+30,top-30],'text':'Benchmark annotation αβ 中文'}}]
    (export_work/'annotations.json').write_text(json.dumps(marks))
    exported=subprocess.run([sys.executable,'-m','converter.worker',str(work/'preview.pdf'),str(export_work),'eng','export'],cwd=repo,capture_output=True,text=True)
    if exported.returncode:raise RuntimeError(exported.stderr)
    export_metrics=json.loads((export_work/'result.json').read_text())['metrics']
    export_metrics['peakMemoryMiB']=round(export_metrics['peakMemoryBytes']/1024/1024,1)
    report.append({'export':export_metrics,'name':source.name,'pages':len(value['base']['pages']),'images':len(value['assets']),**value['metrics'],'output':str(work)})
    print(json.dumps(report[-1]),flush=True)
(repo/'.sites-runtime').mkdir(exist_ok=True)
(repo/'.sites-runtime/document-benchmark.json').write_text(json.dumps(report,indent=2))
