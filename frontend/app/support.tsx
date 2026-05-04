```tsx
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
          value={title}
          onChangeText={setTitle}
          style={styles.input}
        />

        <TextInput
          placeholder="Describe the issue..."
          value={description}
          onChangeText={setDescription}
          multiline
          style={[styles.input, { height: 120 }]}
        />

        <TouchableOpacity style={styles.button} onPress={handleSubmit}>
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
  container: { flex: 1 },

  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#ddd',
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
    color: '#6b7280',
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
  },

  question: {
    fontWeight: '600',
    marginTop: 10,
  },

  answer: {
    color: '#555',
    marginBottom: 10,
  },

  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    padding: 10,
    marginBottom: 10,
    borderRadius: 6,
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
```
