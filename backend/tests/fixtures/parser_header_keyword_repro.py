"""Repro helper: parse each dialogue example and print (character, is_stage_direction, text)."""
import sys
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from server import fallback_parse_script

EXAMPLES = [
    "By a name I know not how to tell thee who I am.",
    "Time will tell.",
    "Place it there.",
    "Cast your vote.",
    "Setting the table was your job.",
    "Author of my own misfortune, that's me.",
]
for ex in EXAMPLES:
    r = fallback_parse_script(f"ROMEO\n{ex}")
    print([(l["character"], l["is_stage_direction"], l["text"]) for l in r["lines"]])
for hdr in ["TITLE: THE CALL", "Title: The Reunion", "AUTHOR: Alex", "CHARACTERS:", "WRITTEN BY Jane Doe", "SETTING some trailing text"]:
    r = fallback_parse_script(f"{hdr}\n\nJACK\nHello.")
    print(hdr, "->", [(l["character"], l["is_stage_direction"]) for l in r["lines"]], sorted(r["characters"]))
