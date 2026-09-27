import React, { useState, useEffect } from 'react';
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
import { DebugLog } from '../services/debugLogService';
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

  // FORENSIC: Track screen view
  useEffect(() => {
    DebugLog.setScreen('UploadScreen');
  }, []);

  const handleFilePick = async () => {
    DebugLog.buttonPress('file-pick-btn', 'UploadScreen');
    DebugLog.setOperation('file-pick', {});
    try {
      DebugLog.importStage('picker-open', {});
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
      DebugLog.importStage('picker-result', { canceled: !!result.canceled });

      if (result.canceled) {
        console.log('[Upload] Picker cancelled by user');
        DebugLog.clearOperation();
        return;
      }

      // Validate assets array exists and has items
      if (!result.assets || result.assets.length === 0) {
        console.error('[Upload] No assets in picker result');
        DebugLog.errorCaught('picker-no-assets', new Error('No assets returned from picker'));
        Alert.alert('Error', 'No file was returned from the file picker. Please try again.');
        DebugLog.clearOperation();
        return;
      }

      const file = result.assets[0];
      console.log('[Upload] File object keys:', Object.keys(file || {}).join(', '));

      if (!file) {
        DebugLog.errorCaught('picker-file-null', new Error('File object is null'));
        Alert.alert('Error', 'File selection failed. Please try again.');
        DebugLog.clearOperation();
        return;
      }

      if (!file.uri) {
        DebugLog.errorCaught('picker-uri-missing', new Error('File URI missing'), { file: JSON.stringify(file).substring(0, 300) });
        Alert.alert('Error', 'File URI is missing. Please try selecting the file again.');
        DebugLog.clearOperation();
        return;
      }

      const filename = (file.name || 'unknown').toLowerCase();
      const fileType = filename.endsWith('.pdf') ? 'pdf'
        : filename.endsWith('.docx') ? 'docx'
        : filename.endsWith('.doc') ? 'doc'
        : (filename.endsWith('.txt') || filename.endsWith('.text')) ? 'txt'
        : 'unknown';
      console.log(`[Upload] File picked: name=${file.name}, mime=${file.mimeType}, size=${file.size}, uri=${file.uri.substring(0, 100)}`);
      DebugLog.importStage('file-picked', {
        fileName: file.name,
        fileType,
        fileSize: file.size,
        mimeType: file.mimeType,
        uriScheme: (file.uri || '').substring(0, 12),
      });
      setLoading(true);

      // ── TEXT FILE PATH ───────────────────────────────────────────────
      if (fileType === 'txt') {
        DebugLog.setOperation('txt-import', { fileName: file.name, fileSize: file.size });
        try {
          // Always copy to cache first — content:// URIs are not readable directly on Android 13+
          let readableUri = file.uri;
          if (Platform.OS === 'android') {
            DebugLog.importStage('txt-copy-to-cache-start', { parser: 'FileSystem.copyAsync' });
            const cacheUri = `${FileSystem.cacheDirectory}text_${Date.now()}_${(file.name || 'file.txt').replace(/[^A-Za-z0-9._-]/g, '_')}`;
            try {
              await withTimeout(
                FileSystem.copyAsync({ from: file.uri, to: cacheUri }),
                FILE_OP_TIMEOUT,
                'Text file copy to cache'
              );
              // Verify copy actually produced a non-empty file
              const info = await FileSystem.getInfoAsync(cacheUri);
              if (info.exists && info.size && info.size > 0) {
                readableUri = cacheUri;
                DebugLog.importStage('txt-copy-to-cache-ok', { cachedBytes: info.size });
              } else {
                DebugLog.importStage('txt-copy-empty-fallback-to-original', { info: JSON.stringify(info).substring(0, 200) });
              }
            } catch (copyErr: any) {
              DebugLog.errorCaught('txt-copy-to-cache', copyErr, { parser: 'FileSystem.copyAsync' });
              // Fall back to original URI, will likely fail but try anyway
            }
          }

          DebugLog.importStage('txt-read-start', { parser: 'FileSystem.readAsStringAsync', uriScheme: readableUri.substring(0, 12) });
          const content = await withTimeout(
            FileSystem.readAsStringAsync(readableUri),
            FILE_OP_TIMEOUT,
            'Text file read'
          );
          const contentLen = content?.length || 0;
          console.log(`[Upload] Read ${contentLen} characters`);
          DebugLog.importStage('txt-read-done', { bytesRead: contentLen });

          if (!content || content.trim().length === 0) {
            DebugLog.importStage('txt-empty-file', { bytesRead: contentLen });
            Alert.alert(
              'Empty File',
              `The selected file appears to be empty (${contentLen} bytes read). Please check the file and try again.`,
            );
            setLoading(false);
            DebugLog.clearOperation();
            return;
          }

          // ► KEY UX FIX: switch back to Paste Text tab so the user SEES the loaded content
          //   and has access to the Save/Parse buttons. Previously the content vanished
          //   because the File tab has no preview and no save button.
          setScriptText(content);
          if (!title) {
            setTitle((file.name || 'Untitled').replace(/\.[^/.]+$/, ''));
          }
          setUploadMethod('paste');
          setLoading(false);
          DebugLog.importStage('txt-import-success-switched-to-paste', { chars: contentLen });
          DebugLog.clearOperation();
          Alert.alert(
            'File Loaded',
            `"${file.name}" loaded (${contentLen} characters). Review the text below and tap Parse with AI or Smart Parse V2 to save.`,
          );
        } catch (readErr: any) {
          DebugLog.errorCaught('txt-read', readErr, { fileName: file.name, fileSize: file.size });
          Alert.alert(
            'Could Not Read File',
            `Failed to read "${file.name}".\n\n${readErr?.message || 'Unknown error'}\n\nTry saving the file to your device's local storage and retrying.`,
          );
          setLoading(false);
          DebugLog.clearOperation();
        }
        return;
      }

      // ── BINARY (PDF / DOCX / other) PATH ─────────────────────────────
      // Android crash mitigation: on Android we ALWAYS use base64 upload.
      // FormData with a content:// URI is the source of the native SIGSEGV
      // in the multipart encoder on RN new architecture. Base64 goes via
      // JSON which is safe.
      DebugLog.setOperation(`${fileType}-import`, { fileName: file.name, fileSize: file.size });

      // Determine MIME type
      let mimeType = file.mimeType || 'application/octet-stream';
      if (fileType === 'pdf') mimeType = 'application/pdf';
      else if (fileType === 'docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (fileType === 'doc') mimeType = 'application/msword';

      // Copy to cache first to ensure a stable file:// URI we can read.
      let fileUri = file.uri;
      if (Platform.OS === 'android' && !fileUri.startsWith('file://')) {
        DebugLog.importStage(`${fileType}-copy-to-cache-start`, { parser: 'FileSystem.copyAsync' });
        const cacheUri = `${FileSystem.cacheDirectory}upload_${Date.now()}_${(file.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_')}`;
        try {
          await withTimeout(
            FileSystem.copyAsync({ from: file.uri, to: cacheUri }),
            FILE_OP_TIMEOUT,
            'Binary file copy to cache'
          );
          const info = await FileSystem.getInfoAsync(cacheUri);
          if (info.exists && info.size && info.size > 0) {
            fileUri = cacheUri;
            DebugLog.importStage(`${fileType}-copy-to-cache-ok`, { cachedBytes: info.size });
          } else {
            DebugLog.importStage(`${fileType}-copy-empty-abort`, { info: JSON.stringify(info).substring(0, 200) });
            Alert.alert(
              'Could Not Read File',
              `The system did not return usable content for "${file.name}". Try saving the file to internal storage first and re-selecting.`,
            );
            setLoading(false);
            DebugLog.clearOperation();
            return;
          }
        } catch (copyErr: any) {
          DebugLog.errorCaught(`${fileType}-copy-to-cache`, copyErr, { parser: 'FileSystem.copyAsync' });
          Alert.alert(
            'Could Not Read File',
            `Failed to prepare "${file.name}" for upload.\n\n${copyErr?.message || 'Unknown error'}`,
          );
          setLoading(false);
          DebugLog.clearOperation();
          return;
        }
      }

      // Get device ID for user association
      const userId = await getDeviceId();
      console.log('[Upload] User ID:', userId.substring(0, 20) + '...');

      const uploadUrl = `${API_BASE_URL}/api/scripts/upload`;
      const base64Url = `${API_BASE_URL}/api/scripts/upload-base64`;

      // Prefer base64 on Android (crash-safe). Non-Android uses FormData.
      let response: any;
      const useBase64First = Platform.OS === 'android';

      const runBase64 = async () => {
        DebugLog.importStage(`${fileType}-base64-read-start`, { parser: 'FileSystem.readAsStringAsync base64' });
        const base64Data = await withTimeout(
          FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 }),
          FILE_OP_TIMEOUT,
          'Base64 file read'
        );
        DebugLog.importStage(`${fileType}-base64-read-done`, { base64Chars: base64Data?.length || 0 });
        DebugLog.importStage(`${fileType}-base64-post`, { url: base64Url });
        const t0 = Date.now();
        try {
          const resp = await axios.post(
            base64Url,
            {
              title: title || (file.name || 'Untitled').replace(/\.[^/.]+$/, ''),
              filename: file.name || 'uploaded_file',
              file_data: base64Data,
              user_id: userId,
            },
            { headers: { 'Content-Type': 'application/json' }, timeout: UPLOAD_TIMEOUT }
          );
          DebugLog.importStage(`${fileType}-base64-ok`, { status: resp?.status, durationMs: Date.now() - t0, scriptId: resp?.data?.id });
          return resp;
        } catch (err: any) {
          const status = err?.response?.status ?? 'no status';
          DebugLog.httpErrorSnapshot('POST', base64Url, status, err?.response?.data, err?.message || 'unknown');
          throw err;
        }
      };

      const runFormData = async () => {
        DebugLog.importStage(`${fileType}-formdata-prepare`, { mimeType });
        const formData = new FormData();
        formData.append('file', { uri: fileUri, type: mimeType, name: file.name || 'uploaded_file' } as any);
        formData.append('title', title || (file.name || 'Untitled').replace(/\.[^/.]+$/, ''));
        formData.append('user_id', userId);
        const t0 = Date.now();
        DebugLog.importStage(`${fileType}-formdata-post`, { url: uploadUrl });
        try {
          const resp = await axios.post(uploadUrl, formData, { timeout: UPLOAD_TIMEOUT });
          DebugLog.importStage(`${fileType}-formdata-ok`, { status: resp?.status, durationMs: Date.now() - t0, scriptId: resp?.data?.id });
          return resp;
        } catch (err: any) {
          const status = err?.response?.status ?? 'no status';
          DebugLog.httpErrorSnapshot('POST', uploadUrl, status, err?.response?.data, err?.message || 'unknown');
          throw err;
        }
      };

      try {
        if (useBase64First) {
          try {
            response = await runBase64();
          } catch (b64Err: any) {
            DebugLog.errorCaught(`${fileType}-base64-primary`, b64Err);
            // Only try FormData if backend reachable (avoid double native-crash risk)
            if (b64Err?.response?.status) {
              // Server-side error, don't retry with FormData (would hit same backend)
              throw b64Err;
            }
            // Network failure — do NOT fall through to FormData on Android (native crash risk).
            throw b64Err;
          }
        } else {
          try {
            response = await runFormData();
          } catch (fdErr: any) {
            DebugLog.errorCaught(`${fileType}-formdata-primary`, fdErr);
            response = await runBase64();
          }
        }
      } catch (uploadErr: any) {
        // Both paths failed — bubble to outer catch with clear diagnostics
        throw uploadErr;
      }

      console.log('[Upload] Server response received, id:', response?.data?.id);
      const scriptId = response?.data?.id;
      if (!scriptId) {
        DebugLog.errorCaught(`${fileType}-no-script-id`, new Error('Server response missing id'));
        Alert.alert('Upload Failed', 'Server did not return a script id.');
        setLoading(false);
        DebugLog.clearOperation();
        return;
      }
      DebugLog.importStage(`${fileType}-import-success`, { scriptId });
      DebugLog.clearOperation();
      setLoading(false);
      Alert.alert('Success', 'Script uploaded and parsed successfully!', [
        {
          text: 'View Script',
          onPress: () => {
            try { router.replace(`/script/${scriptId}`); }
            catch (navErr: any) { DebugLog.errorCaught('post-upload-nav', navErr); }
          },
        },
      ]);
    } catch (error: any) {
      // Outer guard: no exception from here on may crash the app.
      try {
        setLoading(false);
        const status = error?.response?.status;
        const serverMsg = error?.response?.data?.detail;
        const errMsg = error?.message || 'Unknown error';
        const requestUrl = error?.config?.url || `${API_BASE_URL}/api/scripts/upload`;
        console.error(`[Upload] Failed: status=${status}, msg=${errMsg}, server=${serverMsg}, requestUrl=${requestUrl}`);
        DebugLog.errorCaught('upload-outer', error, { status, requestUrl, serverMsg });

        let msg = 'Failed to upload file';
        if (error?.code === 'ECONNABORTED' || (typeof errMsg === 'string' && errMsg.includes('timeout'))) {
          msg = 'Upload timed out. Please check your connection and try again.';
        } else if (errMsg === 'Network Error' || !error?.response) {
          msg = `Unable to reach server.\n\nEndpoint: ${requestUrl}\nError: ${errMsg}\n\nCheck your internet connection.`;
        } else if (status === 404) {
          msg = `Endpoint not found (404).\n\nURL: ${requestUrl}`;
        } else if (status === 413) {
          msg = 'File is too large. Please try a smaller file.';
        } else if (status === 415) {
          msg = 'Unsupported file type. Please use PDF, DOCX, or TXT files.';
        } else if (status === 400 && serverMsg) {
          msg = `Import failed: ${serverMsg}`;
        } else if (serverMsg) {
          msg = serverMsg;
        } else {
          msg = `Upload failed (${status || 'no status'}): ${errMsg}`;
        }
        Alert.alert('Import Failed', `${msg}\n\nOpen Support → Bug Report and tap "Copy Diagnostic Report" to send us the details.`);
        DebugLog.clearOperation();
      } catch (fatal: any) {
        // Absolute last resort
        console.error('[Upload] FATAL guard tripped:', fatal?.message);
        try { setLoading(false); } catch { /* ignore */ }
      }
    }
  };

  const handleSubmit = async () => {
    // FORENSIC: Log Parse with AI button press
    DebugLog.buttonPress('parse-ai-btn', 'UploadScreen');
    DebugLog.functionStart('handleSubmit', { 
      titleLength: title.trim().length, 
      textLength: scriptText.trim().length 
    });
    
    if (!title.trim()) {
      DebugLog.alertShown('Error', 'Please enter a script title');
      Alert.alert('Error', 'Please enter a script title');
      return;
    }
    if (!scriptText.trim()) {
      DebugLog.alertShown('Error', 'Please paste your script text');
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
        DebugLog.functionSuccess('handleSubmit', { scriptId: script.id });
        DebugLog.alertShown('Success', 'Script created and parsed successfully!');
        Alert.alert('Success', 'Script created and parsed successfully!', [
          {
            text: 'View Script',
            onPress: () => {
              DebugLog.navigation('UploadScreen', `script/${script.id}`);
              router.replace(`/script/${script.id}`);
            },
          },
        ]);
      } else {
        // createScript catches errors internally and returns null — surface this to user
        const storeError = useScriptStore.getState().error;
        console.error(`[Upload] createScript returned null, store error: ${storeError}`);
        DebugLog.functionError('handleSubmit', new Error(storeError || 'createScript returned null'));
        DebugLog.alertShown('Save Failed', storeError || 'Could not save script');
        Alert.alert(
          'Save Failed',
          storeError || 'Could not save script. Please check your internet connection and try again.'
        );
      }
    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error';
      const serverMsg = error?.response?.data?.detail;
      console.error(`[Upload] Submit failed: msg=${errMsg}, server=${serverMsg}`);
      DebugLog.functionError('handleSubmit', error);

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
      DebugLog.alertShown('Error', msg);
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
                  onPress={async () => {
                    if (!title.trim() || !scriptText.trim()) {
                      DebugLog.alertShown('Error', 'Enter a title and paste script text first');
                      Alert.alert('Error', 'Enter a title and paste script text first');
                      return;
                    }
                    // FORENSIC: Log Smart Parse V2 navigation
                    DebugLog.buttonPress('parse-smart-btn', 'UploadScreen');
                    DebugLog.navigation('UploadScreen', 'script-parser', {
                      titleLength: title.trim().length,
                      rawTextLength: scriptText.trim().length,
                    });
                    // ANDROID FIX: Persist rawText in AsyncStorage instead of URL params
                    // (URL params get corrupted/truncated on Android for large file-imported text).
                    try {
                      await AsyncStorage.setItem('pending_script_rawtext', scriptText.trim());
                      await AsyncStorage.setItem('pending_script_title', title.trim());
                      console.log(`[Upload] Stashed rawText (${scriptText.trim().length} chars) in AsyncStorage for parser`);
                    } catch (storageErr: any) {
                      console.error('[Upload] AsyncStorage stash failed:', storageErr?.message);
                      Alert.alert('Error', 'Could not stage script for parsing. Please retry.');
                      return;
                    }
                    router.push({
                      pathname: '/script-parser',
                      params: { title: title.trim(), fromStorage: '1' },
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
