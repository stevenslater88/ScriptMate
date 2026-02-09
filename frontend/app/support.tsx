import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useScriptStore } from '../store/scriptStore';

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
    question: 'How do I change the AI voice?',
    answer: 'On the script detail screen, tap the voice settings icon. Free users have access to one voice, while Premium users can choose from 6 different AI voices.',
  },
  {
    question: 'What\'s included in Premium?',
    answer: 'Premium includes unlimited scripts, 6 AI voices, all training modes, performance recording, smart weak-line tracking, cloud storage, and no ads.',
  },
  {
    question: 'How do I cancel my subscription?',
    answer: 'Subscriptions are managed through your device\'s app store. Go to Settings > [Your Name] > Subscriptions on iOS, or Google Play Store > Subscriptions on Android.',
  },
  {
    question: 'Why isn\'t speech recognition working?',
    answer: 'Speech recognition requires microphone permission. Go to your device settings and ensure ScriptMate has microphone access. Also check that you\'re in a quiet environment.',
  },
  {
    question: 'Can I use ScriptMate offline?',
    answer: 'Scripts that have already been parsed can be rehearsed offline. However, uploading new scripts and using AI parsing requires an internet connection.',
  },
];

const SUPPORT_EMAIL = 'support@scriptmate.app';
const APP_VERSION = '1.0.0';

