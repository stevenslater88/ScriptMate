import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import axios from 'axios';
import Constants from 'expo-constants';
import { useScriptStore } from '../store/scriptStore';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ||
                    Constants.expoConfig?.extra?.EXPO_PUBLIC_BACKEND_URL;

const UPLOAD_TIMEOUT = 30000; // 30s for file uploads

export default function UploadScreen() {
  const [title, setTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadMethod, setUploadMethod] = useState<'paste' | 'file'>('paste');
  const { createScript } = useScriptStore();

  const handleFilePick = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          '*/*'  // Allow all types as fallback
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      const filename = file.name.toLowerCase();
      setLoading(true);

      // Text files can be read directly
      if (filename.endsWith('.txt') || filename.endsWith('.text')) {
        const content = await FileSystem.readAsStringAsync(file.uri);
        setScriptText(content);
        if (!title) {
          setTitle(file.name.replace(/\.[^/.]+$/, ''));
        }
        setLoading(false);
      } else {
        // PDF, Word docs, and other files - upload to backend for parsing
        const formData = new FormData();
        
        // Determine MIME type
        let mimeType = 'application/octet-stream';
        if (filename.endsWith('.pdf')) {
          mimeType = 'application/pdf';
        } else if (filename.endsWith('.docx')) {
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (filename.endsWith('.doc')) {
          mimeType = 'application/msword';
        }
        
        formData.append('file', {
          uri: file.uri,
          type: mimeType,
          name: file.name,
        } as any);
        formData.append('title', title || file.name.replace(/\.[^/.]+$/, ''));

        const response = await axios.post(
          `${BACKEND_URL}/api/scripts/upload`,
          formData,
          {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            timeout: UPLOAD_TIMEOUT,
          }
        );

        setLoading(false);
        Alert.alert('Success', 'Script uploaded and parsed successfully!', [
          {
            text: 'View Script',
            onPress: () => router.replace(`/script/${response.data.id}`),
          },
        ]);
      }
    } catch (error: any) {
      setLoading(false);
      console.error('File upload error:', error);
      let msg = 'Failed to upload file';
      if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
        msg = 'Upload timed out. Please check your internet connection and try again.';
      } else if (error?.message === 'Network Error' || !error?.response) {
        msg = 'Unable to reach server. Please check your internet connection.';
      } else if (error?.response?.status === 413) {
        msg = 'File is too large. Please try a smaller file.';
      } else if (error?.response?.status === 415) {
        msg = 'Unsupported file type. Please use PDF, DOCX, or TXT files.';
      } else if (error?.response?.data?.detail) {
        msg = error.response.data.detail;
      }
      Alert.alert('Upload Failed', msg);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Please enter a script title');
      return;
    }
    if (!scriptText.trim()) {
      Alert.alert('Error', 'Please paste your script text');
      return;
    }

    setLoading(true);
    try {
      const script = await createScript(title.trim(), scriptText.trim());
      if (script) {
        Alert.alert('Success', 'Script created and parsed successfully!', [
          {
            text: 'View Script',
            onPress: () => router.replace(`/script/${script.id}`),
          },
        ]);
      }
    } catch (error: any) {
      let msg = 'Failed to create script';
      if (error?.message?.includes('timeout') || error?.code === 'ECONNABORTED') {
        msg = 'Request timed out. Please check your internet connection.';
      } else if (error?.message === 'Network Error') {
        msg = 'Unable to reach server. Please check your internet connection.';
      } else if (error?.response?.data?.detail) {
        msg = error.response.data.detail;
      }
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  const sampleScript = `SARAH
I can't believe you're leaving tomorrow.

MIKE
I have to. The job starts Monday.

(Sarah turns away, looking out the window)

SARAH
You could have said no.

MIKE
And then what? Stay here and watch everything fall apart?

SARAH
At least we'd be together.

MIKE
Sometimes love isn't enough, Sarah.

(Long pause)

SARAH
Then I guess this is goodbye.`;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Add Script</Text>
          <View style={styles.placeholder} />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Method Toggle */}
          <View style={styles.methodToggle}>
            <TouchableOpacity
              style={[
                styles.methodButton,
                uploadMethod === 'paste' && styles.methodButtonActive,
              ]}
              onPress={() => setUploadMethod('paste')}
            >
              <Ionicons
                name="create-outline"
                size={20}
                color={uploadMethod === 'paste' ? '#fff' : '#6b7280'}
              />
              <Text
                style={[
                  styles.methodButtonText,
                  uploadMethod === 'paste' && styles.methodButtonTextActive,
                ]}
              >
                Paste Text
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.methodButton,
                uploadMethod === 'file' && styles.methodButtonActive,
              ]}
              onPress={() => setUploadMethod('file')}
            >
              <Ionicons
                name="document-outline"
                size={20}
                color={uploadMethod === 'file' ? '#fff' : '#6b7280'}
              />
              <Text
                style={[
                  styles.methodButtonText,
                  uploadMethod === 'file' && styles.methodButtonTextActive,
                ]}
              >
                Upload File
              </Text>
            </TouchableOpacity>
          </View>

          {/* Title Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Script Title</Text>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Enter script title..."
              placeholderTextColor="#4a4a5e"
            />
          </View>

          {uploadMethod === 'paste' ? (
            <>
              {/* Script Text Input */}
              <View style={styles.inputGroup}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Script Text</Text>
                  <TouchableOpacity
                    onPress={() => setScriptText(sampleScript)}
                    style={styles.sampleButton}
                  >
                    <Text style={styles.sampleButtonText}>Use Sample</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.scriptInput}
                  value={scriptText}
                  onChangeText={setScriptText}
                  placeholder="Paste your script here...\n\nFormat:\nCHARACTER NAME\nDialogue text\n\n(Stage directions in parentheses)"
                  placeholderTextColor="#4a4a5e"
                  multiline
                  textAlignVertical="top"
                />
              </View>

              {/* Format Guide */}
              <View style={styles.formatGuide}>
                <Text style={styles.formatTitle}>Script Format Tips</Text>
                <Text style={styles.formatText}>
                  • Character names in ALL CAPS on their own line{"\n"}
                  • Dialogue on the following lines{"\n"}
                  • Stage directions in (parentheses) or [brackets]
                </Text>
              </View>

              {/* Submit Buttons */}
              <View style={styles.parseOptions}>
                <TouchableOpacity
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                  testID="parse-ai-btn"
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={20} color="#fff" />
                      <Text style={styles.submitButtonText}>Parse with AI</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.smartParseButton, (!title.trim() || !scriptText.trim()) && styles.submitButtonDisabled]}
                  onPress={() => {
                    if (!title.trim() || !scriptText.trim()) {
                      Alert.alert('Error', 'Enter a title and paste script text first');
                      return;
                    }
                    router.push({
                      pathname: '/script-parser',
                      params: { title: title.trim(), rawText: scriptText.trim() },
                    });
                  }}
                  disabled={!title.trim() || !scriptText.trim()}
                  testID="parse-smart-btn"
                >
                  <Ionicons name="flash" size={20} color="#fff" />
                  <Text style={styles.submitButtonText}>Smart Parse V2</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              {/* File Upload */}
              <TouchableOpacity
                style={styles.uploadArea}
                onPress={handleFilePick}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator size="large" color="#6366f1" />
                ) : (
                  <>
                    <View style={styles.uploadIcon}>
                      <Ionicons name="cloud-upload" size={48} color="#6366f1" />
                    </View>
                    <Text style={styles.uploadTitle}>Tap to Upload</Text>
                    <Text style={styles.uploadSubtitle}>
                      Supports PDF, Word (.docx), and text files
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  flex: {
    flex: 1,
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  methodToggle: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  methodButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  methodButtonActive: {
    backgroundColor: '#6366f1',
  },
  methodButtonText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#6b7280',
  },
  methodButtonTextActive: {
    color: '#fff',
  },
  inputGroup: {
    marginBottom: 20,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: '#9ca3af',
    marginBottom: 8,
  },
  sampleButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderRadius: 6,
  },
  sampleButtonText: {
    color: '#6366f1',
    fontSize: 13,
    fontWeight: '500',
  },
  titleInput: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#fff',
  },
  scriptInput: {
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#fff',
    minHeight: 240,
    maxHeight: 400,
  },
  formatGuide: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.2)',
  },
  formatTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6366f1',
    marginBottom: 8,
  },
  formatText: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 20,
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
    flex: 1,
  },
  smartParseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7c3aed',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 10,
    flex: 1,
  },
  parseOptions: {
    flexDirection: 'row',
    gap: 10,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  uploadArea: {
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#2a2a3e',
    borderStyle: 'dashed',
    borderRadius: 16,
    paddingVertical: 60,
    alignItems: 'center',
    marginTop: 20,
  },
  uploadIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  uploadTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  uploadSubtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
});
