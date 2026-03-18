import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useScriptStore } from '../store/scriptStore';
import {
  getDiagnostics,
  copyDiagnosticsToClipboard,
  sendDiagnosticsEmail,
  checkProductAvailability,
  updateCustomerInfoCache,
  FeatureFlags,
  DiagnosticsInfo,
} from '../services/diagnosticsService';
import { DebugLog, DebugLogEntry } from '../services/debugLogService';
import { resetOnboarding } from '../components/OnboardingTutorial';
import Purchases from 'react-native-purchases';

const FAQ_ITEMS = [
  {
    question: 'How do I upload a script?',
    answer: 'Tap "New Script" on the home screen. You can either paste your script text directly or upload a PDF/Word document. The AI will automatically detect characters and format the dialogue.',
  },
  {
    question: 'How does the AI reading partner work?',
    answer: 'Select a character to play as, then start a rehearsal. The AI will speak all other characters\' lines using text-to-speech, and wait for you to say your lines before continuing.',
  },
  {
    question: 'What training modes are available?',
    answer: 'Full Read shows all lines, Cue Only hides your lines until you ask for a hint, and Performance mode (Premium) hides your lines completely for real audition practice.',
  },
  {
    question: 'What\'s included in Premium?',
    answer: 'Premium includes unlimited scripts, 6 AI voices, all training modes, performance recording, smart weak-line tracking, cloud storage, and no ads.',
  },
  {
    question: 'How do I cancel my subscription?',
    answer: 'Subscriptions are managed through your device\'s app store. Go to Settings > [Your Name] > Subscriptions on iOS, or Google Play Store > Subscriptions on Android.',
  },
];

const SUPPORT_EMAIL = 'support@scriptm8.app';

