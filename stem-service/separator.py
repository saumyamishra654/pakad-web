"""Demucs separation that matches raga_pipeline.audio.separate_stems output."""
import os
import torch
from demucs.pretrained import get_model
from demucs.apply import apply_model
from demucs.audio import AudioFile, save_audio


def separate(audio_path: str, out_dir: str, model_name: str = "htdemucs",
             device: str | None = None) -> tuple[str, str]:
    """Produce {out_dir}/vocals.mp3 and {out_dir}/accompaniment.mp3.

    accompaniment = sum of all non-vocal stems (drums + bass + other),
    matching raga_pipeline's separate_stems.
    """
    os.makedirs(out_dir, exist_ok=True)
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    model = get_model(model_name)
    model.to(device)

    wav = AudioFile(audio_path).read(streams=0, samplerate=model.samplerate,
                                     channels=model.audio_channels)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    sources = apply_model(model, wav[None], device=device, progress=True)[0]
    sources = sources * ref.std() + ref.mean()

    names = model.sources  # e.g. ['drums', 'bass', 'other', 'vocals']
    vocals = sources[names.index("vocals")]
    accompaniment = sum(sources[i] for i, n in enumerate(names) if n != "vocals")

    vocals_path = os.path.join(out_dir, "vocals.mp3")
    accomp_path = os.path.join(out_dir, "accompaniment.mp3")
    save_audio(vocals, vocals_path, model.samplerate, bitrate=320)
    save_audio(accompaniment, accomp_path, model.samplerate, bitrate=320)
    return vocals_path, accomp_path
