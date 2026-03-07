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

const APP_NAME = 'ScriptM8';
const COMPANY_NAME = 'ScriptM8 App';
const CONTACT_EMAIL = 'privacy@scriptmate.app';
const EFFECTIVE_DATE = 'June 2025';

export default function PrivacyPolicyScreen() {
  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Privacy Policy</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.lastUpdated}>Last Updated: {EFFECTIVE_DATE}</Text>

        <Text style={styles.paragraph}>
          {COMPANY_NAME} ("we", "our", or "us") operates the {APP_NAME} mobile application. 
          This Privacy Policy explains how we collect, use, disclose, and safeguard your 
          information when you use our application.
        </Text>

        <Text style={styles.sectionTitle}>1. Information We Collect</Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Account Information:</Text> When you create an account, 
          we collect a unique device identifier to manage your scripts and preferences.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Script Content:</Text> We store scripts you upload to 
          provide our rehearsal services. Scripts are processed to identify characters and 
          dialogue.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Usage Data:</Text> We collect information about how you 
          use the app, including rehearsal frequency, feature usage, and performance metrics.
        </Text>
        <Text style={styles.paragraph}>
          <Text style={styles.bold}>Voice Data:</Text> If you use speech recognition features, 
          voice data is processed on-device and is not stored on our servers.
        </Text>

        <Text style={styles.sectionTitle}>2. How We Use Your Information</Text>
        <Text style={styles.paragraph}>
          We use the information we collect to:
        </Text>
        <Text style={styles.bulletPoint}>• Provide and maintain our services</Text>
        <Text style={styles.bulletPoint}>• Process and parse your scripts</Text>
        <Text style={styles.bulletPoint}>• Personalize your experience</Text>
        <Text style={styles.bulletPoint}>• Process transactions and subscriptions</Text>
        <Text style={styles.bulletPoint}>• Send important updates about the service</Text>
        <Text style={styles.bulletPoint}>• Improve and optimize our application</Text>

        <Text style={styles.sectionTitle}>3. Data Storage and Security</Text>
        <Text style={styles.paragraph}>
          Your data is stored on secure servers with industry-standard encryption. 
          We implement appropriate technical and organizational measures to protect 
          your personal information against unauthorized access, alteration, disclosure, 
          or destruction.
        </Text>

        <Text style={styles.sectionTitle}>4. Third-Party Services</Text>
        <Text style={styles.paragraph}>
          We use the following third-party services:
        </Text>
        <Text style={styles.bulletPoint}>• <Text style={styles.bold}>OpenAI:</Text> For AI-powered script parsing</Text>
        <Text style={styles.bulletPoint}>• <Text style={styles.bold}>RevenueCat:</Text> For subscription management</Text>
        <Text style={styles.bulletPoint}>• <Text style={styles.bold}>MongoDB:</Text> For secure data storage</Text>
        <Text style={styles.bulletPoint}>• <Text style={styles.bold}>Apple/Google:</Text> For in-app purchases</Text>

        <Text style={styles.sectionTitle}>5. Your Rights</Text>
        <Text style={styles.paragraph}>
          You have the right to:
        </Text>
        <Text style={styles.bulletPoint}>• Access your personal data</Text>
        <Text style={styles.bulletPoint}>• Request correction of inaccurate data</Text>
        <Text style={styles.bulletPoint}>• Request deletion of your data</Text>
        <Text style={styles.bulletPoint}>• Export your scripts and data</Text>
        <Text style={styles.bulletPoint}>• Opt out of marketing communications</Text>

        <Text style={styles.sectionTitle}>6. Children's Privacy</Text>
        <Text style={styles.paragraph}>
          Our service is not directed to children under 13. We do not knowingly collect 
          personal information from children under 13. If you believe we have collected 
          information from a child, please contact us immediately.
        </Text>

        <Text style={styles.sectionTitle}>7. Data Retention</Text>
        <Text style={styles.paragraph}>
          We retain your personal data only for as long as necessary to provide our services 
          and fulfill the purposes outlined in this policy. You can request deletion of your 
          account and associated data at any time.
        </Text>

        <Text style={styles.sectionTitle}>8. International Transfers</Text>
        <Text style={styles.paragraph}>
          Your information may be transferred to and processed in countries other than your 
          own. We ensure appropriate safeguards are in place for such transfers in compliance 
          with applicable data protection laws.
        </Text>

        <Text style={styles.sectionTitle}>9. Changes to This Policy</Text>
        <Text style={styles.paragraph}>
          We may update this Privacy Policy from time to time. We will notify you of any 
          changes by posting the new policy in the app and updating the "Last Updated" date.
        </Text>

        <Text style={styles.sectionTitle}>10. Contact Us</Text>
        <Text style={styles.paragraph}>
          If you have questions about this Privacy Policy or our data practices, please 
          contact us at:
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
