"""VC1142 — Android free-trial detection.

Behaviour tests execute the real `services/trialOffer.ts` in Node (sucrase)
against RevenueCat `PurchasesStoreProduct` shapes as mapped by
purchases-hybrid-common 17.41.0 on Android.
"""
import json
import subprocess
from pathlib import Path

FRONTEND = Path("/app/frontend")
PREMIUM_SRC = (FRONTEND / "app/premium.tsx").read_text()
RC_SRC = (FRONTEND / "services/revenuecat.ts").read_text()

FREE_PHASE = {
    "billingPeriod": {"unit": "DAY", "value": 7, "iso8601": "P1W"},
    "recurrenceMode": 2, "billingCycleCount": 1,
    "price": {"formatted": "£0.00", "amountMicros": 0, "currencyCode": "GBP"},
    "offerPaymentMode": "FREE_TRIAL",
}
PAID_INTRO_PHASE = {**FREE_PHASE, "price": {"formatted": "£0.99", "amountMicros": 990000, "currencyCode": "GBP"},
                    "offerPaymentMode": "DISCOUNTED_RECURRING_PAYMENT"}


def _opt(oid, free=None, intro=None, base=False, tags=()):
    return {"id": oid, "storeProductId": "scriptmate_annual:3", "productId": "scriptmate_annual",
            "pricingPhases": [], "tags": list(tags), "isBasePlan": base, "billingPeriod": None,
            "isPrepaid": False, "fullPricePhase": None, "freePhase": free, "introPhase": intro}


BASE = _opt("3", base=True)
TRIAL = _opt("3:7-day-free-trial", free=FREE_PHASE)

ELIGIBLE = {"introPrice": {"price": 0, "priceString": "£0.00", "cycles": 1, "period": "P1W",
                           "periodUnit": "DAY", "periodNumberOfUnits": 7},
            "defaultOption": TRIAL, "subscriptionOptions": [BASE, TRIAL]}
INELIGIBLE = {"introPrice": None, "defaultOption": BASE, "subscriptionOptions": [BASE]}
PAID_INTRO = {"introPrice": {"price": 0.99, "priceString": "£0.99", "cycles": 1, "period": "P1M",
                             "periodUnit": "MONTH", "periodNumberOfUnits": 1},
              "defaultOption": _opt("3:intro", intro=PAID_INTRO_PHASE),
              "subscriptionOptions": [BASE, _opt("3:intro", intro=PAID_INTRO_PHASE)]}
IGNORED_TRIAL = {"introPrice": None, "defaultOption": BASE,
                 "subscriptionOptions": [BASE, _opt("3:t", free=FREE_PHASE, tags=["rc-ignore-offer"])]}
IOS_FREE = {"introPrice": {"price": 0}, "defaultOption": None, "subscriptionOptions": None}


