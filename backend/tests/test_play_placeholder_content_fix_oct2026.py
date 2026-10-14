"""Google Play "Incorrect placeholder content" fix (2026-10).

Locks that unfinished sign-in / roadmap UI is no longer user-facing.
"""
import re
from pathlib import Path

FRONTEND = Path("/app/frontend")
PROFILE = (FRONTEND / "app/profile.tsx").read_text()
SIGNIN = (FRONTEND / "app/signin.tsx").read_text()
LAYOUT = (FRONTEND / "app/_layout.tsx").read_text()
INDEX = (FRONTEND / "app/index.tsx").read_text()
DASHBOARD = (FRONTEND / "app/dashboard.tsx").read_text()


def test_profile_no_longer_links_to_signin():
    assert "/signin" not in PROFILE
    assert "Not Signed In" not in PROFILE
    assert "Sign in to sync your scripts" not in PROFILE
    assert "signInPromptFixed}" not in PROFILE  # block removed (style def may remain)


def test_profile_keeps_header_back_and_watermark():
    assert "<Text style={styles.headerTitle}>Profile</Text>" in PROFILE
    assert "onPress={() => router.back()}" in PROFILE
    assert "ScriptM8 Watermark" in PROFILE
    assert "watermarkBottom" in PROFILE


def test_signin_redirects_home():
    assert "import { Redirect } from 'expo-router';" in SIGNIN
    assert re.search(r'return\s+<Redirect\s+href="/"\s*/>;', SIGNIN)
    assert "export default function SignInScreen" in SIGNIN


def test_signin_has_no_placeholder_copy():
    for banned in ("coming soon", "Coming Soon", "Cross-device sync", "Sign In</Text>"):
        assert banned not in SIGNIN


def test_signin_route_still_registered():
    assert '<Stack.Screen name="signin" />' in LAYOUT


def test_no_coming_soon_section_on_home_or_dashboard():
    assert "AIComingSoonSection" not in INDEX
    assert "AIComingSoonSection" not in DASHBOARD
    assert (FRONTEND / "components/AIComingSoonSection.tsx").exists()