export default function SupportScreen() {
  const { isPremium } = useScriptStore();
  const [activeTab, setActiveTab] = useState<'faq' | 'report' | 'diagnostics'>('faq');
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  const [bugReport, setBugReport] = useState({ title: '', description: '' });
  const [submitting, setSubmitting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsInfo | null>(null);
  const [loadingDiagnostics, setLoadingDiagnostics] = useState(false);
  const [refreshingPurchases, setRefreshingPurchases] = useState(false);
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [showDebugLogs, setShowDebugLogs] = useState(false);

  // FORENSIC: Track screen view
  useEffect(() => {
    DebugLog.setScreen('SupportScreen');
  }, []);

  // Load diagnostics when tab is selected
  useEffect(() => {
    if (activeTab === 'diagnostics') {
      loadDiagnostics();
      loadDebugLogs();
    }
  }, [activeTab]);

  const loadDebugLogs = () => {
    setDebugLogs(DebugLog.getLogs());
  };

  const handleCopyDebugLogs = async () => {
    const logText = DebugLog.exportAsText();
    await Clipboard.setStringAsync(logText);
    Alert.alert('Copied!', `${debugLogs.length} log entries copied to clipboard`);
  };

  const handleClearDebugLogs = async () => {
    Alert.alert(
      'Clear Debug Logs',
      'This will clear all forensic logs. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Clear', 
          style: 'destructive',
          onPress: async () => {
            await DebugLog.clearLogs();
            loadDebugLogs();
            Alert.alert('Cleared', 'Debug logs cleared');
          }
        },
      ]
    );
  };

  const loadDiagnostics = async () => {
    setLoadingDiagnostics(true);
    try {
      const diag = await getDiagnostics();
      setDiagnostics(diag);
    } catch (error) {
      console.error('Failed to load diagnostics:', error);
    } finally {
      setLoadingDiagnostics(false);
    }
  };

  const handleCopyDiagnostics = async () => {
    const success = await copyDiagnosticsToClipboard();
    if (success) {
      Alert.alert('Copied!', 'Diagnostics copied to clipboard');
    } else {
      Alert.alert('Error', 'Failed to copy diagnostics');
    }
  };

  const handleEmailSupport = async () => {
    await sendDiagnosticsEmail(bugReport.description || undefined);
  };

  const handleRefreshOfferings = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Purchases not available on web');
      return;
    }
    
    setRefreshingPurchases(true);
    try {
      await Purchases.getOfferings();
      await loadDiagnostics();
      Alert.alert('Refreshed', 'Offerings have been refreshed');
    } catch (error) {
      Alert.alert('Error', 'Failed to refresh offerings');
    } finally {
      setRefreshingPurchases(false);
    }
  };

  const handleRestorePurchases = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Purchases not available on web');
      return;
    }
    
    setRefreshingPurchases(true);
    try {
      // restorePurchases returns updated CustomerInfo
      const customerInfo = await Purchases.restorePurchases();
      // Update the diagnostics cache with fresh customer info
      updateCustomerInfoCache(customerInfo);
      await loadDiagnostics();
      
      // Check if premium was restored
      const hasPremium = customerInfo.entitlements.active['ScriptM8 Pro'] !== undefined;
      if (hasPremium) {
        Alert.alert('Success', 'Premium access restored!');
      } else {
        Alert.alert('Restored', 'No active subscriptions found for this account.');
      }
    } catch (error) {
      console.error('[Support] Restore error:', error);
      Alert.alert('Error', 'Failed to restore purchases. Please try again.');
    } finally {
      setRefreshingPurchases(false);
    }
  };

  const handleSyncPurchases = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Purchases not available on web');
      return;
    }
    
    setRefreshingPurchases(true);
    try {
      await Purchases.syncPurchases();
      // After sync, fetch fresh customer info
      const customerInfo = await Purchases.getCustomerInfo();
      // Update the diagnostics cache
      updateCustomerInfoCache(customerInfo);
      await loadDiagnostics();
      
      // Check if premium is active
      const hasPremium = customerInfo.entitlements.active['ScriptM8 Pro'] !== undefined;
      if (hasPremium) {
        Alert.alert('Success', 'Premium access synced successfully!');
      } else {
        Alert.alert('Synced', 'Purchases synced. No active subscriptions found.');
      }
    } catch (error) {
      console.error('[Support] Sync error:', error);
      Alert.alert('Error', 'Failed to sync purchases. Please try again.');
    } finally {
      setRefreshingPurchases(false);
    }
  };

  const submitBugReport = async () => {
    if (!bugReport.title.trim() || !bugReport.description.trim()) {
      Alert.alert('Missing Information', 'Please provide a title and description.');
      return;
    }
    setSubmitting(true);
    await sendDiagnosticsEmail(`${bugReport.title}\n\n${bugReport.description}`);
    setSubmitting(false);
    setBugReport({ title: '', description: '' });
  };

  const handleShowTutorial = async () => {
    await resetOnboarding();
    router.push('/onboarding');
  };

  const renderFAQ = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      {/* Quick Tutorial Card */}
      <TouchableOpacity style={styles.tutorialCard} onPress={handleShowTutorial}>
        <View style={styles.tutorialIcon}>
          <Ionicons name="school" size={24} color="#6366f1" />
        </View>
        <View style={styles.tutorialContent}>
          <Text style={styles.tutorialTitle}>Show Tutorial</Text>
          <Text style={styles.tutorialSubtitle}>Learn about all features</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#6b7280" />
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
      {FAQ_ITEMS.map((item, index) => (
        <TouchableOpacity
          key={index}
          style={styles.faqItem}
          onPress={() => setExpandedFAQ(expandedFAQ === index ? null : index)}
        >
          <View style={styles.faqHeader}>
            <Text style={styles.faqQuestion}>{item.question}</Text>
            <Ionicons
              name={expandedFAQ === index ? 'chevron-up' : 'chevron-down'}
              size={20}
              color="#6b7280"
            />
          </View>
          {expandedFAQ === index && (
            <Text style={styles.faqAnswer}>{item.answer}</Text>
          )}
        </TouchableOpacity>
      ))}
      
      <View style={styles.contactSection}>
        <Text style={styles.contactTitle}>Still need help?</Text>
        <TouchableOpacity style={styles.emailButton} onPress={handleEmailSupport}>
          <Ionicons name="mail" size={20} color="#fff" />
          <Text style={styles.emailButtonText}>Email Support</Text>
        </TouchableOpacity>
      </View>

      {/* Legal Links */}
      <View style={styles.legalSection}>
        <TouchableOpacity style={styles.legalLink} onPress={() => router.push('/privacy')}>
          <Ionicons name="shield-checkmark-outline" size={18} color="#6b7280" />
          <Text style={styles.legalLinkText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={16} color="#4b5563" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.legalLink} onPress={() => router.push('/terms')}>
          <Ionicons name="document-text-outline" size={18} color="#6b7280" />
          <Text style={styles.legalLinkText}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={16} color="#4b5563" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  const renderBugReport = () => (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardView}>
      <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Report a Problem</Text>
        <Text style={styles.sectionSubtitle}>
          Describe your issue and we'll include diagnostics automatically.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Issue Title *</Text>
          <TextInput
            style={styles.input}
            placeholder="Brief description"
            placeholderTextColor="#6b7280"
            value={bugReport.title}
            onChangeText={(text) => setBugReport({ ...bugReport, title: text })}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Details *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What happened? What did you expect?"
            placeholderTextColor="#6b7280"
            value={bugReport.description}
            onChangeText={(text) => setBugReport({ ...bugReport, description: text })}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={submitBugReport}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="send" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Send Report</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderDiagnostics = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>Diagnostics</Text>
      <Text style={styles.sectionSubtitle}>
        Technical information to help troubleshoot issues.
      </Text>

      {loadingDiagnostics ? (
        <ActivityIndicator color="#6366f1" size="large" style={{ marginTop: 40 }} />
      ) : diagnostics ? (
        <>
          {/* BUILD SOURCE PROOF - Verify this matches the code being edited */}
          <View style={[styles.diagSection, { backgroundColor: '#1a1a2e', borderColor: '#6366f1', borderWidth: 1 }]}>
            <Text style={[styles.diagSectionTitle, { color: '#6366f1' }]}>BUILD SOURCE PROOF</Text>
            <DiagRow label="Proof" value={diagnostics.buildProof || 'NOT SET'} />
          </View>

          {/* App Info */}
          <View style={styles.diagSection}>
            <Text style={styles.diagSectionTitle}>App Info</Text>
            <DiagRow label="Build Fingerprint" value={'SM8-FIX-0315A'} />
            <DiagRow label="Version" value={diagnostics.appVersion} />
            <DiagRow label="Build" value={diagnostics.buildNumber} />
            <DiagRow label="Bundle ID" value={diagnostics.bundleId} />
          </View>

          {/* Device Info */}
          <View style={styles.diagSection}>
            <Text style={styles.diagSectionTitle}>🖥️ Device</Text>
            <DiagRow label="Platform" value={diagnostics.platform} />
            <DiagRow label="Model" value={diagnostics.deviceModel} />
            <DiagRow label="OS" value={diagnostics.osVersion} />
            <DiagRow label="Install Source" value={diagnostics.installSource} />
          </View>

          {/* RevenueCat Info */}
          <View style={styles.diagSection}>
            <Text style={styles.diagSectionTitle}>💳 Subscription</Text>
            <DiagRow label="Status" value={diagnostics.isPremium ? '✅ Premium' : '❌ Free'} />
            <DiagRow label="User ID" value={diagnostics.rcAppUserId} />
            <DiagRow label="API Key" value={diagnostics.rcApiKeyPrefix} />
            <DiagRow label="Offering" value={diagnostics.currentOfferingId || 'None'} />
            {diagnostics.rcInitError && (
              <DiagRow label="Init Error" value={diagnostics.rcInitError} isError />
            )}
          </View>

          {/* Products */}
          <View style={styles.diagSection}>
            <Text style={styles.diagSectionTitle}>📦 Products</Text>
            {diagnostics.products.length > 0 ? (
              diagnostics.products.map((p, i) => (
                <DiagRow key={i} label={p.id} value={`${p.price} ${p.available ? '✅' : '❌'}`} />
              ))
            ) : (
              <Text style={styles.diagNoData}>No products loaded</Text>
            )}
            {diagnostics.missingProducts.length > 0 && (
              <View style={styles.warningBox}>
                <Ionicons name="warning" size={16} color="#f59e0b" />
                <Text style={styles.warningText}>
                  Missing: {diagnostics.missingProducts.join(', ')}
                </Text>
              </View>
            )}
          </View>

          {/* Last Purchase */}
          {diagnostics.lastPurchaseAttempt && (
            <View style={styles.diagSection}>
              <Text style={styles.diagSectionTitle}>🛒 Last Purchase</Text>
              <DiagRow label="Product" value={diagnostics.lastPurchaseAttempt.productId} />
              <DiagRow 
                label="Result" 
                value={diagnostics.lastPurchaseAttempt.result}
                isError={diagnostics.lastPurchaseAttempt.result === 'error'}
              />
              {diagnostics.lastPurchaseAttempt.errorMessage && (
                <DiagRow label="Error" value={diagnostics.lastPurchaseAttempt.errorMessage} isError />
              )}
            </View>
          )}

          {/* Feature Flags */}
          <View style={styles.diagSection}>
            <Text style={styles.diagSectionTitle}>🚩 Feature Flags</Text>
            <DiagRow label="Premium Enabled" value={diagnostics.featureFlags.PREMIUM_ENABLED ? 'Yes' : 'No'} />
            <DiagRow label="Show Lifetime" value={diagnostics.featureFlags.SHOW_LIFETIME ? 'Yes' : 'No'} />
            <DiagRow label="Paywall Variant" value={diagnostics.featureFlags.PAYWALL_VARIANT} />
          </View>

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.actionButton} onPress={handleCopyDiagnostics}>
              <Ionicons name="copy" size={20} color="#6366f1" />
              <Text style={styles.actionButtonText}>Copy Diagnostics</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionButton} onPress={handleEmailSupport}>
              <Ionicons name="mail" size={20} color="#6366f1" />
              <Text style={styles.actionButtonText}>Email Support</Text>
            </TouchableOpacity>
          </View>

          {/* Purchase Actions */}
          <View style={styles.diagSection}>
            <Text style={styles.diagSectionTitle}>🔄 Purchase Actions</Text>
            <View style={styles.purchaseActions}>
              <TouchableOpacity 
                style={[styles.purchaseButton, refreshingPurchases && styles.buttonDisabled]}
                onPress={handleRefreshOfferings}
                disabled={refreshingPurchases}
              >
                <Ionicons name="refresh" size={18} color="#fff" />
                <Text style={styles.purchaseButtonText}>Refresh Products</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.purchaseButton, refreshingPurchases && styles.buttonDisabled]}
                onPress={handleRestorePurchases}
                disabled={refreshingPurchases}
              >
                <Ionicons name="arrow-down-circle" size={18} color="#fff" />
                <Text style={styles.purchaseButtonText}>Restore Purchases</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.purchaseButton, refreshingPurchases && styles.buttonDisabled]}
                onPress={handleSyncPurchases}
                disabled={refreshingPurchases}
              >
                <Ionicons name="sync" size={18} color="#fff" />
                <Text style={styles.purchaseButtonText}>Sync Purchases</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Refresh Button */}
          <TouchableOpacity style={styles.refreshDiagButton} onPress={loadDiagnostics}>
            <Ionicons name="refresh" size={20} color="#6b7280" />
            <Text style={styles.refreshDiagText}>Refresh Diagnostics</Text>
          </TouchableOpacity>

          {/* FULL DEBUG LOG SECTION */}
          <View style={[styles.diagSection, { marginTop: 16 }]}>
            <TouchableOpacity 
              style={styles.debugLogHeader}
              onPress={() => {
                setShowDebugLogs(!showDebugLogs);
                if (!showDebugLogs) loadDebugLogs();
              }}
            >
              <Text style={[styles.diagSectionTitle, { color: '#f59e0b' }]}>
                FULL DEBUG LOG ({debugLogs.length} entries)
              </Text>
              <Ionicons 
                name={showDebugLogs ? "chevron-up" : "chevron-down"} 
                size={20} 
                color="#f59e0b" 
              />
            </TouchableOpacity>

            {showDebugLogs && (
              <>
                {/* Debug Log Actions */}
                <View style={styles.debugLogActions}>
                  <TouchableOpacity 
                    style={styles.debugLogBtn} 
                    onPress={handleCopyDebugLogs}
                  >
                    <Ionicons name="copy" size={16} color="#fff" />
                    <Text style={styles.debugLogBtnText}>Copy All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.debugLogBtn, { backgroundColor: '#dc2626' }]} 
                    onPress={handleClearDebugLogs}
                  >
                    <Ionicons name="trash" size={16} color="#fff" />
                    <Text style={styles.debugLogBtnText}>Clear</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.debugLogBtn, { backgroundColor: '#059669' }]} 
                    onPress={loadDebugLogs}
                  >
                    <Ionicons name="refresh" size={16} color="#fff" />
                    <Text style={styles.debugLogBtnText}>Refresh</Text>
                  </TouchableOpacity>
                </View>

                {/* Log Entries */}
                {debugLogs.length === 0 ? (
                  <Text style={styles.diagValue}>No logs yet. Use the app to generate logs.</Text>
                ) : (
                  <View style={styles.debugLogList}>
                    {debugLogs.slice(0, 50).map((log, index) => (
                      <View key={log.id} style={styles.debugLogEntry}>
                        <View style={styles.debugLogRow}>
                          <Text style={[
                            styles.debugLogType,
                            log.eventType.includes('ERROR') && { color: '#ef4444' },
                            log.eventType.includes('SUCCESS') && { color: '#10b981' },
                            log.eventType.includes('API') && { color: '#3b82f6' },
                          ]}>
                            [{log.eventType}]
                          </Text>
                          <Text style={styles.debugLogTime}>
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </Text>
                        </View>
                        <Text style={styles.debugLogSource}>{log.source}</Text>
                        <Text style={styles.debugLogMessage}>{log.message}</Text>
                        {log.metadata && (
                          <Text style={styles.debugLogMeta}>
                            {JSON.stringify(log.metadata, null, 1).substring(0, 200)}
                          </Text>
                        )}
                      </View>
                    ))}
                    {debugLogs.length > 50 && (
                      <Text style={styles.diagValue}>
                        ...and {debugLogs.length - 50} more entries (use Copy All)
                      </Text>
                    )}
                  </View>
                )}
              </>
            )}
          </View>
        </>
      ) : (
        <Text style={styles.diagNoData}>Failed to load diagnostics</Text>
      )}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'faq' && styles.tabActive]}
          onPress={() => setActiveTab('faq')}
        >
          <Ionicons name="help-circle" size={18} color={activeTab === 'faq' ? '#6366f1' : '#6b7280'} />
          <Text style={[styles.tabText, activeTab === 'faq' && styles.tabTextActive]}>FAQ</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'report' && styles.tabActive]}
          onPress={() => setActiveTab('report')}
        >
          <Ionicons name="bug" size={18} color={activeTab === 'report' ? '#6366f1' : '#6b7280'} />
          <Text style={[styles.tabText, activeTab === 'report' && styles.tabTextActive]}>Report</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'diagnostics' && styles.tabActive]}
          onPress={() => setActiveTab('diagnostics')}
        >
          <Ionicons name="construct" size={18} color={activeTab === 'diagnostics' ? '#6366f1' : '#6b7280'} />
          <Text style={[styles.tabText, activeTab === 'diagnostics' && styles.tabTextActive]}>Diagnostics</Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {activeTab === 'faq' && renderFAQ()}
      {activeTab === 'report' && renderBugReport()}
      {activeTab === 'diagnostics' && renderDiagnostics()}
    </SafeAreaView>
  );
}