def _run(fn, product):
    js = (
        "require('sucrase/register/ts');"
        "const m=require('/app/frontend/services/trialOffer.ts');"
        f"process.stdout.write(JSON.stringify(m.{fn}({json.dumps(product)})));"
    )
    out = subprocess.run(["node", "-e", js], cwd=FRONTEND, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


# ─── Behaviour ────────────────────────────────────────────────────────────

def test_eligible_customer_has_free_trial():
    assert _run("hasFreeTrialOffer", ELIGIBLE) is True


def test_ineligible_customer_base_plan_only_has_no_trial():
    assert _run("hasFreeTrialOffer", INELIGIBLE) is False


def test_missing_offer_response_has_no_trial():
    assert _run("hasFreeTrialOffer", None) is False
    assert _run("hasFreeTrialOffer", {"introPrice": None, "defaultOption": None,
                                      "subscriptionOptions": []}) is False


def test_paid_intro_offer_is_not_a_free_trial():
    assert _run("hasFreeTrialOffer", PAID_INTRO) is False


def test_rc_ignore_offer_trial_not_counted_when_not_default():
    assert _run("hasFreeTrialOffer", IGNORED_TRIAL) is False


def test_ios_shape_free_intro_still_detected():
    assert _run("hasFreeTrialOffer", IOS_FREE) is True


def test_probe_summary_eligible():
    s = _run("summarizeSubscriptionOptions", ELIGIBLE)
    assert s["defaultOptionId"] == "3:7-day-free-trial"
    assert s["defaultOptionHasFreePhase"] is True
    assert s["defaultOptionFreePhasePeriod"] == "P1W"
    assert [(o["id"], o["hasFreePhase"]) for o in s["subscriptionOptions"]] == [
        ("3", False), ("3:7-day-free-trial", True)]


def test_probe_summary_ineligible_and_missing():
    s = _run("summarizeSubscriptionOptions", INELIGIBLE)
    assert s["defaultOptionId"] == "3" and s["defaultOptionHasFreePhase"] is False
    assert s["subscriptionOptions"] == [{"id": "3", "isBasePlan": True, "hasFreePhase": False,
                                         "hasIntroPhase": False, "tags": []}]
    m = _run("summarizeSubscriptionOptions", None)
    assert m == {"defaultOptionId": None, "defaultOptionHasFreePhase": False,
                 "defaultOptionFreePhasePeriod": None, "subscriptionOptions": []}


# ─── Wiring (source locks) ────────────────────────────────────────────────

def test_has_intro_offer_delegates_to_free_trial_detection():
    assert "return hasFreeTrialOffer(pkg.product);" in RC_SRC
    assert "pkg.product.introPrice !== null" not in RC_SRC


def test_trial_button_hidden_on_android_without_free_trial():
    assert ("{!user?.trial_used && (Platform.OS !== 'android' || "
            "(!!yearlyPackage && hasIntroOffer(yearlyPackage))) && (") in PREMIUM_SRC


def test_probe_records_options():
    i = PREMIUM_SRC.index("'TRIAL_INTRO_PROBE'")
    assert "...summarizeSubscriptionOptions(yearlyPackage.product)" in PREMIUM_SRC[i:i + 400]


def test_paid_upgrade_and_restore_untouched():
    assert 'onPress={() => handlePurchase(selectedPlan)}' in PREMIUM_SRC
    assert 'data-testid="upgrade-cta-button"' in PREMIUM_SRC
    assert 'data-testid="restore-purchases-btn"' in PREMIUM_SRC
    assert "const result = await purchase(yearlyPackage);" in PREMIUM_SRC


# ─── TRIAL_CTA_DECISION diagnostic (logging only) ─────────────────────────

def _cta_block():
    i = PREMIUM_SRC.index("const lastTrialCtaDecisionRef = useRef('');")
    j = PREMIUM_SRC.index("'TRIAL_CTA_DECISION'", i)
    return PREMIUM_SRC[i:PREMIUM_SRC.index("]);", j) + 3]


def test_trial_cta_decision_logged_with_required_fields():
    b = _cta_block()
    assert "DebugLog.log('PURCHASE_EVENT', 'RevenueCat', 'TRIAL_CTA_DECISION', payload);" in b
    for field in ("platform: Platform.OS", "isPremium,", "trialUsed,", "userLoaded,",
                  "hasYearlyPackage: !!yearlyPackage",
                  "hasFreeTrial: !!yearlyPackage && hasIntroOffer(yearlyPackage)",
                  "summarizeSubscriptionOptions(yearlyPackage?.product)", "...summary,"):
        assert field in b, field
    assert "const trialUsed = !!user?.trial_used;" in PREMIUM_SRC


def test_trial_cta_decision_waits_for_offerings_and_runs_on_native_only():
    assert "if (!isNative || !offeringsReady) return;" in _cta_block()


def test_trial_cta_decision_dedupes_and_has_primitive_deps():
    b = _cta_block()
    assert "if (key === lastTrialCtaDecisionRef.current) return;" in b
    assert "}, [isNative, offeringsReady, isPremium, userLoaded, trialUsed, yearlyPackage]);" in b
    assert "setState" not in b and "set" + "Loading" not in b  # no state writes → no render loop


def test_trial_cta_decision_tags_flattened_below_mask_depth_limit():
    assert "tags: (o.tags ?? []).join(',')" in _cta_block()


def test_trial_cta_decision_contains_no_sensitive_fields():
    b = _cta_block().lower()
    for banned in ("token", "email", "appuserid", "app_user_id", "device_id", "receipt", "orderid"):
        assert banned not in b, banned


def test_trial_eligibility_condition_unchanged():
    assert PREMIUM_SRC.count("{!user?.trial_used && (Platform.OS !== 'android' || "
                             "(!!yearlyPackage && hasIntroOffer(yearlyPackage))) && (") == 1
    assert "if (user?.trial_used) {" in PREMIUM_SRC
