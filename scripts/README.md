# ScriptMate — Pre-Build Quality Gate

Single reusable quality gate that MUST run GREEN before any QA APK or
production AAB build.

## Run manually

```bash
python3 scripts/prebuild_gate.py
```

Exit code `0` → GREEN (build may proceed).
Exit code `1` → RED (build MUST NOT proceed).

## Automated wiring

`frontend/.eas/workflows/qa-apk.yml` defines two jobs:

1. `prebuild_gate` — installs deps and runs `python3 scripts/prebuild_gate.py`.
2. `build_android_qa_apk` — `needs: [prebuild_gate]`. Blocked if gate is RED.

## Checks

| Stage | Detail |
|-------|--------|
| Backend regression tests | 602 static pytest cases (allowlist in gate script) — DOCX/parser/scene-heading/dialogue-boundary/rehearsal/Learn/Phase 3/Phase 4/Premium/framing-guide/camera-hardening/etc. |
| Runtime smoke | `scripts/learn_engine_smoketest.js` (18 assertions, pure Node) |
| TypeScript check | `npx tsc --noEmit` — pass if error set is a subset of `prebuild_gate_baselines/ts_baseline.json` (37 pre-existing baseline errors) |
| Lint regression | `ruff check backend/` — pass if error set is a subset of `prebuild_gate_baselines/ruff_baseline.json` (327 pre-existing baseline findings including the 18 known "blocking" issues intentionally kept per user directive) |
| Dependencies / config | Required files exist, `package.json`/`requirements.txt` parse, `server.py` still imports `common_english_words` |

## Baseline management

Baselines live in `scripts/prebuild_gate_baselines/`.

* `ruff_baseline.json` — per-(file, rule) count of ruff findings.
* `ts_baseline.json` — per-(file, rule) count of TypeScript errors.

The gate compares current findings against baseline **per (file, rule)** —
line-shifts inside existing violations are ignored, but any NEW pair or an
increased count fails the gate. Improvements (reductions) are silently
accepted.

To refresh baselines (e.g. after an approved cleanup that reduces the count):

```bash
python3 scripts/prebuild_gate.py --update-baselines
```

## Skip flags (debug only — never use in CI)

```
--skip-tests   --skip-smoke   --skip-ts   --skip-ruff   --skip-deps
```
