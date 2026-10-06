# ScriptMate — Delete Account page (manual-paste bundle)

**Source for the GitHub Pages site `stevenslater88/ScriptMate` is NOT in this
workspace** (this workspace holds the mobile app + backend only). Follow the
one-step instruction below to publish the Google Play Data Safety deletion
URL.

## What to do

1. In your `github.com/stevenslater88/ScriptMate` repository, at the **root**
   of the default branch (the branch GitHub Pages serves — usually `main` or
   `gh-pages`), add the file `delete-account.md` from this folder.
2. Commit, push.
3. GitHub Pages rebuilds automatically within ~30-90 seconds.
4. The URL `https://stevenslater88.github.io/ScriptMate/delete-account`
   will serve the page (Jekyll strips the `.md` extension).
5. Paste that URL into Google Play Console → App content → Data safety →
   **Account deletion URL / Delete data URL**.

## Why this is a safe one-file drop-in

The current `stevenslater88.github.io/ScriptMate/` site renders using
GitHub's **default `jekyll-theme-primer`** theme (confirmed by the
`<div class="container-lg px-3 my-5 markdown-body">` wrapper on the live
site). That means **any `*.md` file at the repo root is auto-rendered with
the same styling as the existing index.** No `_config.yml`, no HTML, no CSS,
no CI steps required.

## What was reused vs. authored

| Element | Source |
|---|---|
| Contact email `support@scriptmate.app` | **Reused** from `frontend/services/diagnosticsService.ts:563,572` — the same address the in-app Support screen uses for bug reports and the diagnostic mailto. **NOT invented.** |
| Deletion process (email a request) | Derived from the existing support channel — no automated DELETE route exists in the backend, so this is stated factually. **No fake automation claimed.** |
| List of data categories deleted | Derived directly from the backend data model (`db.users`, `db.scripts`, `db.rehearsals`, `db.daily_drills`, `db.auth_tokens`, `db.tts_usage`). |
| Retention clause for TTS usage ledger | Derived from the explicit comment in `backend/server.py` describing `tts_usage` as a billing-reconciliation ledger. **Honest disclosure.** |
| Processing timeframe (30 days) | **Default GDPR Article 12(3) ceiling.** Google Play Data Safety requires a stated timeframe. If your internal SLA is different (e.g. 7 or 14 days), edit the single line `## Processing time` before you push. |

## If you want a different turn-around time than 30 days

Change the one line under `## Processing time` in `delete-account.md`.
Everything else can stay. 30 days is the maximum allowed under GDPR / UK
GDPR; using less is fine, using more is not.
