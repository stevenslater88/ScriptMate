import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

const APP_NAME = 'ScriptMate';
const COMPANY_NAME = 'ScriptMate App';
const CONTACT_EMAIL = 'legal@scriptmate.app';
const EFFECTIVE_DATE = 'June 2025';

export default function TermsOfServiceScreen() {
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Terms of Service</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lastUpdated}>Last Updated: {EFFECTIVE_DATE}</Text>

        <Text style={styles.paragraph}>
          Welcome to {APP_NAME}. By downloading, installing, or using our application, 
          you agree to be bound by these Terms of Service. Please read them carefully.
        </Text>

        <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
        <Text style={styles.paragraph}>
          By accessing or using {APP_NAME}, you agree to these Terms and our Privacy Policy. 
          If you do not agree to these terms, please do not use our application.
        </Text>

        <Text style={styles.sectionTitle}>2. Description of Service</Text>
        <Text style={styles.paragraph}>
          {APP_NAME} is an AI-powered script learning application designed to help actors 
          memorize and rehearse their lines. Our services include:
        </Text>
        <Text style={styles.bulletPoint}>• Script upload and parsing</Text>
        <Text style={styles.bulletPoint}>• AI reading partner with text-to-speech</Text>
        <Text style={styles.bulletPoint}>• Multiple rehearsal modes</Text>
        <Text style={styles.bulletPoint}>• Performance recording (Premium)</Text>
        <Text style={styles.bulletPoint}>• Speech recognition (Premium)</Text>

        <Text style={styles.sectionTitle}>3. User Accounts</Text>
        <Text style={styles.paragraph}>
          You are responsible for maintaining the confidentiality of your account and for 
          all activities that occur under your account. You must immediately notify us of 
          any unauthorized use of your account.
        </Text>

        <Text style={styles.sectionTitle}>4. Subscription and Payments</Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Free Tier:</Text> Limited features with restrictions on 
          number of scripts and daily rehearsals.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Premium Subscription:</Text> Full access to all features. 
          Subscriptions are billed monthly or annually through the App Store or Google Play.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Free Trial:</Text> New users may be eligible for a 3-day 
          free trial of Premium features. Trial converts to paid subscription unless cancelled.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Cancellation:</Text> You may cancel your subscription at 
          any time through your device's app store settings. Cancellation takes effect at the 
          end of the current billing period.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Refunds:</Text> Refund requests are handled according to 
          the policies of Apple App Store or Google Play Store.
        </Text>

        <Text style={styles.sectionTitle}>5. User Content</Text>
        <Text style={styles.paragraph}>
          You retain ownership of scripts and content you upload to {APP_NAME}. By uploading 
          content, you grant us a limited license to process, store, and display your content 
          solely for the purpose of providing our services.
        </Text>
        <Text style={styles.paragraph}>
          You represent that you have the right to upload any content and that such content 
          does not infringe on any third party's intellectual property rights.
        </Text>

        <Text style={styles.sectionTitle}>6. Prohibited Uses</Text>
        <Text style={styles.paragraph}>
          You agree not to:
        </Text>
        <Text style={styles.bulletPoint}>• Use the service for any illegal purpose</Text>
        <Text style={styles.bulletPoint}>• Upload content that infringes copyrights</Text>
        <Text style={styles.bulletPoint}>• Attempt to reverse engineer the application</Text>
        <Text style={styles.bulletPoint}>• Share your account credentials</Text>
        <Text style={styles.bulletPoint}>• Use automated systems to access the service</Text>
        <Text style={styles.bulletPoint}>• Upload malicious content or code</Text>

        <Text style={styles.sectionTitle}>7. Intellectual Property</Text>
        <Text style={styles.paragraph}>
          {APP_NAME}, including its design, features, and content, is owned by {COMPANY_NAME} 
          and is protected by intellectual property laws. You may not copy, modify, or 
          distribute any part of the application without our written permission.
        </Text>

        <Text style={styles.sectionTitle}>8. Disclaimer of Warranties</Text>
        <Text style={styles.paragraph}>
          {APP_NAME} is provided "as is" without warranties of any kind. We do not guarantee 
          that the service will be uninterrupted, error-free, or secure. AI features may 
          occasionally produce inaccurate results.
        </Text>

        <Text style={styles.sectionTitle}>9. Limitation of Liability</Text>
        <Text style={styles.paragraph}>
          To the maximum extent permitted by law, {COMPANY_NAME} shall not be liable for any 
          indirect, incidental, special, or consequential damages arising from your use of 
          the service.
        </Text>

        <Text style={styles.sectionTitle}>10. Changes to Terms</Text>
        <Text style={styles.paragraph}>
          We reserve the right to modify these Terms at any time. We will notify users of 
          significant changes through the app or by email. Continued use after changes 
          constitutes acceptance of the new terms.
        </Text>

        <Text style={styles.sectionTitle}>11. Termination</Text>
        <Text style={styles.paragraph}>
          We may terminate or suspend your account at any time for violation of these Terms 
          or for any other reason at our sole discretion. Upon termination, your right to 
          use the service ceases immediately.
        </Text>

        <Text style={styles.sectionTitle}>12. Governing Law</Text>
        <Text style={styles.paragraph}>
          These Terms shall be governed by and construed in accordance with applicable laws, 
          without regard to conflict of law principles.
        </Text>

        <Text style={styles.sectionTitle}>13. Contact Information</Text>
        <Text style={styles.paragraph}>
          For questions about these Terms, please contact us at:
        </Text>
        <Text style={styles.contactInfo}>{CONTACT_EMAIL}</Text>

        <View style={styles.bottomSpacing} />
      </ScrollView>
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
  content: {
    flex: 1,
    padding: 20,
  },
  lastUpdated: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginTop: 24,
    marginBottom: 12,
  },
  paragraph: {
    fontSize: 15,
    color: '#d1d5db',
    lineHeight: 24,
    marginBottom: 12,
  },
  bold: {
    fontWeight: '600',
    color: '#fff',
  },
  bulletPoint: {
    fontSize: 15,
    color: '#d1d5db',
    lineHeight: 26,
    marginLeft: 8,
  },
  contactInfo: {
    fontSize: 16,
    color: '#6366f1',
    marginTop: 8,
    fontWeight: '600',
  },
  bottomSpacing: {
    height: 40,
  },
});
