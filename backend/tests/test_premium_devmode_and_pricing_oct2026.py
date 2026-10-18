"""Premium bypass + pricing-claim fixes (Oct 2026).

1. Dev Test Mode (services/devTestMode.ts) was reachable in production builds via the
   5-tap logo gesture / dashboard -> /debug toggle and made the client treat the user as
   Premium with no purchase. It is now honoured only when __DEV__ is true (release AABs
   are built with __DEV__ === false) and the toggle is hidden outside dev builds.
2. The paywall's hardcoded "Save 50%" yearly badge was false (GBP £4.99 x 12 = £59.88 vs
   £39.99/yr ~= 33%). The badge is removed; no replacement figure is invented."""
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parents[1] / "frontend"
HARNESS = HERE / "fixtures/dev_test_mode_harness.js"
PREMIUM = (FRONTEND / "app/premium.tsx").read_text()
DEBUG = (FRONTEND / "app/debug.tsx").read_text()


def _run(mode: str) -> dict:
    out = subprocess.run(["node", str(HARNESS), mode], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_release_build_cannot_enter_dev_test_mode():
    # Even with the toggle previously stored as "true" and re-enabled, a release build reports false.
    assert _run("release") == {"stored": False, "afterEnable": False, "cached": False}


def test_dev_build_keeps_dev_test_mode_for_internal_qa():
    assert _run("dev") == {"stored": True, "afterEnable": True, "cached": True}


def test_premium_consumers_only_use_the_guarded_helper():
    for rel in ["hooks/useRevenueCat.ts", "store/scriptStore.ts", "app/_layout.tsx"]:
        src = (FRONTEND / rel).read_text()
        assert "SCRIPTM8_DEV_TEST_MODE" not in src, rel
        assert "from '../services/devTestMode'" in src, rel
    hook = (FRONTEND / "hooks/useRevenueCat.ts").read_text()
    assert "isDevTestMode().then(setDevTestModeActive)" in hook
    # Real entitlement path untouched.
    assert "customerInfo?.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined" in hook


def test_dev_test_mode_toggle_hidden_outside_dev_builds():
    start = DEBUG.index("{/* Dev Test Mode (development builds only) */}")
    section = DEBUG[start:DEBUG.index("{/* Clear Logs Button */}", start)]
    assert section.split("\n")[1].strip() == "{__DEV__ && ("
    assert 'data-testid="dev-test-mode-toggle"' in section
    assert section.rstrip().endswith(")}")


def test_debug_entry_points_unchanged_for_diagnostics():
    assert "router.push('/debug')" in (FRONTEND / "app/index.tsx").read_text()


def test_paywall_has_no_unsupported_discount_claim():
    assert "Save 50%" not in PREMIUM
    assert not re.search(r"Save\s*\d+\s*%|\d+\s*%\s*off", PREMIUM, re.I)
    assert "textDecorationLine: 'line-through'" not in PREMIUM


def test_paywall_prices_trial_purchase_and_restore_preserved():
    assert "return yearlyPackage.product.priceString;" in PREMIUM
    assert "return monthlyPackage.product.priceString;" in PREMIUM
    assert "hasIntroOffer(yearlyPackage)" in PREMIUM
    assert "Start 7-Day Free Trial" in PREMIUM
    assert 'data-testid="yearly-plan-card"' in PREMIUM and 'data-testid="monthly-plan-card"' in PREMIUM
    assert "restorePurchases" in PREMIUM or "handleRestore" in PREMIUM