export default function SupportScreen() {
  const { user, deviceId, isPremium } = useScriptStore();
  const [activeTab, setActiveTab] = useState<'faq' | 'report' | 'feedback'>('faq');
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  const [bugReport, setBugReport] = useState({
    title: '',
    description: '',
    steps: '',
  });
  const [feedback, setFeedback] = useState({
    type: 'suggestion',
    message: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const handleEmailSupport = () => {
    const subject = encodeURIComponent('ScriptMate Support Request');
    const body = encodeURIComponent(`
App Version: ${APP_VERSION}
Device ID: ${deviceId || 'Unknown'}
User Tier: ${isPremium ? 'Premium' : 'Free'}

Please describe your issue:

    `);
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  };

  const submitBugReport = async () => {
    if (!bugReport.title.trim() || !bugReport.description.trim()) {
      Alert.alert('Missing Information', 'Please provide a title and description for your bug report.');
      return;
    }

    setSubmitting(true);
    
    // Simulate API call - in production, this would send to your backend
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    setSubmitting(false);
    Alert.alert(
      'Report Submitted',
      'Thank you for your bug report! Our team will investigate and get back to you if needed.',
      [{ text: 'OK', onPress: () => setBugReport({ title: '', description: '', steps: '' }) }]
    );
  };

  const submitFeedback = async () => {
    if (!feedback.message.trim()) {
      Alert.alert('Missing Information', 'Please provide your feedback message.');
      return;
    }

    setSubmitting(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    setSubmitting(false);
    Alert.alert(
      'Feedback Submitted',
      'Thank you for your feedback! We appreciate you helping us improve ScriptMate.',
      [{ text: 'OK', onPress: () => setFeedback({ type: 'suggestion', message: '' }) }]
    );
  };

  const renderFAQ = () => (
    <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
      {FAQ_ITEMS.map((item, index) => (
        <TouchableOpacity
          key={index}
          style={styles.faqItem}
          onPress={() => setExpandedFAQ(expandedFAQ === index ? null : index)}
          activeOpacity={0.7}
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
    </ScrollView>
  );

  const renderBugReport = () => (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardView}
    >
      <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Report a Bug</Text>
        <Text style={styles.sectionSubtitle}>
          Help us improve ScriptMate by reporting any issues you encounter.
        </Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Bug Title *</Text>
          <TextInput
            style={styles.input}
            placeholder="Brief description of the issue"
            placeholderTextColor="#6b7280"
            value={bugReport.title}
            onChangeText={(text) => setBugReport({ ...bugReport, title: text })}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Description *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="What happened? What did you expect to happen?"
            placeholderTextColor="#6b7280"
            value={bugReport.description}
            onChangeText={(text) => setBugReport({ ...bugReport, description: text })}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Steps to Reproduce (Optional)</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="1. Go to...&#10;2. Tap on...&#10;3. See error"
            placeholderTextColor="#6b7280"
            value={bugReport.steps}
            onChangeText={(text) => setBugReport({ ...bugReport, steps: text })}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.deviceInfo}>
          <Text style={styles.deviceInfoTitle}>Device Information</Text>
          <Text style={styles.deviceInfoText}>App Version: {APP_VERSION}</Text>
          <Text style={styles.deviceInfoText}>User Tier: {isPremium ? 'Premium' : 'Free'}</Text>
          <Text style={styles.deviceInfoText}>Platform: {Platform.OS}</Text>
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
              <Ionicons name="bug" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Submit Bug Report</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );

  const renderFeedback = () => (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.keyboardView}
    >
      <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionTitle}>Share Feedback</Text>
        <Text style={styles.sectionSubtitle}>
          We'd love to hear your thoughts on how we can make ScriptMate better!
        </Text>

        <View style={styles.feedbackTypeContainer}>
          <Text style={styles.inputLabel}>Feedback Type</Text>
          <View style={styles.feedbackTypes}>
            {[
              { id: 'suggestion', icon: 'bulb', label: 'Suggestion' },
              { id: 'feature', icon: 'add-circle', label: 'Feature Request' },
              { id: 'praise', icon: 'heart', label: 'Praise' },
              { id: 'other', icon: 'chatbubble', label: 'Other' },
            ].map((type) => (
              <TouchableOpacity
                key={type.id}
                style={[
                  styles.feedbackTypeButton,
                  feedback.type === type.id && styles.feedbackTypeButtonActive,
                ]}
                onPress={() => setFeedback({ ...feedback, type: type.id })}
              >
                <Ionicons
                  name={type.icon as any}
                  size={20}
                  color={feedback.type === type.id ? '#6366f1' : '#6b7280'}
                />
                <Text
                  style={[
                    styles.feedbackTypeLabel,
                    feedback.type === type.id && styles.feedbackTypeLabelActive,
                  ]}
                >
                  {type.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Your Feedback *</Text>
          <TextInput
            style={[styles.input, styles.textAreaLarge]}
            placeholder="Tell us what you think..."
            placeholderTextColor="#6b7280"
            value={feedback.message}
            onChangeText={(text) => setFeedback({ ...feedback, message: text })}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, styles.submitButtonFeedback, submitting && styles.submitButtonDisabled]}
          onPress={submitFeedback}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="send" size={20} color="#fff" />
              <Text style={styles.submitButtonText}>Send Feedback</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.rateAppSection}>
          <Text style={styles.rateAppTitle}>Enjoying ScriptMate?</Text>
          <Text style={styles.rateAppSubtitle}>
            A positive review helps other actors discover the app!
          </Text>
          <TouchableOpacity style={styles.rateAppButton}>
            <Ionicons name="star" size={20} color="#f59e0b" />
            <Text style={styles.rateAppButtonText}>Rate on App Store</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
          <Ionicons
            name="help-circle"
            size={20}
            color={activeTab === 'faq' ? '#6366f1' : '#6b7280'}
          />
          <Text style={[styles.tabText, activeTab === 'faq' && styles.tabTextActive]}>
            FAQ
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'report' && styles.tabActive]}
          onPress={() => setActiveTab('report')}
        >
          <Ionicons
            name="bug"
            size={20}
            color={activeTab === 'report' ? '#6366f1' : '#6b7280'}
          />
          <Text style={[styles.tabText, activeTab === 'report' && styles.tabTextActive]}>
            Report Bug
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'feedback' && styles.tabActive]}
          onPress={() => setActiveTab('feedback')}
        >
          <Ionicons
            name="chatbubble-ellipses"
            size={20}
            color={activeTab === 'feedback' ? '#6366f1' : '#6b7280'}
          />
          <Text style={[styles.tabText, activeTab === 'feedback' && styles.tabTextActive]}>
            Feedback
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {activeTab === 'faq' && renderFAQ()}
      {activeTab === 'report' && renderBugReport()}
      {activeTab === 'feedback' && renderFeedback()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  placeholder: {
    width: 36,
  },
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
  tabActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
  },
  tabText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#6366f1',
  },
  keyboardView: {
    flex: 1,
  },
  tabContent: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 24,
    lineHeight: 20,
  },
  faqItem: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    marginBottom: 12,
    padding: 16,
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQuestion: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    flex: 1,
    marginRight: 12,
  },
  faqAnswer: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 12,
    lineHeight: 21,
  },
  contactSection: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.2)',
  },
  contactTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  emailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    gap: 8,
  },
  emailButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e5e7eb',
    marginBottom: 8,
  },
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
  textArea: {
    minHeight: 100,
    paddingTop: 14,
  },
  textAreaLarge: {
    minHeight: 150,
    paddingTop: 14,
  },
  deviceInfo: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  deviceInfoTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  deviceInfoText: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 4,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
    marginBottom: 32,
  },
  submitButtonFeedback: {
    backgroundColor: '#6366f1',
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  feedbackTypeContainer: {
    marginBottom: 20,
  },
  feedbackTypes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  feedbackTypeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  feedbackTypeButtonActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderColor: '#6366f1',
  },
  feedbackTypeLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  feedbackTypeLabelActive: {
    color: '#6366f1',
  },
  rateAppSection: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.2)',
  },
  rateAppTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  rateAppSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    marginBottom: 16,
  },
  rateAppButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    gap: 8,
  },
  rateAppButtonText: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '600',
  },
});
