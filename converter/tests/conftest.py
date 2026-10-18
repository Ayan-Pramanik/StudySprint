from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


@pytest.fixture
def pdf_factory(tmp_path):
    def make(kind="digital", pages=1):
        destination = tmp_path / f"{kind}-{pages}.pdf"
        pdf = canvas.Canvas(str(destination), pagesize=(612, 792))
        font_candidates = [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
        font_path = next((path for path in font_candidates if Path(path).is_file()), None)
        font = ImageFont.truetype(font_path, 52) if font_path else ImageFont.load_default(size=52)
        for index in range(pages):
            if kind in {"digital", "mixed"}:
                pdf.setFont("Helvetica", 18)
                pdf.drawString(40, 740, f"DIGITAL memory lecture {index + 1}")
                pdf.setFont("Helvetica", 12)
                pdf.drawString(40, 710, "Retrieval practice strengthens memory.")
            if kind in {"scanned", "mixed"}:
                image = Image.new("RGB", (1500, 700), "white")
                draw = ImageDraw.Draw(image)
                draw.text((80, 130), "SCANNED study material", font=font, fill="black")
                draw.text((80, 240), "Spaced repetition improves retention.", font=font, fill="black")
                pdf.drawImage(ImageReader(image), 40, 300, width=520, height=243)
            pdf.showPage()
        pdf.save()
        return destination
    return make
