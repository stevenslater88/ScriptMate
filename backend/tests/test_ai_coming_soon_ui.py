"""ScriptMate AI · Coming Soon — UI-only regression suite.

Locks the 2026-02 AI roadmap presentation:

  1. A dedicated `AIComingSoonSection` component exists and renders
     exactly 5 features in a fixed order:
        - AI Rehearsal Partner
        - AI Line Coach
        - AI Scene Coach
        - AI Script Assistant
        - World-Class Dialect Coach
  2. Every roadmap card carries a "COMING SOON" badge.
  3. No card wires up navigation, network, or paywall — it is a
     purely visual roadmap.
  4. The Home screen (`app/index.tsx`) surfaces the section and no
     longer routes primary CTAs to the AI screens
     (`/acting-coach`, `/dialect-coach`).
  5. The Dashboard screen (`app/dashboard.tsx`) surfaces the section
     and no longer routes Quick Action tiles to those AI screens.
  6. Underlying route files (`app/acting-coach.tsx`,
     `app/dialect-coach.tsx`, `app/scene-partner.tsx`) still exist
     for deeplinks — this is a UI demotion, not a feature removal.
  7. No new AI dependency added.
  8. Phase 3, Phase 4 Learn, FabricSafeSlider migration untouched.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

APP = Path("/app")
FRONTEND = APP / "frontend"

COMPONENT = FRONTEND / "components/AIComingSoonSection.tsx"
INDEX = FRONTEND / "app/index.tsx"
DASHBOARD = FRONTEND / "app/dashboard.tsx"
ACTING_COACH_ROUTE = FRONTEND / "app/acting-coach.tsx"
DIALECT_COACH_ROUTE = FRONTEND / "app/dialect-coach.tsx"
SCENE_PARTNER_ROUTE = FRONTEND / "app/scene-partner.tsx"

# Phase 3 / Phase 4 sentinels
LEARN_HUB = FRONTEND / "app/learn/index.tsx"
LEARN_SESSION = FRONTEND / "app/learn/session.tsx"
LEARN_ENGINE = FRONTEND / "services/learnEngine.ts"
LEARN_STORAGE = FRONTEND / "services/learnStorage.ts"
TELEPROMPTER = FRONTEND / "app/selftape/teleprompter.tsx"
RECORD = FRONTEND / "app/selftape/record.tsx"

EXPECTED_FEATURES = [
    "AI Rehearsal Partner",
    "AI Line Coach",
    "AI Scene Coach",
    "AI Script Assistant",
    "World-Class Dialect Coach",
]


@pytest.fixture(scope="module")
def component_src() -> str:
    return COMPONENT.read_text()


@pytest.fixture(scope="module")
def index_src() -> str:
    return INDEX.read_text()


@pytest.fixture(scope="module")
def dashboard_src() -> str:
    return DASHBOARD.read_text()


# ─── Component contract ─────────────────────────────────────────────────


def test_component_file_exists() -> None:
    assert COMPONENT.exists(), (
        f"AIComingSoonSection component missing at {COMPONENT}"
    )


def test_component_default_exports_section(component_src: str) -> None:
    assert "export default AIComingSoonSection" in component_src, (
        "AIComingSoonSection must be the default export."
    )
    assert "function AIComingSoonSection" in component_src


def test_component_lists_all_five_features(component_src: str) -> None:
    for title in EXPECTED_FEATURES:
        assert title in component_src, (
            f"Roadmap feature `{title}` missing from AIComingSoonSection."
        )


def test_component_preserves_feature_order(component_src: str) -> None:
    """The five features must appear in the documented order — that
    order is a public product decision, not incidental."""
    positions = [component_src.find(t) for t in EXPECTED_FEATURES]
    assert all(p > 0 for p in positions), "One or more features missing."
    assert positions == sorted(positions), (
        f"Features rendered out of order. Got positions {positions} "
        f"for {EXPECTED_FEATURES}."
    )


def test_component_has_coming_soon_badges(component_src: str) -> None:
    # Badge text is uppercased in JSX.
    assert component_src.count("COMING SOON") >= 1, (
        "COMING SOON label missing from AIComingSoonSection."
    )
    # The badge is rendered inside the .map() so every feature gets one.
    assert re.search(
        r"AI_ROADMAP\.map\([\s\S]*?ai-coming-soon-badge-\$\{feature\.id\}",
        component_src,
    ), (
        "Every roadmap card must render its own COMING SOON badge "
        "(testID `ai-coming-soon-badge-<id>`)."
    )


def test_component_cards_have_stable_testids(component_src: str) -> None:
    assert 'testID="ai-coming-soon-section"' in component_src
    assert re.search(
        r"testID=\{`ai-coming-soon-\$\{feature\.id\}`\}",
        component_src,
    ), "Each roadmap card must carry testID `ai-coming-soon-<id>`."


def test_component_cards_do_not_navigate(component_src: str) -> None:
    """Roadmap cards must be decorative — no router calls, no
    TouchableOpacity, no onPress handlers."""
    # No router import.
    assert "from 'expo-router'" not in component_src, (
        "AIComingSoonSection must not import expo-router — it is a "
        "purely visual roadmap."
    )
    # No TouchableOpacity for cards. (The component itself uses only
    # <View> for cards.)
    assert "TouchableOpacity" not in component_src, (
        "AIComingSoonSection cards must not be touchable — they are "
        "roadmap-only, not navigable."
    )
    # No onPress anywhere.
    assert "onPress" not in component_src


def test_component_has_no_ai_backend_or_paywall_wiring(component_src: str) -> None:
    for banned in (
        "fetch(",
        "axios",
        "useRevenueCat",
        "openai",
        "gpt",
        "elevenlabs",
        "premium",
        "/api/",
    ):
        assert banned.lower() not in component_src.lower(), (
            f"AIComingSoonSection contains banned token `{banned}` — "
            f"this must remain a UI-only roadmap presentation."
        )


# ─── Home wiring ────────────────────────────────────────────────────────


def test_home_imports_and_renders_section(index_src: str) -> None:
    assert re.search(
        r"import\s+AIComingSoonSection\s+from\s+'\.\./components/AIComingSoonSection'",
        index_src,
    ), "Home must import AIComingSoonSection from '../components/AIComingSoonSection'."
    assert "<AIComingSoonSection />" in index_src, (
        "Home must render <AIComingSoonSection /> in its layout."
    )


def test_home_no_longer_primary_ctas_to_ai_routes(index_src: str) -> None:
    """Acting Coach + Dialect Coach ToolCards must be gone from the
    home 4-tool grid so they don't compete with the roadmap section."""
    # ToolCard for acting-coach is the specific CTA to remove.
    assert not re.search(
        r"<ToolCard[^>]*route=\"/acting-coach\"",
        index_src,
    ), "Home still routes a ToolCard to /acting-coach — must be removed."
    assert not re.search(
        r"<ToolCard[^>]*route=\"/dialect-coach\"",
        index_src,
    ), "Home still routes a ToolCard to /dialect-coach — must be removed."


