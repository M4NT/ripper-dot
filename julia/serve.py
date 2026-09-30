"""Sidecar do classificador Julia 1 (Supersonic Labs, mmBERT-small, Apache 2.0).

Julia 1 escolhe entre 2-20 opções dado contexto + pergunta e devolve um score por opção.
A API oficial ainda não abriu, então rodamos os pesos do Hugging Face localmente.

  pip install torch transformers
  JULIA_MODEL=<repo-no-hf> python julia/serve.py

POST /choose {"context": str, "question": str, "options": [str]} -> {"scores": [float], "best": int}
"""
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer

import torch
from transformers import AutoModelForMultipleChoice, AutoTokenizer

MODEL = os.environ.get("JULIA_MODEL", "supersoniclabs/julia-1")  # [?] confira o id exato no Hugging Face
tok = AutoTokenizer.from_pretrained(MODEL, trust_remote_code=True)
model = AutoModelForMultipleChoice.from_pretrained(MODEL, trust_remote_code=True).eval()


def choose(context, question, options):
    first = [f"{context}\n{question}"] * len(options)
    enc = tok(first, options, return_tensors="pt", padding=True, truncation=True, max_length=512)
    with torch.no_grad():
        logits = model(**{k: v.unsqueeze(0) for k, v in enc.items()}).logits[0]
    scores = torch.softmax(logits, -1).tolist()
    return {"scores": scores, "best": int(max(range(len(scores)), key=scores.__getitem__))}


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        out = json.dumps(choose(body.get("context", ""), body["question"], body["options"])).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)


HTTPServer(("127.0.0.1", int(os.environ.get("JULIA_PORT", 8765))), H).serve_forever()
