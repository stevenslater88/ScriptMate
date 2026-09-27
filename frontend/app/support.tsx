import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ScrollView,
  Alert,
  StyleSheet,
} from 'react-native';

export default function SupportScreen() {
  const [activeTab, setActiveTab] = useState<'faq' | 'report'>('faq');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const renderFAQ = () => (
    <ScrollView style={styles.content}>
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

  const renderBugReport = () => {
    const handleSubmit = () => {
      if (!title || !description) {
        Alert.alert('Error', 'Please fill in all fields');
        return;
      }

      Alert.alert('Report Sent', 'Thanks, we’ll look into it.');
      setTitle('');
      setDescription('');
    };

    return (
      <ScrollView style={styles.content}>
        <Text style={styles.sectionTitle}>Report an Issue</Text>

        <TextInput
          placeholder="Issue title"
          placeholderTextColor="#6b7280"
          value={title}
          onChangeText={setTitle}
          style={styles.input}
          testID="support-report-title"
        />

        <TextInput
          placeholder="Describe the issue..."
          placeholderTextColor="#6b7280"
          value={description}
          onChangeText={setDescription}
          multiline
          style={[styles.input, { height: 120 }]}
          testID="support-report-description"
        />

        <TouchableOpacity style={styles.button} onPress={handleSubmit} testID="support-report-submit">
          <Text style={styles.buttonText}>Submit</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
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
            Report Issue
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
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 15,
    color: '#f9fafb',
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

  input: {
    borderWidth: 1,
    borderColor: '#374151',
    padding: 10,
    marginBottom: 10,
    borderRadius: 6,
    backgroundColor: '#111827',
    color: '#f9fafb',
  },

  button: {
    backgroundColor: '#6366f1',
    padding: 15,
    borderRadius: 6,
    alignItems: 'center',
  },

  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