def test_home_4_tool_grid_still_has_four_tools(index_src: str) -> None:
    """Grid shape preserved: still exactly 4 ToolCards on the home
    grid. This is UX continuity — we replaced Acting/Dialect Coach
    with Recall + My Scripts (which were previously in a separate row)."""
    m = re.search(
        r"<View style=\{st\.grid4\}>([\s\S]*?)</View>",
        index_src,
    )
    assert m, "4-tool grid <View style={st.grid4}> not found on Home."
    grid_body = m.group(1)
    tool_count = grid_body.count("<ToolCard")
    assert tool_count == 4, (
        f"Home 4-tool grid must contain exactly 4 ToolCards; found {tool_count}."
    )


# ─── Dashboard wiring ───────────────────────────────────────────────────


def test_dashboard_imports_and_renders_section(dashboard_src: str) -> None:
    assert re.search(
        r"import\s+AIComingSoonSection\s+from\s+'\.\./components/AIComingSoonSection'",
        dashboard_src,
    ), "Dashboard must import AIComingSoonSection."
    assert "<AIComingSoonSection />" in dashboard_src, (
        "Dashboard must render <AIComingSoonSection />."
    )


def test_dashboard_no_longer_has_ai_quick_action_tiles(dashboard_src: str) -> None:
    """Quick Action tiles that routed to `/acting-coach` and
    `/dialect-coach` must be removed from Dashboard."""
    assert not re.search(
        r"router\.push\(['\"]/acting-coach['\"]",
        dashboard_src,
    ), "Dashboard still has a Quick Action navigating to /acting-coach."
    assert not re.search(
        r"router\.push\(['\"]/dialect-coach['\"]",
        dashboard_src,
    ), "Dashboard still has a Quick Action navigating to /dialect-coach."


# ─── Underlying route files preserved ───────────────────────────────────


def test_ai_route_files_still_exist_for_deeplinks() -> None:
    """The AI screens must still be present in the routing tree so
    existing deeplinks, share URLs and in-app profile pages don't
    404. This is a UI demotion, not a feature removal."""
    for path in (ACTING_COACH_ROUTE, DIALECT_COACH_ROUTE, SCENE_PARTNER_ROUTE):
        assert path.exists(), (
            f"Underlying AI route {path} must still exist — the "
            f"Coming Soon change is UI-only, not a feature removal."
        )


# ─── No new AI dependency ───────────────────────────────────────────────


def test_no_new_ai_dependency_added() -> None:
    """The Coming Soon presentation must not have added any new AI
    SDK to package.json."""
    package = json.loads((FRONTEND / "package.json").read_text())
    deps = {**package.get("dependencies", {}), **package.get("devDependencies", {})}
    forbidden = ["openai", "@anthropic-ai/sdk", "langchain", "ai-sdk", "@ai-sdk"]
    for f in forbidden:
        matches = [name for name in deps if name.startswith(f)]
        assert not matches, (
            f"Coming Soon UI must not add AI SDKs; found `{matches}`."
        )


# ─── Phase 3 / Phase 4 / Slider migration protected ─────────────────────


def test_phase4_learn_not_touched_by_ai_coming_soon() -> None:
    for path in (LEARN_HUB, LEARN_SESSION, LEARN_ENGINE, LEARN_STORAGE):
        src = path.read_text()
        assert "AIComingSoonSection" not in src, (
            f"Phase 4 file {path.name} unexpectedly references "
            f"AIComingSoonSection."
        )
        assert "AI_ROADMAP" not in src


def test_phase3_selftape_not_touched_by_ai_coming_soon() -> None:
    for path in (TELEPROMPTER, RECORD):
        src = path.read_text()
        assert "AIComingSoonSection" not in src


def test_fabric_safe_slider_migration_intact() -> None:
    """Task 1 (FabricSafeSlider migration) must remain applied — no
    caller may have regressed to the community slider while wiring up
    this Coming Soon UI."""
    for path in (
        FRONTEND / "app/recall.tsx",
        FRONTEND / "app/script/[id].tsx",
        FRONTEND / "app/acting-coach.tsx",
        FRONTEND / "app/selftape/prep.tsx",
    ):
        src = path.read_text()
        assert "@react-native-community/slider" not in src, (
            f"{path} unexpectedly re-imports the community slider — "
            f"Fabric-safe migration regressed."
        )
        assert "FabricSafeSlider" in src, (
            f"{path} must import from FabricSafeSlider."
        )
