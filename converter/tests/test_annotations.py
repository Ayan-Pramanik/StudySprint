import hashlib
from pathlib import Path
from uuid import uuid4
import pikepdf
import pypdfium2 as pdfium
import pytest
from reportlab.pdfgen import canvas
from converter.pdf_tools import export_annotated,text_pdf,describe_pdf
from converter.conversion import ConversionError,convert


def test_flattened_marks_follow_rotated_cropped_offset_pages_and_keep_text(tmp_path):
    source=tmp_path/'source.pdf'
    c=canvas.Canvas(str(source),pagesize=(400,500))
    for _ in range(4):
        c.setFillColorRGB(0,0,0);c.rect(95,145,10,10,fill=1,stroke=0)
        c.drawString(70,350,'Selectable original study text')
        c.showPage()
    c.save()
    with pikepdf.open(source,allow_overwriting_input=True) as pdf:
        for index,page in enumerate(pdf.pages):
            page.mediabox=[-10,-20,390,480];page.cropbox=[30,40,360,440]
            page.obj['/Rotate']=index*90
            page.obj['/UserUnit']=2 if index==3 else 1
        pdf.save(source)
    before=source.read_bytes();marks=[]
    for page in range(1,5):
        marks.append({'id':str(uuid4()),'data':{'type':'ink','page':page,'color':'#ff0000','width':5,'points':[[95,150],[105,150]]}})
    out=tmp_path/'annotated.pdf';export_annotated(source,out,marks)
    with pikepdf.open(source) as src,pikepdf.open(out) as dst:
        for a,b in zip(src.pages,dst.pages):
            assert list(a.mediabox)==list(b.mediabox)
            assert list(a.cropbox)==list(b.cropbox)
            assert a.obj['/Rotate']==b.obj['/Rotate']
            assert a.obj['/UserUnit']==b.obj['/UserUnit']
    with pdfium.PdfDocument(source) as original,pdfium.PdfDocument(out) as exported:
        for a,b in zip(original,exported):
            assert 'Selectable original study text' in b.get_textpage().get_text_range()
            first=a.render(scale=1).to_pil().convert('RGB');second=b.render(scale=1).to_pil().convert('RGB')
            black=[(x,y) for y in range(first.height) for x in range(first.width) if all(v<30 for v in first.getpixel((x,y))) ]
            red=[(x,y) for y in range(second.height) for x in range(second.width) if (lambda p:p[0]>200 and p[1]<80 and p[2]<80)(second.getpixel((x,y)))]
            assert red,'The exported stroke must remain visible.'
            # The known 10x10 black marker contains the intended stroke centre.
            cx=sum(x for x,y in red)/len(red);cy=sum(y for x,y in red)/len(red)
            assert any(abs(x-cx)<2 and abs(y-cy)<2 for x,y in black),'Flattened annotations drifted from PDF page coordinates.'
    assert source.read_bytes()==before


def test_all_marks_comments_appendix_unicode_and_no_native_annotation_dependency(tmp_path):
    source=tmp_path/'source.pdf';text_pdf('Original text αβ 中文',source)
    marks=[
      {'id':'a','data':{'type':'highlight','page':1,'color':'#ffff00','quads':[[42,800,180,800,180,780,42,780]]}},
      {'id':'b','data':{'type':'underline','page':1,'color':'#0000ff','quads':[[42,770,180,770,180,755,42,755]]}},
      {'id':'c','data':{'type':'comment','page':1,'color':'#ff0000','anchor':[200,700],'text':'Remember αβ 中文'}},
    ]
    output=tmp_path/'annotated.pdf';export_annotated(source,output,marks)
    with pdfium.PdfDocument(output) as pdf:
        assert len(pdf)==2
        assert 'Original text' in pdf[0].get_textpage().get_text_range()
        assert 'Remember αβ 中文' in pdf[1].get_textpage().get_text_range()
    with pikepdf.open(output) as pdf:
        assert not pdf.pages[0].obj.get('/Annots')
        assert '/XObject' in pdf.pages[0].Resources


def test_text_base_unicode_long_lines_limits_and_stability(tmp_path):
    source=tmp_path/'source.txt';source.write_text('αβ 中文\n'+('long line '*150)+'\n\nParagraph two.',encoding='utf-8')
    result=convert(source,tmp_path)
    assert len(result['base']['pages'])==1
    with pdfium.PdfDocument(tmp_path/'preview.pdf') as pdf:
        assert 'αβ 中文' in pdf[0].get_textpage().get_text_range()
        assert 'Paragraph two.' in pdf[0].get_textpage().get_text_range()
    original=(tmp_path/'preview.pdf').read_bytes();pinned=tmp_path/'pinned.pdf';pinned.write_bytes(original)
    source.write_text('Changed Markdown',encoding='utf-8');convert(source,tmp_path,base=pinned)
    assert (tmp_path/'preview.pdf').read_bytes()==original
    with pytest.raises(ConversionError,match='100 pages'):
        text_pdf('\n'*6000,tmp_path/'too-long.pdf')


@pytest.mark.parametrize('data',[
 {'type':'ink','page':1,'color':'#ff0000','points':[[1,1],[float('nan'),1]]},
 {'type':'comment','page':1,'color':'#ff0000','anchor':[9999,1],'text':'bad'},
 {'type':'highlight','page':1,'color':'#ff0000','quads':[]},
])
def test_export_rejects_invalid_geometry(tmp_path,data):
    source=tmp_path/'source.pdf';text_pdf('Text',source)
    with pytest.raises(ConversionError):export_annotated(source,tmp_path/'bad.pdf',[{'data':data}])