// Helper component for diagnostics rows
const DiagRow = ({ label, value, isError = false }: { label: string; value: string; isError?: boolean }) => (
  <View style={styles.diagRow}>
    <Text style={styles.diagLabel}>{label}</Text>
    <Text style={[styles.diagValue, isError && styles.diagValueError]} numberOfLines={2}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#fff' },
  placeholder: { width: 36 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 12,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
    borderRadius: 10,
  },
  tabActive: { backgroundColor: 'rgba(99, 102, 241, 0.15)' },
  tabText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  tabTextActive: { color: '#6366f1' },
  keyboardView: { flex: 1 },
  tabContent: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 22, fontWeight: '700', color: '#fff', marginBottom: 8 },
  sectionSubtitle: { fontSize: 14, color: '#9ca3af', marginBottom: 24, lineHeight: 20 },
  faqItem: { backgroundColor: '#1a1a2e', borderRadius: 12, marginBottom: 12, padding: 16 },
  faqHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  faqQuestion: { fontSize: 15, fontWeight: '600', color: '#fff', flex: 1, marginRight: 12 },
  faqAnswer: { fontSize: 14, color: '#9ca3af', marginTop: 12, lineHeight: 21 },
  contactSection: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.2)',
  },
  contactTitle: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 12 },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    gap: 8,
  },
  emailButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  legalSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 32,
  },
  legalLink: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
    gap: 12,
  },
  legalLinkText: { flex: 1, fontSize: 15, color: '#e5e7eb' },
  inputGroup: { marginBottom: 20 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: '#e5e7eb', marginBottom: 8 },
  input: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  textArea: { minHeight: 100, paddingTop: 14 },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginBottom: 32,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  // Diagnostics styles
  diagSection: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  diagSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a3e',
  },
  diagLabel: { fontSize: 13, color: '#9ca3af', flex: 1 },
  diagValue: { fontSize: 13, color: '#fff', flex: 1.5, textAlign: 'right' },
  diagValueError: { color: '#ef4444' },
  diagNoData: { fontSize: 13, color: '#6b7280', fontStyle: 'italic' },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  warningText: { fontSize: 12, color: '#f59e0b', flex: 1 },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  actionButtonText: { fontSize: 14, color: '#6366f1', fontWeight: '600' },
  purchaseActions: { gap: 10 },
  purchaseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#374151',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  purchaseButtonText: { fontSize: 14, color: '#fff', fontWeight: '500' },
  buttonDisabled: { opacity: 0.5 },
  refreshDiagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
    marginBottom: 32,
  },
  refreshDiagText: { fontSize: 14, color: '#6b7280' },
  // Tutorial card styles
  tutorialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.3)',
  },
  tutorialIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tutorialContent: {
    flex: 1,
    marginLeft: 14,
  },
  tutorialTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6366f1',
  },
  tutorialSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  // Debug Log styles
  debugLogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  debugLogActions: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 12,
  },
  debugLogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  debugLogBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  debugLogList: {
    gap: 8,
  },
  debugLogEntry: {
    backgroundColor: '#1e1e2e',
    borderRadius: 8,
    padding: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#6b7280',
  },
  debugLogRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debugLogType: {
    fontSize: 11,
    fontWeight: '700',
    color: '#f59e0b',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  debugLogTime: {
    fontSize: 10,
    color: '#6b7280',
  },
  debugLogSource: {
    fontSize: 11,
    color: '#a78bfa',
    marginTop: 2,
  },
  debugLogMessage: {
    fontSize: 12,
    color: '#e2e8f0',
    marginTop: 4,
  },
  debugLogMeta: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});
