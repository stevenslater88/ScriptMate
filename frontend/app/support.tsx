import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ScrollView,
  Alert,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import axios from 'axios';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_BASE_URL, API_TIMEOUT, BUILD_ID } from '../services/apiConfig';
import { getDiagnostics, BUILD_FINGERPRINT } from '../services/diagnosticsService';
import { DebugLog } from '../services/debugLogService';

// AsyncStorage key to preserve unsent report if submission fails.
const DRAFT_KEY = 'bug_report_draft_v1';

// Keys we never want to send to the server, defense-in-depth.
const SENSITIVE_KEY_RE = /(authorization|token|api[_-]?key|secret|password|passwd|cookie|session|bearer)/i;

function stripSensitive(obj: any): any {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripSensitive);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEY_RE.test(k)) continue;
    out[k] = stripSensitive(v);
  }
  return out;
}

// Collect non-sensitive diagnostic bundle for the report.
async function collectDiagnosticBundle(currentScreen: string) {
  let diag: any = {};
  try {
    diag = await getDiagnostics();
  } catch (e: any) {
    diag = { error: `getDiagnostics failed: ${e?.message || 'unknown'}` };
  }
  let deviceId = 'unknown';
  try {
    deviceId = (await AsyncStorage.getItem('device_id')) || 'unknown';
  } catch { /* ignore */ }
  let debugLogText = '';
  try {
    debugLogText = DebugLog.exportAsText();
  } catch { /* ignore */ }

  const bundle = {
    // App
    appName: diag.appName || 'ScriptM8',
    appVersion: diag.appVersion || 'unknown',
    buildNumber: diag.buildNumber || 'unknown',
    versionCode: diag.versionCode || 'unknown',
    bundleId: diag.bundleId || 'unknown',
    buildId: BUILD_ID,
    buildFingerprint: diag.buildFingerprint || BUILD_FINGERPRINT,
    buildProof: diag.buildProof || 'unknown',

    // Device
    platform: Platform.OS,
    deviceModel: diag.deviceModel || 'unknown',
    deviceName: diag.deviceName || 'unknown',
    osVersion: diag.osVersion || 'unknown',
    deviceType: diag.deviceType || 'unknown',
    installSource: diag.installSource || 'unknown',

    // Config (URL only, never keys)
    apiBaseUrl: API_BASE_URL,

    // Runtime
    isPremium: !!diag.isPremium,
    activeEntitlements: Array.isArray(diag.activeEntitlements) ? diag.activeEntitlements : [],
    currentScreen,
    timestamp: new Date().toISOString(),
    sessionId: DebugLog.getSessionId ? DebugLog.getSessionId() : 'unknown',
    deviceIdPrefix: deviceId ? deviceId.substring(0, 12) : 'unknown',
  };

  return {
    diagnostics: stripSensitive(bundle),
    debugLogText,
    identifiers: {
      user_id: deviceId,
      app_version: bundle.appVersion,
      build_id: BUILD_ID,
      platform: Platform.OS,
    },
  };
}

// Format the bundle as a readable copy/share text block.
function formatBundleAsText(
  description: string,
  steps: string,
  notes: string,
  bundle: Awaited<ReturnType<typeof collectDiagnosticBundle>>,
): string {
  const d = bundle.diagnostics;
  const lines = [
    '=== ScriptM8 Bug Report (unsent) ===',
    `Timestamp: ${d.timestamp}`,
    '',
    '--- What happened ---',
    description || '(none)',
    '',
    '--- Steps to reproduce ---',
    steps || '(none)',
    '',
    '--- Additional notes ---',
    notes || '(none)',
    '',
    '--- Diagnostics ---',
    `App: ${d.appName} v${d.appVersion} (build ${d.buildNumber})`,
    `Bundle: ${d.bundleId}`,
    `Build ID: ${d.buildId}`,
    `Build Fingerprint: ${d.buildFingerprint}`,
    `Build Proof: ${d.buildProof}`,
    `Platform: ${d.platform}`,
    `Device: ${d.deviceModel} (${d.deviceName})`,
    `OS: ${d.osVersion}`,
    `Install Source: ${d.installSource}`,
    `API Base URL: ${d.apiBaseUrl}`,
    `Screen: ${d.currentScreen}`,
    `Session: ${d.sessionId}`,
    `Premium: ${d.isPremium ? 'yes' : 'no'}`,
    '',
    '--- Recent Debug Log ---',
    bundle.debugLogText || '(none)',
  ];
  return lines.join('\n');
}

