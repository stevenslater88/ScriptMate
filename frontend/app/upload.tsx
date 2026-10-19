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
import { getAuthHeader } from '../services/authClient';
import { LinearGradient } from 'expo-linear-gradient';
import { C, GRADIENT, RADIUS, TYPE, tint } from '../constants/cinematicTheme';
import { GradientButton, IconButton, Pill, ScreenGlow } from '../components/cinematic';

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
  // Inline outcome of "Parse with AI" (mirrors the native alerts, which are no-ops on web).
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [savedScript, setSavedScript] = useState<{ id: string; title: string } | null>(null);
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
            {
              headers: {
                'Content-Type': 'application/json',
                // SEC-002: /scripts/upload-base64 is bearer-gated.
                ...(await getAuthHeader()),
              },
              timeout: UPLOAD_TIMEOUT,
            }
          );
          DebugLog.importStage(`${fileType}-base64-ok`, { status: resp?.status, durationMs: Date.now() - t0, chars: resp?.data?.raw_text?.length || 0 });
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
          const resp = await axios.post(uploadUrl, formData, {
            // SEC-002: /scripts/upload is bearer-gated.
            headers: await getAuthHeader(),
            timeout: UPLOAD_TIMEOUT,
          });
          DebugLog.importStage(`${fileType}-formdata-ok`, { status: resp?.status, durationMs: Date.now() - t0, chars: resp?.data?.raw_text?.length || 0 });
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

      // Extract raw_text from response; endpoints now return {raw_text, filename, title, size_bytes, source}
      const extractedText = response?.data?.raw_text;
      const suggestedTitle = response?.data?.title || (file.name || 'Untitled').replace(/\.[^/.]+$/, '');
      const extractedLen = typeof extractedText === 'string' ? extractedText.length : 0;
      console.log(`[Upload] Extraction complete. chars=${extractedLen}, source=${response?.data?.source}`);

      if (!extractedText || !extractedText.trim()) {
        DebugLog.errorCaught(`${fileType}-no-text`, new Error('Server returned no raw_text'));
        Alert.alert('Import Failed', 'No readable text was extracted from the file.');
        setLoading(false);
        DebugLog.clearOperation();
        return;
      }

      // ► UNIFIED FLOW: Route to /script-parser via AsyncStorage — same path
      //   the Paste Text → Smart Parse V2 button uses. This means:
      //   1. User reviews extracted text, picks character in the parser.
      //   2. handleSave in script-parser.tsx is the SINGLE owner of
      //      POST /api/scripts persistence.
      //   3. updateScript(user_character) fires from the parser, so the
      //      resulting Script has is_user_character set → Rehearse button
      //      is enabled on /script/{id}.
      try {
        await AsyncStorage.setItem('pending_script_rawtext', extractedText);
        await AsyncStorage.setItem('pending_script_title', suggestedTitle);
        DebugLog.importStage(`${fileType}-stashed-for-parser`, {
          chars: extractedLen,
          title: suggestedTitle.substring(0, 40),
        });
      } catch (stashErr: any) {
        DebugLog.errorCaught(`${fileType}-asyncstorage-stash`, stashErr);
        Alert.alert('Import Failed', 'Could not stage extracted text for parsing. Please retry.');
        setLoading(false);
        DebugLog.clearOperation();
        return;
      }

      DebugLog.importStage(`${fileType}-import-success`, {
        chars: extractedLen,
        title: suggestedTitle.substring(0, 40),
      });
      DebugLog.clearOperation();
      setLoading(false);

      // Navigate straight to the parser — same as Smart Parse V2 (no interstitial alert).
      DebugLog.navigation('UploadScreen', 'script-parser', {
        source: fileType,
        chars: extractedLen,
      });
      try {
        router.push({
          pathname: '/script-parser',
          params: { title: suggestedTitle, fromStorage: '1' },
        });
      } catch (navErr: any) {
        DebugLog.errorCaught('post-upload-nav', navErr);
        Alert.alert('Navigation Error', 'Could not open the parser. Please retry.');
      }
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
    setSubmitError(null);
    setSavedScript(null);
    setLoading(true);
    try {
      console.log('[Upload] Calling createScript...');
      const script = await createScript(title.trim(), scriptText.trim());
      console.log(`[Upload] createScript returned: ${script ? `id=${script.id}` : 'null'}`);
      if (script) {
        DebugLog.functionSuccess('handleSubmit', { scriptId: script.id });
        setSavedScript({ id: script.id, title: script.title });
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
        setSubmitError(storeError || 'Could not save script. Please check your internet connection and try again.');
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
      setSubmitError(msg);
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

  const methodTab = (key: 'paste' | 'file', icon: any, label: string) => {
    const active = uploadMethod === key;
    return (
      <TouchableOpacity
        style={[styles.methodButton, active && styles.methodButtonActive]}
        onPress={() => setUploadMethod(key)}
        testID={`upload-method-${key}`}
      >
        <Ionicons name={icon} size={18} color={active ? '#fff' : C.muted} />
        <Text style={[styles.methodButtonText, active && styles.methodButtonTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScreenGlow />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        {/* Header */}
        <View style={styles.header}>
          <IconButton icon="chevron-back" onPress={() => router.back()} testID="upload-back-btn" />
          <Pill label="Script import" icon="document-text" />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.headerTitle}>Add Script</Text>
          <Text style={styles.headerSub}>Paste text or import a file. We'll detect the characters and dialogue for you.</Text>

          {/* What happens next */}
          <View style={styles.steps} testID="upload-steps">
            {['Add your script', 'Characters detected', 'Pick your role & rehearse'].map((t, i) => (
              <View key={t} style={styles.step}>
                <View style={[styles.stepDot, i === 0 && styles.stepDotActive]}><Text style={styles.stepN}>{i + 1}</Text></View>
                <Text style={[styles.stepTx, i === 0 && styles.stepTxActive]} numberOfLines={2}>{t}</Text>
              </View>
            ))}
          </View>

          {/* Method Toggle */}
          <View style={styles.methodToggle}>
            {methodTab('paste', 'create-outline', 'Paste Text')}
            {methodTab('file', 'document-outline', 'Upload File')}
          </View>

          {/* Title Input */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Script Title</Text>
            <TextInput
              style={styles.titleInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Enter script title..."
              placeholderTextColor={C.dim}
              testID="upload-title-input"
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
                    testID="upload-use-sample-btn"
                  >
                    <Text style={styles.sampleButtonText}>Use Sample</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                  style={styles.scriptInput}
                  value={scriptText}
                  onChangeText={setScriptText}
                  placeholder={'Paste your script here...\n\nFormat:\nCHARACTER NAME\nDialogue text\n\n(Stage directions in parentheses)'}
                  placeholderTextColor={C.dim}
                  multiline
                  textAlignVertical="top"
                  testID="upload-script-input"
                />
              </View>

              {/* Format Guide */}
              <View style={styles.formatGuide}>
                <View style={styles.formatHead}>
                  <Ionicons name="information-circle" size={16} color={C.violetSoft} />
                  <Text style={styles.formatTitle}>Script Format Tips</Text>
                </View>
                <Text style={styles.formatText}>
                  • Character names in ALL CAPS on their own line{"\n"}
                  • Dialogue on the following lines{"\n"}
                  • Stage directions in (parentheses) or [brackets]
                </Text>
              </View>

              {/* Outcome */}
              {submitError ? (
                <View style={styles.errorBox} testID="upload-error-banner">
                  <Ionicons name="alert-circle" size={20} color={C.danger} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.errorTitle}>Couldn't save this script</Text>
                    <Text style={styles.errorText}>{submitError}</Text>
                    <Text style={styles.errorHint}>Your text is still here. Check your connection and try again, or use Smart Parse V2 to review it first.</Text>
                  </View>
                </View>
              ) : null}
              {savedScript ? (
                <View style={styles.successBox} testID="upload-success-banner">
                  <View style={styles.successHead}>
                    <Ionicons name="checkmark-circle" size={20} color={C.success} />
                    <Text style={styles.successTitle}>Script saved</Text>
                  </View>
                  <Text style={styles.successText}>Next: open "{savedScript.title}", choose your character and start rehearsing.</Text>
                  <GradientButton
                    label="Open script"
                    icon="arrow-forward"
                    onPress={() => router.replace(`/script/${savedScript.id}`)}
                    testID="upload-open-saved-btn"
                    style={{ marginTop: 12 }}
                  />
                </View>
              ) : null}

              {/* Submit Buttons */}
              <View style={styles.parseOptions}>
                <TouchableOpacity
                  style={[styles.submitButtonWrap, loading && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={loading}
                  testID="parse-ai-btn"
                >
                  <LinearGradient colors={GRADIENT.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.submitButton}>
                    {loading ? (
                      <>
                        <ActivityIndicator color="#fff" />
                        <Text style={styles.submitButtonText}>Saving & parsing…</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={19} color="#fff" />
                        <Text style={styles.submitButtonText}>{submitError ? 'Try again' : 'Parse with AI'}</Text>
                      </>
                    )}
                  </LinearGradient>
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
                  <Ionicons name="flash" size={19} color={C.cyan} />
                  <Text style={styles.smartParseText}>Smart Parse V2 · review first</Text>
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
                testID="upload-file-area"
              >
                {loading ? (
                  <>
                    <ActivityIndicator size="large" color={C.violetSoft} />
                    <Text style={styles.uploadTitle}>Reading your file…</Text>
                    <Text style={styles.uploadSubtitle}>Extracting text and detecting characters</Text>
                  </>
                ) : (
                  <>
                    <LinearGradient colors={GRADIENT.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.uploadIcon}>
                      <Ionicons name="cloud-upload" size={30} color="#fff" />
                    </LinearGradient>
                    <Text style={styles.uploadTitle}>Tap to Upload</Text>
                    <Text style={styles.uploadSubtitle}>
                      Supports PDF, Word (.docx), and text files
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={styles.fileHint}>After the file is read you'll review the detected lines before saving.</Text>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.ink },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 },
  headerTitle: { ...TYPE.display, fontSize: 26, marginTop: 6 },
  headerSub: { ...TYPE.caption, fontSize: 13, lineHeight: 19, marginTop: 4 },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 40 },
  steps: { flexDirection: 'row', gap: 8, marginTop: 16, marginBottom: 16 },
  step: { flex: 1, backgroundColor: C.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line, padding: 10, gap: 6 },
  stepDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: C.violet },
  stepN: { fontSize: 11, fontWeight: '800', color: '#fff' },
  stepTx: { fontSize: 11.5, fontWeight: '600', color: C.muted, lineHeight: 15 },
  stepTxActive: { color: C.text },
  methodToggle: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: RADIUS.md, padding: 4, marginBottom: 18, borderWidth: 1, borderColor: C.line },
  methodButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 42, borderRadius: 11, gap: 7 },
  methodButtonActive: { backgroundColor: tint(C.violet, 0.28), borderWidth: 1, borderColor: tint(C.violet, 0.55) },
  methodButtonText: { fontSize: 14, fontWeight: '600', color: C.muted },
  methodButtonTextActive: { color: '#fff' },
  inputGroup: { marginBottom: 16 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  label: { ...TYPE.label, marginBottom: 8 },
  sampleButton: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: tint(C.violet, 0.14), marginBottom: 8 },
  sampleButtonText: { color: C.violetSoft, fontSize: 12, fontWeight: '700' },
  titleInput: { backgroundColor: C.surface2, borderRadius: RADIUS.md, paddingHorizontal: 14, height: 48, fontSize: 15, color: C.text, borderWidth: 1, borderColor: C.line },
  scriptInput: { backgroundColor: C.surface2, borderRadius: RADIUS.md, padding: 14, fontSize: 13.5, lineHeight: 20, color: C.text, minHeight: 220, borderWidth: 1, borderColor: C.line, fontFamily: 'monospace' },
  formatGuide: { backgroundColor: tint(C.violet, 0.07), borderRadius: RADIUS.md, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: tint(C.violet, 0.2) },
  formatHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  formatTitle: { fontSize: 13, fontWeight: '700', color: C.text },
  formatText: { fontSize: 12.5, color: C.muted, lineHeight: 20 },
  errorBox: { flexDirection: 'row', gap: 10, backgroundColor: tint(C.danger, 0.08), borderRadius: RADIUS.md, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: tint(C.danger, 0.3) },
  errorTitle: { fontSize: 14, fontWeight: '700', color: '#FF8CA2' },
  errorText: { fontSize: 12.5, color: C.text, marginTop: 3, lineHeight: 18 },
  errorHint: { fontSize: 12, color: C.muted, marginTop: 6, lineHeight: 17 },
  successBox: { backgroundColor: tint(C.success, 0.08), borderRadius: RADIUS.md, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: tint(C.success, 0.3) },
  successHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  successTitle: { fontSize: 14, fontWeight: '700', color: C.success },
  successText: { fontSize: 12.5, color: C.text, marginTop: 4, lineHeight: 18 },
  parseOptions: { gap: 10 },
  submitButtonWrap: { borderRadius: RADIUS.md, overflow: 'hidden' },
  submitButton: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  smartParseButton: { height: 50, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: tint(C.cyan, 0.3) },
  smartParseText: { color: C.text, fontSize: 14, fontWeight: '700' },
  uploadArea: { borderRadius: RADIUS.xl, borderWidth: 1.5, borderStyle: 'dashed', borderColor: tint(C.violetSoft, 0.45), backgroundColor: tint(C.violet, 0.06), paddingVertical: 34, paddingHorizontal: 16, alignItems: 'center' },
  uploadIcon: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  uploadTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginTop: 4 },
  uploadSubtitle: { fontSize: 12.5, color: C.muted, marginTop: 5, textAlign: 'center' },
  fileHint: { ...TYPE.caption, textAlign: 'center', marginTop: 12 },
});
