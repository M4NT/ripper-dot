#!/usr/bin/env python3
"""Sidecar do classificador Julia 1 (Supersonic Labs, Apache 2.0).

Modelo padrão: SupersonicLabs/Julia-1 no Hugging Face (não é AutoModel do Transformers).

  python -m pip install -r julia/requirements.txt
  python -c "from huggingface_hub import snapshot_download; snapshot_download('SupersonicLabs/Julia-1', local_dir='julia/Julia-1')"
  python -m pip install -e julia/Julia-1
  npm run julia

GET  /health -> {"ok": true, "model": "<id>", "dry_run": false}
POST /choose {"context": str, "question": str, "options": [str, 2..20]} -> {"scores": [float], "best": int}

Variáveis: JULIA_MODEL, JULIA_MODEL_PATH (diretório local), JULIA_PORT, JULIA_HOST, JULIA_DEVICE.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_MODEL = "SupersonicLabs/Julia-1"
HOST = os.environ.get("JULIA_HOST", "127.0.0.1")
PORT = int(os.environ.get("JULIA_PORT", "8765"))


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Julia 1 HTTP sidecar para o Ripper")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="sobe o HTTP sem carregar pesos (testes e desenvolvimento)",
    )
    return p.parse_args()


def validate_model_id(raw: str | None) -> str:
    model = (raw or DEFAULT_MODEL).strip()
    if not model:
        _die("JULIA_MODEL está vazio. Use o id Hugging Face SupersonicLabs/Julia-1 ou um diretório local via JULIA_MODEL_PATH.")
    if "[?]" in model or model.endswith("[?]"):
        _die(f"JULIA_MODEL parece placeholder: {model!r}. Confira SupersonicLabs/Julia-1 no Hugging Face.")
    if len(model) < 3:
        _die(f"JULIA_MODEL inválido: {model!r}")
    return model


def _die(msg: str) -> None:
    print(f"[julia] ERRO: {msg}", file=sys.stderr)
    sys.exit(1)


def load_engine(model_id: str):
    try:
        from julia import load_model
    except ImportError:
        _die(
            "pacote 'julia' não encontrado. Instale o runtime:\n"
            "  python -m pip install -r julia/requirements.txt\n"
            "  python -c \"from huggingface_hub import snapshot_download; "
            "snapshot_download('SupersonicLabs/Julia-1', local_dir='julia/Julia-1')\"\n"
            "  python -m pip install -e julia/Julia-1"
        )
    path = (os.environ.get("JULIA_MODEL_PATH") or "").strip() or model_id
    device = os.environ.get("JULIA_DEVICE", "cpu")
    try:
        return load_model(
            path,
            device=device,
            strict_encoding=True,
            max_length=int(os.environ.get("JULIA_MAX_LENGTH", "8192")),
            head_length=int(os.environ.get("JULIA_HEAD_LENGTH", "512")),
        )
    except Exception as exc:
        _die(f"falha ao carregar o modelo ({path}): {exc}")


def _scores_from_result(result: dict, n: int) -> list[float]:
    probs = result.get("probabilities")
    if isinstance(probs, dict):
        keys = list(probs.keys())
        if len(keys) == n:
            return [float(probs[k]) for k in keys]
    if isinstance(probs, list) and len(probs) == n:
        return [float(x) for x in probs]
    idx = int(result.get("index", 0))
    scores = [0.0] * n
    if 0 <= idx < n:
        scores[idx] = 1.0
    return scores


def choose(engine, context: str, question: str, options: list[str], dry_run: bool) -> dict:
    if len(options) < 2 or len(options) > 20:
        raise ValueError("options deve ter entre 2 e 20 itens")
    if dry_run:
        n = len(options)
        uniform = 1.0 / n
        return {"scores": [uniform] * n, "best": 0}
    row = {
        "state": context or "",
        "question": question,
        "options": options,
        "type": "choice",
    }
    result = engine.predict([row])[0]
    best = int(result["index"])
    if best < 0 or best >= len(options):
        raise ValueError("índice inválido do Julia")
    return {"scores": _scores_from_result(result, len(options)), "best": best}


class Handler(BaseHTTPRequestHandler):
    engine = None
    model_id: str = DEFAULT_MODEL
    dry_run: bool = False

    def log_message(self, _format, *_args) -> None:
        return

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0].rstrip("/") == "/health":
            self._json(200, {"ok": True, "model": self.model_id, "dry_run": self.dry_run})
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path.split("?", 1)[0].rstrip("/") != "/choose":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length))
            options = body["options"]
            out = choose(
                self.engine,
                body.get("context", ""),
                body["question"],
                options,
                self.dry_run,
            )
        except (KeyError, json.JSONDecodeError) as exc:
            self._json(400, {"error": f"corpo inválido: {exc}"})
            return
        except ValueError as exc:
            self._json(400, {"error": str(exc)})
            return
        except Exception as exc:
            self._json(500, {"error": str(exc)})
            return
        self._json(200, out)


def main() -> None:
    args = parse_args()
    model_id = validate_model_id(os.environ.get("JULIA_MODEL"))
    engine = None if args.dry_run else load_engine(model_id)
    Handler.engine = engine
    Handler.model_id = model_id
    Handler.dry_run = args.dry_run
    mode = "dry-run" if args.dry_run else "inferência"
    print(f"[julia] {mode} — modelo {model_id} em http://{HOST}:{PORT}", file=sys.stderr)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