export default function SupportScreen() {
  const [activeTab, setActiveTab] = useState<'faq' | 'report'>('faq');

  // Bug report form state
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastReportId, setLastReportId] = useState<string | null>(null);

  useEffect(() => {
    DebugLog.setScreen('SupportScreen');
    // Restore draft (if any) — preserves user input after a failed submission or reopen.
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(DRAFT_KEY);
        if (raw) {
          const draft = JSON.parse(raw);
          if (draft.description) setDescription(draft.description);
          if (draft.steps) setSteps(draft.steps);
          if (draft.notes) setNotes(draft.notes);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const persistDraft = async () => {
    try {
      await AsyncStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ description, steps, notes, savedAt: new Date().toISOString() }),
      );
    } catch { /* ignore */ }
  };

  const clearDraft = async () => {
    try { await AsyncStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  };

  const renderFAQ = () => (
    <ScrollView style={styles.content} testID="support-faq-scroll">
      <Text style={styles.sectionTitle}>FAQ</Text>

      <Text style={styles.question}>How do I save a script?</Text>
      <Text style={styles.answer}>
        Paste your script in the parser and press Save.
      </Text>

      <Text style={styles.question}>Where are my scripts stored?</Text>
      <Text style={styles.answer}>
        Scripts are stored locally on your device.
      </Text>
    </ScrollView>
  );

  const handleCopyReport = async () => {
    try {
      const bundle = await collectDiagnosticBundle('SupportScreen');
      const text = formatBundleAsText(description, steps, notes, bundle);
      await Clipboard.setStringAsync(text);
      Alert.alert('Copied', 'Diagnostic report copied to clipboard. You can paste it into an email or message to support.');
      DebugLog.log('BUTTON_PRESS', 'SupportScreen', 'Bug report copied to clipboard');
    } catch (e: any) {
      Alert.alert('Copy Failed', e?.message || 'Could not copy report.');
    }
  };

  const handleSubmit = async () => {
    // Outer guard against any residual async throw crashing the app.
    try {
      DebugLog.buttonPress('bug-report-submit', 'SupportScreen');

      const desc = description.trim();
      if (!desc) {
        Alert.alert('Missing details', 'Please describe what happened before submitting.');
        return;
      }

      // Preserve draft before we try — if submission fails the user's typing is safe.
      await persistDraft();

      setSubmitting(true);
      setLastReportId(null);
      let bundle: Awaited<ReturnType<typeof collectDiagnosticBundle>>;
      try {
        bundle = await collectDiagnosticBundle('SupportScreen');
      } catch (collectErr: any) {
        // We can still submit user text even if diag collection fails.
        console.warn('[Support] Diagnostic collection failed:', collectErr?.message);
        bundle = {
          diagnostics: { collectionError: collectErr?.message || 'unknown' },
          debugLogText: '',
          identifiers: { user_id: 'unknown', app_version: 'unknown', build_id: BUILD_ID, platform: Platform.OS },
        };
      }

      const payload = {
        description: desc,
        steps_to_reproduce: steps.trim() || undefined,
        notes: notes.trim() || undefined,
        diagnostics: stripSensitive(bundle.diagnostics),
        debug_log: (bundle.debugLogText || '').slice(0, 180000), // hard cap to stay under backend limit
        user_id: bundle.identifiers.user_id,
        app_version: bundle.identifiers.app_version,
        build_id: bundle.identifiers.build_id,
        platform: bundle.identifiers.platform,
      };

      try {
        const url = `${API_BASE_URL}/api/support/bug-report`;
        console.log(`[Support] Submitting bug report to ${url}`);
        const resp = await axios.post(url, payload, { timeout: API_TIMEOUT });
        const reportId = resp?.data?.id;
        if (!reportId) {
          // Server responded but without an id — treat as failure (do NOT fake success).
          throw new Error('Server did not return a report id.');
        }
        // Real success only
        setLastReportId(reportId);
        setDescription('');
        setSteps('');
        setNotes('');
        await clearDraft();
        DebugLog.log('FUNCTION_SUCCESS', 'SupportScreen', 'Bug report submitted', { reportId });
        Alert.alert(
          'Report Submitted',
          `Thanks — your bug report has been received.\n\nReference ID: ${reportId}`,
        );
      } catch (postErr: any) {
        const status = postErr?.response?.status || 'no status';
        const serverMsg = postErr?.response?.data?.detail || postErr?.message || 'Unknown error';
        console.error(`[Support] Bug report submit failed: status=${status}, err=${serverMsg}`);
        DebugLog.log('FUNCTION_ERROR', 'SupportScreen', 'Bug report submit failed', { status, msg: serverMsg });
        // Draft is still persisted from earlier — user's typing is preserved even after the alert.
        Alert.alert(
          'Report Not Submitted',
          `Your report could NOT be submitted (status: ${status}).\n\n${serverMsg}\n\nYour details are preserved. Tap "Copy Report" to save a copy you can send manually.`,
          [
            { text: 'Copy Report', onPress: () => { handleCopyReport().catch(() => {}); } },
            { text: 'OK', style: 'cancel' },
          ],
        );
      } finally {
        setSubmitting(false);
      }
    } catch (fatal: any) {
      // Outer guard — never crash.
      console.error('[Support] handleSubmit FATAL guard:', fatal?.message || fatal);
      try { setSubmitting(false); } catch { /* ignore */ }
    }
  };

  const renderBugReport = () => (
    <ScrollView style={styles.content} testID="support-report-scroll" keyboardShouldPersistTaps="handled">
      <Text style={styles.sectionTitle}>Bug Report</Text>
      <Text style={styles.helper}>
        Describe what happened. We automatically attach non-sensitive device and app diagnostics to help us fix it.
      </Text>

      <Text style={styles.fieldLabel}>What happened *</Text>
      <TextInput
        placeholder="Describe the issue..."
        placeholderTextColor="#6b7280"
        value={description}
        onChangeText={setDescription}
        multiline
        style={[styles.input, { minHeight: 100 }]}
        testID="bug-report-description"
      />

      <Text style={styles.fieldLabel}>Steps to reproduce</Text>
      <TextInput
        placeholder="1. Open app&#10;2. Tap ..."
        placeholderTextColor="#6b7280"
        value={steps}
        onChangeText={setSteps}
        multiline
        style={[styles.input, { minHeight: 100 }]}
        testID="bug-report-steps"
      />

      <Text style={styles.fieldLabel}>Additional notes (optional)</Text>
      <TextInput
        placeholder="Anything else that could help..."
        placeholderTextColor="#6b7280"
        value={notes}
        onChangeText={setNotes}
        multiline
        style={[styles.input, { minHeight: 80 }]}
        testID="bug-report-notes"
      />

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.primaryButton, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          testID="bug-report-submit"
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryButtonText}>Submit Report</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleCopyReport}
          disabled={submitting}
          testID="bug-report-copy"
        >
          <Text style={styles.secondaryButtonText}>Copy Report</Text>
        </TouchableOpacity>
      </View>

      {lastReportId && (
        <View style={styles.successBanner} testID="bug-report-success">
          <Text style={styles.successText}>
            Last report submitted — reference {lastReportId}
          </Text>
        </View>
      )}

      <Text style={styles.privacyNote}>
        We attach: app version, build ID, device model, OS version, API endpoint URL, recent debug log entries. We never attach API keys, tokens, passwords or your script text.
      </Text>
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container} testID="support-screen">
      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'faq' && styles.tabActive]}
          onPress={() => setActiveTab('faq')}
          testID="support-tab-faq"
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'faq' && styles.tabTextActive,
            ]}
          >
            FAQ
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'report' && styles.tabActive]}
          onPress={() => setActiveTab('report')}
          testID="support-tab-report"
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'report' && styles.tabTextActive,
            ]}
          >
            Bug Report
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {activeTab === 'faq' && renderFAQ()}
      {activeTab === 'report' && renderBugReport()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },

  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#1f2937',
  },

  tab: {
    flex: 1,
    padding: 15,
    alignItems: 'center',
  },

  tabActive: {
    borderBottomWidth: 2,
    borderColor: '#6366f1',
  },

  tabText: {
    color: '#9ca3af',
    fontWeight: '500',
  },

  tabTextActive: {
    color: '#6366f1',
    fontWeight: '700',
  },

  content: {
    padding: 20,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    color: '#f9fafb',
  },

  helper: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 16,
    lineHeight: 18,
  },

  question: {
    fontWeight: '600',
    marginTop: 10,
    color: '#e5e7eb',
  },

  answer: {
    color: '#9ca3af',
    marginBottom: 10,
  },

  fieldLabel: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },

  input: {
    borderWidth: 1,
    borderColor: '#374151',
    padding: 10,
    marginBottom: 4,
    borderRadius: 8,
    backgroundColor: '#111827',
    color: '#f9fafb',
    textAlignVertical: 'top',
  },

  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },

  primaryButton: {
    flex: 1,
    backgroundColor: '#6366f1',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },

  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#374151',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
  },

  secondaryButtonText: {
    color: '#e5e7eb',
    fontWeight: '600',
    fontSize: 15,
  },

  buttonDisabled: {
    opacity: 0.5,
  },

  successBanner: {
    marginTop: 18,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },

  successText: {
    color: '#a7f3d0',
    fontSize: 13,
  },

  privacyNote: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 18,
    marginBottom: 40,
    lineHeight: 16,
  },
});
