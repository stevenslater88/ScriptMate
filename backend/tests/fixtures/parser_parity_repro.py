"""Repro helper: run the frontend smartScriptParser (via the existing Node shim) and the
backend fallback_parse_script on the same fixtures and print dialogue for both."""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
from server import fallback_parse_script  # noqa: E402

SHIM = HERE.parent / "_frontend_parser_shim.js"
EXAMPLES = [
    "By a name I know not how to tell thee who I am.",
    "Time will tell.",
    "Place it there.",
    "Cast your vote.",
    "Setting the table was your job.",
    "Author of my own misfortune, that's me.",
]


def fe(raw):
    out = subprocess.run(["node", str(SHIM), raw], capture_output=True, text=True, timeout=60)
    return json.loads(out.stdout)


def be(raw):
    r = fallback_parse_script(raw)
    return [(l["character"], l["text"]) for l in r["lines"] if not l["is_stage_direction"]]


for ex in EXAMPLES:
    raw = f"ROMEO\n{ex}\n\nJULIET\nAnd then?"
    f = fe(raw)
    print("FE", [(d["character"], d["text"]) for d in f["dialogue"]], f["characters"])
    print("BE", be(raw))
