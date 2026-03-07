import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function VoiceStudioScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} testID="voice-studio-back-btn">
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Voice Actor Studio</Text>
          <View style={{ width: 24 }} />
        </View>

        {/* Hero */}
        <View style={styles.heroCard}>
          <Ionicons name="mic-circle" size={64} color="#6366f1" />
          <Text style={styles.heroTitle}>Voice Actor Studio</Text>
          <Text style={styles.heroSubtitle}>Professional voice-over recording tools</Text>
        </View>

        {/* Features */}
        <View style={styles.featureCard}>
          <Ionicons name="document-text" size={28} color="#3b82f6" />
          <View style={styles.featureText}>
            <Text style={styles.featureTitle}>Upload Voice Script</Text>
            <Text style={styles.featureDesc}>Import scripts optimized for voice work</Text>
          </View>
        </View>

        <View style={styles.featureCard}>
          <Ionicons name="recording" size={28} color="#ef4444" />
          <View style={styles.featureText}>
            <Text style={styles.featureTitle}>Record Takes</Text>
            <Text style={styles.featureDesc}>Record multiple takes with playback</Text>
          </View>
        </View>

        <View style={styles.featureCard}>
          <Ionicons name="cut" size={28} color="#f59e0b" />
          <View style={styles.featureText}>
            <Text style={styles.featureTitle}>Trim & Normalize</Text>
            <Text style={styles.featureDesc}>Trim start/end, balance volume levels</Text>
          </View>
        </View>

        <View style={styles.featureCard}>
          <Ionicons name="albums" size={28} color="#10b981" />
          <View style={styles.featureText}>
            <Text style={styles.featureTitle}>Demo Reel Builder</Text>
            <Text style={styles.featureDesc}>Combine takes into a 30-90s demo reel</Text>
          </View>
        </View>

        {/* Coming Soon */}
        <View style={styles.comingSoon}>
          <Ionicons name="construct" size={32} color="#6b7280" />
          <Text style={styles.comingSoonTitle}>Coming Soon</Text>
          <Text style={styles.comingSoonText}>
            Voice Actor Studio is being built. Record takes, trim audio, normalize volume, and create demo reels — all coming in the next update.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0f' },
  content: { padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  heroCard: {
    alignItems: 'center', backgroundColor: '#1a1a2e', borderRadius: 16,
    padding: 32, marginBottom: 24, borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.2)',
  },
  heroTitle: { fontSize: 24, fontWeight: '700', color: '#fff', marginTop: 12 },
  heroSubtitle: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  featureCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#1a1a2e',
    borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#2a2a3e', gap: 14,
  },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  featureDesc: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  comingSoon: {
    alignItems: 'center', padding: 32, marginTop: 12,
    backgroundColor: '#1a1a2e', borderRadius: 16, borderWidth: 1, borderColor: '#2a2a3e',
  },
  comingSoonTitle: { fontSize: 18, fontWeight: '600', color: '#6b7280', marginTop: 12 },
  comingSoonText: { fontSize: 14, color: '#4b5563', marginTop: 8, textAlign: 'center', lineHeight: 22 },
});
