FROM python:3.14.2-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    ORT_DISABLE_TELEMETRY=1 OMP_THREAD_LIMIT=1 OCR_LANGUAGES=eng \
    CONVERTER_ARTIFACT_DIR=/tmp/studysprint-converter CONVERTER_MODEL_DIR=/opt/studysprint-models

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-impress tesseract-ocr tesseract-ocr-eng \
    fonts-dejavu-core fonts-liberation ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 converter

WORKDIR /app
COPY requirements.lock /app/requirements.lock
RUN python -m pip install --no-cache-dir --disable-pip-version-check -r /app/requirements.lock
COPY . /app/converter
RUN python -m converter.models && chown -R converter:converter /opt/studysprint-models
USER converter
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s \
    CMD python -c 'import json,urllib.request; result=json.load(urllib.request.urlopen("http://127.0.0.1:8001/health", timeout=5)); raise SystemExit(0 if result["ready"] else 1)'
CMD ["python", "-m", "uvicorn", "converter.app:app", "--host", "0.0.0.0", "--port", "8001", "--workers", "1", "--no-server-header"]
