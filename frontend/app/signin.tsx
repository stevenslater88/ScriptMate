import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function SignInScreen() {
  const handleSkip = () => {
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Back Button */}
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>

        {/* Header */}
        <View style={styles.header}>
          <Ionicons name="person-circle-outline" size={80} color="#6366f1" />
          <Text style={styles.title}>Sign In</Text>
          <Text style={styles.subtitle}>
            Cross-device sync is coming soon!
          </Text>
        </View>

        {/* Benefits */}
        <View style={styles.benefitsContainer}>
          <Text style={styles.benefitsTitle}>Coming Soon Features:</Text>
          <View style={styles.benefit}>
            <Ionicons name="sync-circle" size={24} color="#6366f1" />
            <Text style={styles.benefitText}>Sync scripts across all your devices</Text>
          </View>
          <View style={styles.benefit}>
            <Ionicons name="cloud-done" size={24} color="#6366f1" />
            <Text style={styles.benefitText}>Cloud backup for your progress</Text>
          </View>
          <View style={styles.benefit}>
            <Ionicons name="phone-portrait" size={24} color="#6366f1" />
            <Text style={styles.benefitText}>Access scripts on iPhone, iPad & Android</Text>
          </View>
        </View>

        {/* Info Box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={24} color="#6366f1" />
          <Text style={styles.infoText}>
            Sign-in with Apple and Google will be available in a future update. 
            For now, your data is saved locally on this device.
          </Text>
        </View>

        {/* Continue Button */}
        <View style={styles.buttonsContainer}>
          <TouchableOpacity style={styles.continueButton} onPress={handleSkip}>
            <Text style={styles.continueButtonText}>Continue to App</Text>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={styles.footerText}>
          Your scripts and progress are safely stored on this device.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  header: {
    alignItems: 'center',
    marginTop: 40,
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginTop: 8,
    textAlign: 'center',
  },
  benefitsContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
  },
  benefitsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  benefitText: {
    fontSize: 15,
    color: '#d1d5db',
    flex: 1,
  },
  infoBox: {
    backgroundColor: '#1e1e3f',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#6366f140',
  },
  infoText: {
    fontSize: 14,
    color: '#9ca3af',
    flex: 1,
    lineHeight: 20,
  },
  buttonsContainer: {
    marginBottom: 24,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  continueButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fff',
  },
  footerText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 18,
  },
});
