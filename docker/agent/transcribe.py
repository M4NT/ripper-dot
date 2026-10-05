# Transcreve um áudio (ditado do Ripper, áudio do WhatsApp). Uso: transcribe.py <arquivo> [modelo]
# Roda na CPU; o modelo baixa uma vez para /root/.cache (volume do Ripper).
import sys
from faster_whisper import WhisperModel

model = WhisperModel(sys.argv[2] if len(sys.argv) > 2 else "base", device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1], language="pt", vad_filter=True, beam_size=1)
print(" ".join(s.text.strip() for s in segments).strip())
