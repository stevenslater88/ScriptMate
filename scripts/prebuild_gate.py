#!/usr/bin/env python3
"""
ScriptMate — Pre-Build Quality Gate
====================================

Single reusable command that must run GREEN before any QA APK / production AAB
build is produced. Wired into ``frontend/.eas/workflows/qa-apk.yml`` so a RED
gate blocks the build.

Invocation
----------
    python3 scripts/prebuild_gate.py                # run everything
    python3 scripts/prebuild_gate.py --skip-tests   # debug helper
    python3 scripts/prebuild_gate.py --update-baselines  # refresh baselines

Design notes
------------
* Reuses the *existing* test infrastructure (backend/tests via pytest and
  scripts/learn_engine_smoketest.js). Does not duplicate coverage.
* Baseline-aware: the 18 pre-existing backend lint issues and the 37 pre-
  existing TypeScript errors are captured in
  ``scripts/prebuild_gate_baselines/`` as (file, rule) counts. The gate
  passes as long as those counts do not grow and no new (file, rule) pair
  appears. Any NEW ruff/tsc finding fails the gate.
* Never bypassed silently. Exits non-zero on any failure so CI /
  EAS Workflows will refuse the build.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
BASELINE_DIR = ROOT / "scripts" / "prebuild_gate_baselines"
RUFF_BASELINE = BASELINE_DIR / "ruff_baseline.json"
TS_BASELINE = BASELINE_DIR / "ts_baseline.json"
SMOKE_SCRIPT = ROOT / "scripts" / "learn_engine_smoketest.js"

RESULT_PASS = "PASS"
RESULT_BASELINE = "PASS (baseline-only)"
RESULT_FAIL = "FAIL"
RESULT_SKIP = "SKIP"

# Static regression suite — the deterministic pytest files that do NOT hit
# any live network endpoint and therefore run reliably in any CI/pre-build
# environment. Sourced from the 19 accumulated static suites documented in
# /app/memory/PRD.md (Feb-2026 baseline) plus the 2 new suites added for
# scene-heading/dialogue-boundary hardening. This is the count referenced by
# the parser-hardening changelog: 602 tests.
STATIC_REGRESSION_TESTS = [
    "tests/test_docx_hardening_feb2026.py",
    "tests/test_docx_intra_word_spacing.py",
    "tests/test_smart_join_and_rehearsal_scroll.py",
    "tests/test_phase3_selftape_regression.py",
    "tests/test_phase4_learn.py",
    "tests/test_fabric_safe_slider_migration.py",
    "tests/test_rehearsal_debug_ui_leak.py",
    "tests/test_ai_coming_soon_ui.py",
    "tests/test_learn_practice_mode_tabs.py",
    "tests/test_learn_resume_ux.py",
    "tests/test_teleprompter_framing_guides.py",
    "tests/test_teleprompter_ux_defaults.py",
    "tests/test_route_b_camera_hardening.py",
    "tests/test_expo_camera_stabilization_patch.py",
    "tests/test_script_import_latency_and_prep_teleprompter_removal.py",
    "tests/test_qa_premium_bypass.py",
    "tests/test_frontend_entitlement_audit.py",
    "tests/test_startup_api_diagnostic.py",
    "tests/test_scripts_create_timeout.py",
    "tests/test_scene_heading_detection_feb2026.py",
    "tests/test_dialogue_boundary_feb2026.py",
    "tests/test_daily_drill_ux_three_state_feb2026.py",
    "tests/test_end_of_screenplay_character_feb2026.py",
    "tests/test_voice_studio_script_on_screen_feb2026.py",
    "tests/test_home_more_upload_removed_feb2026.py",
    "tests/test_voice_controls_investigation_feb2026.py",
    "tests/test_voice_controls_fix_feb2026.py",
    "tests/test_home_layout_reconciliation_feb2026.py",
    "tests/test_voice_assignment_functional_feb2026.py",
]

# Files required for the frontend/backend to build/run. Missing = RED.
REQUIRED_FILES = [
    "backend/server.py",
    "backend/common_english_words.py",
    "backend/requirements.txt",
    "frontend/package.json",
    "frontend/yarn.lock",
    "frontend/tsconfig.json",
    "frontend/services/smartScriptParser.ts",
    "frontend/services/learnEngine.ts",
    "frontend/.eas/workflows/qa-apk.yml",
    "scripts/learn_engine_smoketest.js",
]


# ---------------------------------------------------------------------------
# Result plumbing
# ---------------------------------------------------------------------------


@dataclass
class CheckResult:
    name: str
    status: str  # RESULT_PASS / RESULT_BASELINE / RESULT_FAIL / RESULT_SKIP
    summary: str = ""
    details: List[str] = field(default_factory=list)
    duration_s: float = 0.0

    @property
    def is_green(self) -> bool:
        return self.status in (RESULT_PASS, RESULT_BASELINE, RESULT_SKIP)


def _run(cmd: List[str], cwd: Path, timeout: int = 900) -> Tuple[int, str, str]:
    """Run a subprocess capturing stdout/stderr. Returns (rc, out, err)."""
    proc = subprocess.run(
        cmd,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout, proc.stderr


# ---------------------------------------------------------------------------
# Baseline helpers
# ---------------------------------------------------------------------------


def _load_baseline(path: Path) -> collections.Counter:
    if not path.exists():
        return collections.Counter()
    data = json.loads(path.read_text())
    counts = collections.Counter()
    for entry in data.get("per_file_rule", []):
        counts[(entry["file"], entry["rule"])] = entry["count"]
    return counts


def _write_baseline(path: Path, counts: collections.Counter) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "total": int(sum(counts.values())),
        "per_file_rule": [
            {"file": f, "rule": r, "count": int(c)}
            for (f, r), c in sorted(counts.items())
        ],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n")


def _diff_baseline(
    baseline: collections.Counter, current: collections.Counter
) -> List[str]:
    """Return human-readable descriptions of NEW (non-baseline) findings.

    A finding is "new" if:
      - the (file, rule) pair does not exist in baseline, or
      - the (file, rule) count exceeds baseline count.

    Reductions vs baseline are silently accepted (improvements are fine).
    """
    news: List[str] = []
    for key, cur in current.items():
        base = baseline.get(key, 0)
        if cur > base:
            fn, rule = key
            news.append(f"{fn}: {rule} count {cur} (baseline {base})")
    return sorted(news)


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def check_backend_tests() -> CheckResult:
    start = time.time()
    if not BACKEND_DIR.exists():
        return CheckResult(
            "Backend regression tests",
            RESULT_FAIL,
            "backend directory missing",
            duration_s=time.time() - start,
        )
    # Verify allowlisted test files exist before invoking pytest — a missing
    # file would silently reduce coverage.
    missing = [
        t for t in STATIC_REGRESSION_TESTS if not (BACKEND_DIR / t).exists()
    ]
    if missing:
        return CheckResult(
            "Backend regression tests",
            RESULT_FAIL,
            f"{len(missing)} allowlisted test file(s) missing",
            missing,
            duration_s=time.time() - start,
        )
    try:
        rc, out, err = _run(
            [sys.executable, "-m", "pytest", *STATIC_REGRESSION_TESTS,
             "-q", "--no-header", "--tb=short"],
            cwd=BACKEND_DIR,
            timeout=1200,
        )
    except subprocess.TimeoutExpired:
        return CheckResult(
            "Backend regression tests",
            RESULT_FAIL,
            "pytest timed out (>1200s)",
            duration_s=time.time() - start,
        )
    tail = (out + err).splitlines()[-40:]
    # Extract summary line if any.
    passed = failed = errors = 0
    for line in reversed(tail):
        m = re.search(r"(\d+) failed", line)
        if m:
            failed = int(m.group(1))
        m = re.search(r"(\d+) passed", line)
        if m:
            passed = int(m.group(1))
        m = re.search(r"(\d+) error", line)
        if m:
            errors = int(m.group(1))
        if "passed" in line or "failed" in line or "error" in line:
            break
    status = RESULT_PASS if rc == 0 else RESULT_FAIL
    summary = f"{passed} passed, {failed} failed, {errors} errors"
    details = tail if rc != 0 else []
    return CheckResult(
        "Backend regression tests",
        status,
        summary,
        details,
        time.time() - start,
    )


def check_runtime_smoke() -> CheckResult:
    start = time.time()
    if not SMOKE_SCRIPT.exists():
        return CheckResult(
            "Runtime smoke (learn engine)",
            RESULT_FAIL,
            "smoke script missing",
            duration_s=time.time() - start,
        )
    try:
        rc, out, err = _run(
            ["node", str(SMOKE_SCRIPT)], cwd=ROOT, timeout=300
        )
    except subprocess.TimeoutExpired:
        return CheckResult(
            "Runtime smoke (learn engine)",
            RESULT_FAIL,
            "smoke test timed out",
            duration_s=time.time() - start,
        )
    tail = (out + err).splitlines()[-20:]
    passed = sum(1 for ln in tail if ln.strip().startswith("ok "))
    failed = sum(1 for ln in tail if "FAIL" in ln)
    status = RESULT_PASS if rc == 0 and failed == 0 else RESULT_FAIL
    return CheckResult(
        "Runtime smoke (learn engine)",
        status,
        f"{passed} ok, {failed} fail",
        tail if status == RESULT_FAIL else [],
        time.time() - start,
    )


def check_typescript(update_baseline: bool = False) -> CheckResult:
    start = time.time()
    if not FRONTEND_DIR.exists():
        return CheckResult(
            "TypeScript check",
            RESULT_FAIL,
            "frontend directory missing",
            duration_s=time.time() - start,
        )
    try:
        rc, out, err = _run(
            ["npx", "tsc", "--noEmit", "--pretty", "false"],
            cwd=FRONTEND_DIR,
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        return CheckResult(
            "TypeScript check",
            RESULT_FAIL,
            "tsc timed out",
            duration_s=time.time() - start,
        )
    combined = out + err
    pat = re.compile(r"^(.+?)\((\d+),\d+\): error (TS\d+):", re.MULTILINE)
    current = collections.Counter()
    for m in pat.finditer(combined):
        fn, _line, code = m.groups()
        current[(fn, code)] += 1
    total = sum(current.values())

    if update_baseline:
        _write_baseline(TS_BASELINE, current)
        return CheckResult(
            "TypeScript check",
            RESULT_PASS,
            f"baseline updated ({total} errors captured)",
            duration_s=time.time() - start,
        )

    baseline = _load_baseline(TS_BASELINE)
    news = _diff_baseline(baseline, current)
    if news:
        return CheckResult(
            "TypeScript check",
            RESULT_FAIL,
            f"{len(news)} NEW TypeScript error(s) beyond baseline (total {total})",
            news,
            time.time() - start,
        )
    baseline_total = int(sum(baseline.values()))
    if total == 0:
        return CheckResult(
            "TypeScript check",
            RESULT_PASS,
            "0 errors",
            duration_s=time.time() - start,
        )
    return CheckResult(
        "TypeScript check",
        RESULT_BASELINE,
        f"{total} baseline error(s), 0 new (baseline expects {baseline_total})",
        duration_s=time.time() - start,
    )


def check_ruff(update_baseline: bool = False) -> CheckResult:
    start = time.time()
    if not BACKEND_DIR.exists():
        return CheckResult(
            "Lint regression (ruff)",
            RESULT_FAIL,
            "backend missing",
            duration_s=time.time() - start,
        )
    try:
        rc, out, err = _run(
            ["ruff", "check", ".", "--output-format=json"],
            cwd=BACKEND_DIR,
            timeout=180,
        )
    except FileNotFoundError:
        return CheckResult(
            "Lint regression (ruff)",
            RESULT_FAIL,
            "ruff not installed on PATH",
            duration_s=time.time() - start,
        )
    except subprocess.TimeoutExpired:
        return CheckResult(
            "Lint regression (ruff)",
            RESULT_FAIL,
            "ruff timed out",
            duration_s=time.time() - start,
        )
    try:
        entries = json.loads(out or "[]")
    except json.JSONDecodeError as exc:
        return CheckResult(
            "Lint regression (ruff)",
            RESULT_FAIL,
            f"could not parse ruff output: {exc}",
            (out + err).splitlines()[-10:],
            time.time() - start,
        )
    current = collections.Counter()
    for e in entries:
        fn = e.get("filename", "")
        if fn.startswith(str(BACKEND_DIR) + "/"):
            fn = fn[len(str(BACKEND_DIR)) + 1 :]
        current[(fn, e.get("code", "UNK"))] += 1
    total = sum(current.values())

    if update_baseline:
        _write_baseline(RUFF_BASELINE, current)
        return CheckResult(
            "Lint regression (ruff)",
            RESULT_PASS,
            f"baseline updated ({total} findings captured)",
            duration_s=time.time() - start,
        )

    baseline = _load_baseline(RUFF_BASELINE)
    news = _diff_baseline(baseline, current)
    if news:
        return CheckResult(
            "Lint regression (ruff)",
            RESULT_FAIL,
            f"{len(news)} NEW ruff finding(s) beyond baseline (total {total})",
            news,
            time.time() - start,
        )
    baseline_total = int(sum(baseline.values()))
    if total == 0:
        return CheckResult(
            "Lint regression (ruff)",
            RESULT_PASS,
            "0 findings",
            duration_s=time.time() - start,
        )
    return CheckResult(
        "Lint regression (ruff)",
        RESULT_BASELINE,
        f"{total} baseline finding(s), 0 new (baseline expects {baseline_total})",
        duration_s=time.time() - start,
    )


def check_dependencies() -> CheckResult:
    start = time.time()
    problems: List[str] = []

    # 1. Required files.
    for rel in REQUIRED_FILES:
        if not (ROOT / rel).exists():
            problems.append(f"missing required file: {rel}")

    # 2. Backend requirements importable (light check — no network install).
    req = BACKEND_DIR / "requirements.txt"
    if req.exists():
        for line in req.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # e.g. "fastapi==0.116.2" or "package[extra]==1.0"
            name = re.split(r"[<>=!~\[; ]", line, 1)[0]
            if not name:
                problems.append(f"unparsable requirements line: {line!r}")
    else:
        problems.append("backend/requirements.txt missing")

    # 3. Frontend package.json parseable and yarn.lock present.
    pkg_path = FRONTEND_DIR / "package.json"
    lock_path = FRONTEND_DIR / "yarn.lock"
    if pkg_path.exists():
        try:
            pkg = json.loads(pkg_path.read_text())
            if "dependencies" not in pkg:
                problems.append("frontend/package.json missing 'dependencies'")
        except json.JSONDecodeError as exc:
            problems.append(f"frontend/package.json invalid JSON: {exc}")
    else:
        problems.append("frontend/package.json missing")
    if not lock_path.exists():
        problems.append("frontend/yarn.lock missing")

    # 4. Static import sanity — server.py must import common_english_words.
    server_py = BACKEND_DIR / "server.py"
    if server_py.exists():
        src = server_py.read_text()
        if "common_english_words" not in src:
            problems.append(
                "server.py no longer references common_english_words "
                "(parser hardening broken)"
            )

    status = RESULT_FAIL if problems else RESULT_PASS
    summary = "OK" if not problems else f"{len(problems)} issue(s)"
    return CheckResult(
        "Dependencies / config sanity",
        status,
        summary,
        problems,
        time.time() - start,
    )


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


CHECKS: List[Tuple[str, Callable[..., CheckResult]]] = [
    ("tests", check_backend_tests),
    ("smoke", check_runtime_smoke),
    ("ts", check_typescript),
    ("ruff", check_ruff),
    ("deps", check_dependencies),
]


def render_report(results: List[CheckResult]) -> str:
    lines: List[str] = []
    lines.append("")
    lines.append("SCRIPT MATE PRE-BUILD GATE")
    lines.append("-" * 40)
    label_map = {
        "Backend regression tests": "Tests:            ",
        "Runtime smoke (learn engine)": "Runtime smoke:    ",
        "TypeScript check": "TypeScript:       ",
        "Lint regression (ruff)": "Lint regression:  ",
        "Dependencies / config sanity": "Dependencies:     ",
    }
    for r in results:
        label = label_map.get(r.name, r.name + ":")
        lines.append(f"{label} {r.status} — {r.summary} ({r.duration_s:.1f}s)")

    overall_green = all(r.is_green for r in results)
    lines.append("-" * 40)
    lines.append(f"Overall:           {'GREEN' if overall_green else 'RED'}")
    if not overall_green:
        lines.append("Build blocked.")
        lines.append("Reason:")
        for r in results:
            if not r.is_green:
                lines.append(f"  - {r.name}: {r.summary}")
                for d in r.details[:20]:
                    lines.append(f"      {d}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="ScriptMate pre-build gate")
    parser.add_argument(
        "--update-baselines",
        action="store_true",
        help="Refresh ruff + tsc baselines from current source (use with care)",
    )
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--skip-smoke", action="store_true")
    parser.add_argument("--skip-ts", action="store_true")
    parser.add_argument("--skip-ruff", action="store_true")
    parser.add_argument("--skip-deps", action="store_true")
    args = parser.parse_args()

    skip_map = {
        "tests": args.skip_tests,
        "smoke": args.skip_smoke,
        "ts": args.skip_ts,
        "ruff": args.skip_ruff,
        "deps": args.skip_deps,
    }

    check_names = {
        "tests": "Backend regression tests",
        "smoke": "Runtime smoke (learn engine)",
        "ts": "TypeScript check",
        "ruff": "Lint regression (ruff)",
        "deps": "Dependencies / config sanity",
    }
    results: List[CheckResult] = []
    for key, fn in CHECKS:
        if skip_map[key]:
            results.append(
                CheckResult(check_names[key], RESULT_SKIP, "skipped via flag")
            )
            continue
        if key in ("ts", "ruff") and args.update_baselines:
            results.append(fn(update_baseline=True))
        else:
            results.append(fn())

    report = render_report(results)
    print(report)

    overall_green = all(r.is_green for r in results)
    return 0 if overall_green else 1


if __name__ == "__main__":
    sys.exit(main())
