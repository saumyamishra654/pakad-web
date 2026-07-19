# Runtime (not devel) CUDA base: we run Demucs, never compile. Ships torch
# 2.2.2 + CUDA 12.1 runtime; far smaller than the -devel- image.
FROM pytorch/pytorch:2.2.2-cuda12.1-cudnn8-runtime

# ffmpeg: Demucs's AudioFile decodes/encodes through it. Clean apt lists after.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# torchaudio must match the base's torch (2.2.2 / cu121). Pull it from the
# pytorch CUDA index so pip doesn't drag in a mismatched build (torch itself is
# already present and stays untouched).
RUN pip install --no-cache-dir torchaudio==2.2.2 --index-url https://download.pytorch.org/whl/cu121

# demucs + runpod + requests (demucs's torch/torchaudio deps are already satisfied).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY separator.py handler.py ./

# htdemucs weights are NOT baked in -- attach RunPod model cache / a network
# volume so they download once per host, not per image pull.
CMD ["python", "-u", "handler.py"]
