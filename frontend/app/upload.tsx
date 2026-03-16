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
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import axios from 'axios';

import { useScriptStore } from '../store/scriptStore';

import { API_BASE_URL } from '../services/apiConfig';

const UPLOAD_TIMEOUT = 30000; // 30s for file uploads
const FILE_OP_TIMEOUT = 15000; // 15s for file system operations

// Helper to wrap async operations with a timeout
function withTimeout(promise, ms, operation) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${operation} timed out after ${ms / 1000}s`));
    }, ms);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
};

// Get device ID directly — same logic as store, ensures it's always available
const getDeviceId = async (): Promise<string> => {
  try {
    let deviceId = await AsyncStorage.getItem('device_id');
    if (deviceId) return deviceId;
    const uniqueId = Device.modelId || Device.deviceName || 'unknown';
    deviceId = `${uniqueId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    await AsyncStorage.setItem('device_id', deviceId);
    return deviceId;
  } catch {
    return `fallback-${Date.now()}`;
  }
};

export default function UploadScreen() {
  const [title, setTitle] = useState('');
  const [scriptText, setScriptText] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadMethod, setUploadMethod] = useState<'paste' | 'file'>('paste');
  const { createScript } = useScriptStore();

  const handleFilePick = async () => {
    try {
      console.log('[Upload] Opening document picker...');
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

      console.log('[Upload] Picker result type:', result.canceled ? 'canceled' : 'success');

      if (result.canceled) {
        console.log('[Upload] Picker cancelled by user');
        return;
      }

      // Validate assets array exists and has items
      if (!result.assets || result.assets.length === 0) {
        console.error('[Upload] No assets in picker result');
        Alert.alert('Error', 'No file was returned from the file picker. Please try again.');
        return;
      }

      const file = result.assets[0];
      console.log('[Upload] File object keys:', Object.keys(file || {}).join(', '));
      
      if (!file) {
        console.error('[Upload] File object is null/undefined');
        Alert.alert('Error', 'File selection failed. Please try again.');
        return;
      }
      
      if (!file.uri) {
        console.error('[Upload] File URI is missing. File object:', JSON.stringify(file));
        Alert.alert('Error', 'File URI is missing. Please try selecting the file again.');
        return;
      }

      const filename = (file.name || 'unknown').toLowerCase();
      console.log(`[Upload] File picked: name=${file.name}, mime=${file.mimeType}, size=${file.size}, uri=${file.uri.substring(0, 100)}`);
      setLoading(true);

      // Text files can be read directly
      if (filename.endsWith('.txt') || filename.endsWith('.text')) {
        console.log('[Upload] Processing as text file...');
        try {
          // Copy to cache first to ensure we have a readable URI
          let readableUri = file.uri;
          if (Platform.OS === 'android') {
            console.log('[Upload] Android: copying text file to cache...');
            const cacheUri = `${FileSystem.cacheDirectory}text_${Date.now()}_${file.name || 'file.txt'}`;
            try {
              await withTimeout(
                FileSystem.copyAsync({ from: file.uri, to: cacheUri }),
                FILE_OP_TIMEOUT,
                'Text file copy to cache'
              );
              readableUri = cacheUri;
              console.log('[Upload] Copied to:', readableUri);
            } catch (copyErr: any) {
              console.log('[Upload] Copy failed, using original URI:', copyErr?.message);
            }
          }
          
          console.log('[Upload] Reading text content from:', readableUri.substring(0, 80));
          const content = await withTimeout(
            FileSystem.readAsStringAsync(readableUri),
            FILE_OP_TIMEOUT,
            'Text file read'
          );
          console.log(`[Upload] Read ${content?.length || 0} characters`);
          
          if (!content || content.trim().length === 0) {
            Alert.alert('Empty File', 'The selected file appears to be empty.');
            setLoading(false);
            return;
          }
          setScriptText(content);
          if (!title) {
            setTitle((file.name || 'Untitled').replace(/\.[^/.]+$/, ''));
          }
          setLoading(false);
          Alert.alert('File Loaded', `"${file.name}" loaded. Review the text below and tap Save Script.`);
        } catch (readErr: any) {
          console.error(`[Upload] Failed to read text file: ${readErr?.message}`, readErr);
          Alert.alert('Error', `Could not read file: ${readErr?.message || 'Unknown error'}`);
          setLoading(false);
        }
      } else {
        // PDF, Word docs, and other files - upload to backend for parsing
        console.log('[Upload] Processing as binary file (PDF/DOCX)...');
        const formData = new FormData();
        
        // Determine MIME type
        let mimeType = file.mimeType || 'application/octet-stream';
        if (filename.endsWith('.pdf')) {
          mimeType = 'application/pdf';
        } else if (filename.endsWith('.docx')) {
          mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (filename.endsWith('.doc')) {
          mimeType = 'application/msword';
        }

        // Ensure URI is properly formatted for Android
        let fileUri = file.uri;
        if (Platform.OS === 'android' && !fileUri.startsWith('file://')) {
          // If URI is not file://, read to cache first
          console.log('[Upload] Android: copying binary file to cache...');
          const cacheUri = `${FileSystem.cacheDirectory}upload_${Date.now()}_${file.name || 'file'}`;
          try {
            await withTimeout(
              FileSystem.copyAsync({ from: file.uri, to: cacheUri }),
              FILE_OP_TIMEOUT,
              'File copy to cache'
            );
            fileUri = cacheUri;
            console.log('[Upload] Copied to:', fileUri);
          } catch (copyErr: any) {
            console.error('[Upload] Copy failed:', copyErr?.message);
            // If copy fails, try using the original URI anyway
            console.log('[Upload] Attempting upload with original URI...');
          }
        }

        console.log(`[Upload] Uploading file: name=${file.name}, mime=${mimeType}, uri=${fileUri.substring(0, 80)}`);
        
        // Get device ID for user association
        const userId = await getDeviceId();
        console.log('[Upload] User ID:', userId.substring(0, 20) + '...');
        
        formData.append('file', {
          uri: fileUri,
          type: mimeType,
          name: file.name || 'uploaded_file',
        } as any);
        formData.append('title', title || (file.name || 'Untitled').replace(/\.[^/.]+$/, ''));
        formData.append('user_id', userId);

        console.log('[Upload] Sending FormData to server...');
        const uploadUrl = `${API_BASE_URL}/api/scripts/upload`;
        const base64Url = `${API_BASE_URL}/api/scripts/upload-base64`;
        console.log(`[Upload] Target URL: ${uploadUrl}`);
        
        let response;
        try {
          response = await axios.post(
            uploadUrl,
            formData,
            {
              timeout: UPLOAD_TIMEOUT,
              // Do NOT set Content-Type manually — axios/RN must set it with the correct multipart boundary
            }
          );
          console.log('[Upload] FormData upload succeeded');
        } catch (formDataError: any) {
          console.log(`[Upload] FormData failed: ${formDataError?.response?.status || 'no status'} - ${formDataError?.message}`);
          // Fallback: if FormData upload fails on Android, try base64 upload
          if (Platform.OS === 'android') {
            console.log(`[Upload] Trying base64 fallback to: ${base64Url}`);
            try {
              const base64Data = await withTimeout(
                FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 }),
                FILE_OP_TIMEOUT,
                'Base64 file read'
              );
              console.log(`[Upload] Read ${base64Data?.length || 0} base64 chars, posting to upload-base64...`);
              response = await axios.post(
                base64Url,
                {
                  title: title || (file.name || 'Untitled').replace(/\.[^/.]+$/, ''),
                  filename: file.name || 'uploaded_file',
                  file_data: base64Data,
                  user_id: userId,
                },
                {
                  headers: { 'Content-Type': 'application/json' },
                  timeout: UPLOAD_TIMEOUT,
                }
              );
              console.log('[Upload] Base64 upload succeeded');
            } catch (base64Err: any) {
              console.error('[Upload] Base64 fallback also failed:', base64Err?.message);
              throw base64Err;
            }
          } else {
            throw formDataError;
          }
        }

        console.log('[Upload] Server response received, id:', response?.data?.id);
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
      const status = error?.response?.status;
      const serverMsg = error?.response?.data?.detail;
      const errMsg = error?.message || 'Unknown error';
      const requestUrl = error?.config?.url || `${API_BASE_URL}/api/scripts/upload`;
      console.error(`[Upload] Failed: status=${status}, msg=${errMsg}, server=${serverMsg}, requestUrl=${requestUrl}`);
      console.error('[Upload] Full error:', error);

      let msg = 'Failed to upload file';
      if (error?.code === 'ECONNABORTED' || errMsg.includes('timeout')) {
        msg = 'Upload timed out. Please check your connection and try again.';
      } else if (errMsg === 'Network Error' || !error?.response) {
        msg = `Unable to reach server.\n\nEndpoint: ${requestUrl}\nError: ${errMsg}\n\nCheck your internet connection.`;
      } else if (status === 404) {
        msg = `Endpoint not found (404).\n\nURL: ${requestUrl}\n\nBackend may not have this route.`;
      } else if (status === 413) {
        msg = 'File is too large. Please try a smaller file.';
      } else if (status === 415) {
        msg = 'Unsupported file type. Please use PDF, DOCX, or TXT files.';
      } else if (status === 400 && serverMsg) {
        msg = serverMsg;
      } else if (serverMsg) {
        msg = serverMsg;
      } else {
        msg = `Upload failed (${status || 'no status'}): ${errMsg}\n\nEndpoint: ${requestUrl}`;
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

    console.log(`[Upload] handleSubmit: title="${title.trim().substring(0, 30)}", textLength=${scriptText.trim().length}`);
    setLoading(true);
    try {
      console.log('[Upload] Calling createScript...');
      const script = await createScript(title.trim(), scriptText.trim());
      console.log(`[Upload] createScript returned: ${script ? `id=${script.id}` : 'null'}`);
      if (script) {
        Alert.alert('Success', 'Script created and parsed successfully!', [
          {
            text: 'View Script',
            onPress: () => router.replace(`/script/${script.id}`),
          },
        ]);
      } else {
        // createScript catches errors internally and returns null — surface this to user
        const storeError = useScriptStore.getState().error;
        console.error(`[Upload] createScript returned null, store error: ${storeError}`);
        Alert.alert(
          'Save Failed',
          storeError || 'Could not save script. Please check your internet connection and try again.'
        );
      }
    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error';
      const serverMsg = error?.response?.data?.detail;
      console.error(`[Upload] Submit failed: msg=${errMsg}, server=${serverMsg}`);

      let msg = 'Failed to create script';
      if (error?.message?.includes('timeout') || error?.code === 'ECONNABORTED') {
        msg = 'Request timed out. Please check your internet connection.';
      } else if (error?.message === 'Network Error') {
        msg = `Unable to reach server. Please check your internet connection.`;
      } else if (serverMsg) {
        msg = serverMsg;
      } else {
        msg = `Upload failed: ${errMsg}`;
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
