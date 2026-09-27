import { Platform, Alert } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import Purchases, { PurchasesOfferings, CustomerInfo } from 'react-native-purchases';
import { getConfigAudit, ConfigAudit } from './appConfig';
import { API_BASE_URL, API_CONFIG_SOURCE } from './apiConfig';

// Build fingerprint — imported from _layout.tsx would create a circular dependency,
// so we duplicate the exact same value here.
export const BUILD_FINGERPRINT = 'SM8-1110-QA';

// BUILD SOURCE VERIFICATION - This proves which code was actually built
// If device shows different values, the build is from different code
export const BUILD_PROOF = {
  branch: 'main',
  commit: 'pending', // Will be set after GitHub push
  build: 1110,
  backendUrl: API_BASE_URL,
  configSource: API_CONFIG_SOURCE,
  timestamp: '2026-02-27T00:00:00Z',
  marker: `BUILD_PROOF: branch=main build=1110 backend=${API_BASE_URL}`,
};

// Feature Flags - HARDCODED for stabilization mode
export const FeatureFlags = {
  PREMIUM_ENABLED: true,
  SHOW_LIFETIME: false,
  PAYWALL_VARIANT: 'A',
};

// Expected product IDs
const EXPECTED_PRODUCT_IDS = ['monthly', 'yearly', 'lifetime', '$rc_monthly', '$rc_annual', '$rc_lifetime'];

// Diagnostics state
interface DiagnosticsState {
  lastPurchaseAttempt: {
    timestamp: string;
    productId: string;
    result: 'success' | 'error' | 'cancelled';
    errorCode?: string;
    errorMessage?: string;
  } | null;
  lastPaywallError: string | null;
  revenueCatInitError: string | null;
  offerings: PurchasesOfferings | null;
  customerInfo: CustomerInfo | null;
  missingProducts: string[];
}

const diagnosticsState: DiagnosticsState = {
  lastPurchaseAttempt: null,
  lastPaywallError: null,
  revenueCatInitError: null,
  offerings: null,
  customerInfo: null,
  missingProducts: [],
};

// Log purchase attempt
export const logPurchaseAttempt = (
  productId: string,
  result: 'success' | 'error' | 'cancelled',
  errorCode?: string,
  errorMessage?: string
) => {
  diagnosticsState.lastPurchaseAttempt = {
    timestamp: new Date().toISOString(),
    productId,
    result,
    errorCode,
    errorMessage,
  };
};

// Log paywall error
export const logPaywallError = (error: string) => {
  diagnosticsState.lastPaywallError = error;
};

// Log RevenueCat init error
export const logRevenueCatInitError = (error: string) => {
  diagnosticsState.revenueCatInitError = error;
};

// Update offerings cache
export const updateOfferingsCache = (offerings: PurchasesOfferings | null) => {
  diagnosticsState.offerings = offerings;
  
  // Check for missing products
  if (offerings?.current) {
    const availableIds = offerings.current.availablePackages.map(p => p.identifier);
    diagnosticsState.missingProducts = EXPECTED_PRODUCT_IDS.filter(
      id => !availableIds.some(availId => availId.includes(id) || id.includes(availId))
    );
  }
};

// Update customer info cache
export const updateCustomerInfoCache = (info: CustomerInfo | null) => {
  diagnosticsState.customerInfo = info;
};

// Get API key prefix (safe to show)
// HARDCODED: matches the literal string in _layout.tsx
const getApiKeyPrefix = (): string => {
  // On Android, the key is hardcoded as 'goog_pOGFkMgDqQIfbBBPXgCXdJJcjkT' in _layout.tsx
  // On iOS, the key is hardcoded as 'appl_YOUR_IOS_KEY_HERE' in _layout.tsx
  // This display should always match.
  if (Platform.OS === 'android') return `goog_${'*'.repeat(8)}`;
  if (Platform.OS === 'ios') return `appl_${'*'.repeat(8)}`;
  return 'web (no RC)';
};

// Get install source
const getInstallSource = async (): Promise<string> => {
  if (Platform.OS !== 'android') return 'App Store';
  
  try {
    const installer = await Application.getInstallReferrerAsync();
    if (installer === 'com.android.vending') return 'Google Play Store';
    if (installer === 'com.amazon.venezia') return 'Amazon App Store';
    if (installer) return `Sideload (${installer})`;
    return 'Unknown (sideload)';
  } catch {
    return 'Unknown';
  }
};

// Get RevenueCat App User ID
const getRevenueCatUserId = async (): Promise<string> => {
  if (Platform.OS === 'web') return 'N/A (web)';
  
  try {
    const appUserId = await Purchases.getAppUserID();
    return appUserId || 'Not initialized';
  } catch {
    return 'Error fetching';
  }
};

// Get product availability info
const getProductsInfo = (): Array<{ id: string; price: string; available: boolean }> => {
  const offerings = diagnosticsState.offerings;
  if (!offerings?.current) return [];
  
  return offerings.current.availablePackages.map(pkg => ({
    id: pkg.identifier,
    price: pkg.product.priceString,
    available: true,
  }));
};

// Full diagnostics object
export interface DiagnosticsInfo {
  // App Info
  appName: string;
  appVersion: string;
  buildNumber: string;
  versionCode: string;
  bundleId: string;
  
  // Device Info
  platform: string;
  deviceModel: string;
  deviceName: string;
  osVersion: string;
  deviceType: string;
  
  // Install Info
  installSource: string;
  installTime: string | null;
  
  // RevenueCat Info
  rcAppUserId: string;
  rcApiKeyPrefix: string;
  rcInitError: string | null;
  currentOfferingId: string | null;
  
  // Products
  products: Array<{ id: string; price: string; available: boolean }>;
  missingProducts: string[];
  
  // Last Purchase
  lastPurchaseAttempt: DiagnosticsState['lastPurchaseAttempt'];
  lastPaywallError: string | null;
  
  // Feature Flags
  featureFlags: typeof FeatureFlags;
  
  // Entitlements
  isPremium: boolean;
  activeEntitlements: string[];

  // Config Audit
  configAudit: ConfigAudit[];

  // Build fingerprint
  buildFingerprint: string;

  // Build source proof
  buildProof: string;
}

// Get full diagnostics
export const getDiagnostics = async (): Promise<DiagnosticsInfo> => {
  const installSource = await getInstallSource();
  const rcAppUserId = await getRevenueCatUserId();
  
  let installTime: string | null = null;
  try {
    const time = await Application.getInstallationTimeAsync();
    installTime = time?.toISOString() || null;
  } catch {}
  
  const products = getProductsInfo();
  
  // Get active entitlements
  const activeEntitlements = diagnosticsState.customerInfo 
    ? Object.keys(diagnosticsState.customerInfo.entitlements.active)
    : [];
  
  const isPremium = activeEntitlements.length > 0;
  
  return {
    // App Info
    appName: Application.applicationName || 'ScriptM8',
    appVersion: Application.nativeApplicationVersion || 'Unknown',
    buildNumber: Application.nativeBuildVersion || 'Unknown',
    versionCode: Platform.OS === 'android' 
      ? (Application.nativeBuildVersion || 'Unknown')
      : (Application.nativeBuildVersion || 'Unknown'),
    bundleId: Application.applicationId || 'Unknown',
    
    // Device Info
    platform: Platform.OS,
    deviceModel: Device.modelName || 'Unknown',
    deviceName: Device.deviceName || 'Unknown',
    osVersion: `${Device.osName || Platform.OS} ${Device.osVersion || 'Unknown'}`,
    deviceType: Device.deviceType ? ['Unknown', 'Phone', 'Tablet', 'Desktop', 'TV'][Device.deviceType] : 'Unknown',
    
    // Install Info
    installSource,
    installTime,
    
    // RevenueCat Info
    rcAppUserId,
    rcApiKeyPrefix: getApiKeyPrefix(),
    rcInitError: diagnosticsState.revenueCatInitError,
    currentOfferingId: diagnosticsState.offerings?.current?.identifier || null,
    
    // Products
    products,
    missingProducts: diagnosticsState.missingProducts,
    
    // Last Purchase
    lastPurchaseAttempt: diagnosticsState.lastPurchaseAttempt,
    lastPaywallError: diagnosticsState.lastPaywallError,
    
    // Feature Flags
    featureFlags: FeatureFlags,
    
    // Entitlements
    isPremium,
    activeEntitlements,

    // Config Audit
    configAudit: getConfigAudit(),

    // Build fingerprint
    buildFingerprint: BUILD_FINGERPRINT,

    // BUILD SOURCE PROOF - Verify this matches the code being edited
    buildProof: BUILD_PROOF.marker,
  };
};

// Format diagnostics as text for copying
export const formatDiagnosticsText = async (): Promise<string> => {
  const diag = await getDiagnostics();
  
  const lines = [
    '=== ScriptM8 Diagnostics ===',
    `Timestamp: ${new Date().toISOString()}`,
    `Build Fingerprint: ${BUILD_FINGERPRINT}`,
    '',
    '=== BUILD SOURCE PROOF ===',
    BUILD_PROOF.marker,
    '',
    '--- App Info ---',
    `App: ${diag.appName}`,
    `Version: ${diag.appVersion}`,
    `Build: ${diag.buildNumber}`,
    `Bundle ID: ${diag.bundleId}`,
    '',
    '--- Device Info ---',
    `Platform: ${diag.platform}`,
    `Model: ${diag.deviceModel}`,
    `OS: ${diag.osVersion}`,
    `Type: ${diag.deviceType}`,
    '',
    '--- Install Info ---',
    `Source: ${diag.installSource}`,
    `Installed: ${diag.installTime || 'Unknown'}`,
    '',
    '--- RevenueCat ---',
    `App User ID: ${diag.rcAppUserId}`,
    `API Key: ${diag.rcApiKeyPrefix}`,
    `Init Error: ${diag.rcInitError || 'None'}`,
    `Current Offering: ${diag.currentOfferingId || 'None'}`,
    '',
    '--- Products ---',
    diag.products.length > 0
      ? diag.products.map(p => `  ${p.id}: ${p.price} (${p.available ? '✓' : '✗'})`).join('\n')
      : '  No products loaded',
    diag.missingProducts.length > 0
      ? `Missing: ${diag.missingProducts.join(', ')}`
      : '',
    '',
    '--- Subscription ---',
    `Premium: ${diag.isPremium ? 'Yes' : 'No'}`,
    `Entitlements: ${diag.activeEntitlements.length > 0 ? diag.activeEntitlements.join(', ') : 'None'}`,
    '',
    '--- Last Purchase Attempt ---',
    diag.lastPurchaseAttempt
      ? [
          `  Time: ${diag.lastPurchaseAttempt.timestamp}`,
          `  Product: ${diag.lastPurchaseAttempt.productId}`,
          `  Result: ${diag.lastPurchaseAttempt.result}`,
          diag.lastPurchaseAttempt.errorCode ? `  Error Code: ${diag.lastPurchaseAttempt.errorCode}` : '',
          diag.lastPurchaseAttempt.errorMessage ? `  Error: ${diag.lastPurchaseAttempt.errorMessage}` : '',
        ].filter(Boolean).join('\n')
      : '  No purchase attempts',
    '',
    diag.lastPaywallError ? `Last Paywall Error: ${diag.lastPaywallError}` : '',
    '',
    '--- Feature Flags ---',
    `  PREMIUM_ENABLED: ${diag.featureFlags.PREMIUM_ENABLED}`,
    `  SHOW_LIFETIME: ${diag.featureFlags.SHOW_LIFETIME}`,
    `  PAYWALL_VARIANT: ${diag.featureFlags.PAYWALL_VARIANT}`,
    '',
    '--- Config Audit ---',
    ...diag.configAudit.map(c => `  ${c.key}: ${c.resolved} [source: ${c.source}] ${c.present ? '' : 'MISSING'}`),
    '',
    '=== End Diagnostics ===',
  ];
  
  return lines.filter(line => line !== undefined).join('\n');
};

// Copy diagnostics to clipboard
export const copyDiagnosticsToClipboard = async (): Promise<boolean> => {
  try {
    const text = await formatDiagnosticsText();
    await Clipboard.setStringAsync(text);
    return true;
  } catch (error) {
    console.error('Failed to copy diagnostics:', error);
    return false;
  }
};

/**
 * Format a compact ChatGPT-friendly diagnostic report.
 * Structure matches the spec: BUILD / DEVICE / TIME / NAVIGATION / OPERATION /
 * API / IMPORT / ERROR / RECENT LOG.
 *
 * Sensitive data is already redacted at capture time by DebugLog.maskSensitiveData.
 * We additionally strip any keys matching credential patterns here.
 */
const CREDENTIAL_KEY_RE = /(authorization|token|api[_-]?key|secret|password|passwd|cookie|session|bearer|purchase_?token|credential|private)/i;
function stripSensitiveDeep(value: any, depth = 0): any {
  if (depth > 4) return '[DEPTH]';
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => stripSensitiveDeep(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (CREDENTIAL_KEY_RE.test(k)) continue;
    out[k] = stripSensitiveDeep(v, depth + 1);
  }
  return out;
}

export const formatChatGPTDiagnosticReport = async (): Promise<string> => {
  // Lazy import to avoid a circular reference with debugLogService.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DebugLog } = require('./debugLogService');

  let diag: any = {};
  try { diag = await getDiagnostics(); } catch (e: any) {
    diag = { error: `getDiagnostics failed: ${e?.message}` };
  }
  const lastErrorEntry = DebugLog.getLastError ? DebugLog.getLastError() : null;
  const logs = DebugLog.getLogs ? DebugLog.getLogs() : [];

  // Find the most recent API error (if any) for HTTP status.
  const lastApi = logs.find((l: any) => l.eventType === 'API_ERROR' || l.eventType === 'API_RESPONSE');

  // Find the most recent import stage.
  const lastImportStage = logs.find((l: any) => l.source === 'ImportPipeline');

  const lastErrMeta = stripSensitiveDeep(lastErrorEntry?.metadata || {});

  const lines: string[] = [];
  lines.push('SCRIPT M8 DIAGNOSTIC REPORT');
  lines.push('===========================');
  lines.push('');
  lines.push('BUILD:');
  lines.push(`Build ID: ${diag.buildProof || 'unknown'}`);
  lines.push(`Version: ${diag.appVersion || 'unknown'}`);
  lines.push(`VersionCode: ${diag.versionCode || 'unknown'}`);
  lines.push(`Fingerprint: ${diag.buildFingerprint || BUILD_FINGERPRINT}`);
  lines.push('');
  lines.push('DEVICE:');
  lines.push(`Model: ${diag.deviceModel || 'unknown'}`);
  lines.push(`OS: ${diag.osVersion || 'unknown'}`);
  lines.push(`Runtime: react-native / expo (${diag.platform || 'unknown'})`);
  lines.push('');
  lines.push('TIME:');
  lines.push(`Timestamp: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('NAVIGATION:');
  lines.push(`Current Screen: ${DebugLog.getCurrentScreen ? DebugLog.getCurrentScreen() : 'unknown'}`);
  lines.push(`Previous Screen: ${DebugLog.getPreviousScreen ? DebugLog.getPreviousScreen() : 'unknown'}`);
  lines.push('');
  lines.push('OPERATION:');
  lines.push(`Operation: ${DebugLog.getCurrentOperation ? DebugLog.getCurrentOperation() : 'idle'}`);
  lines.push(`Last Operation: ${DebugLog.getLastOperation ? DebugLog.getLastOperation() : 'idle'}`);
  lines.push('');
  lines.push('API:');
  lines.push(`Base URL: ${API_BASE_URL}`);
  if (lastApi) {
    const m = stripSensitiveDeep(lastApi.metadata || {});
    lines.push(`Endpoint: ${m.endpoint || m.url || '(none)'}`);
    lines.push(`HTTP Status: ${m.status ?? '(none)'}`);
    if (m.errorMessage) lines.push(`Last API Error: ${m.errorMessage}`);
  } else {
    lines.push('Endpoint: (no recent API call)');
    lines.push('HTTP Status: (none)');
  }
  lines.push('');
  lines.push('IMPORT:');
  if (lastImportStage) {
    const m = stripSensitiveDeep(lastImportStage.metadata || {});
    lines.push(`File Type: ${m.fileType || 'unknown'}`);
    lines.push(`File Name: ${m.fileName || 'unknown'}`);
    lines.push(`File Size: ${m.fileSize ?? 'unknown'}`);
    lines.push(`Parser: ${m.parser || 'unknown'}`);
    lines.push(`Parser Stage: ${lastImportStage.message || 'unknown'}`);
  } else {
    lines.push('File Type: (no recent import)');
    lines.push('File Name: -');
    lines.push('File Size: -');
    lines.push('Parser: -');
    lines.push('Parser Stage: -');
  }
  lines.push('');
  lines.push('ERROR:');
  if (lastErrorEntry) {
    lines.push(`Message: ${(lastErrMeta.errorMessage || lastErrorEntry.message || '').toString().substring(0, 400)}`);
    lines.push(`Stack: ${(lastErrMeta.stack || '').toString().substring(0, 1500)}`);
    lines.push(`Unhandled Promise: ${lastErrorEntry.source === 'UNHANDLED_PROMISE_REJECTION' ? 'yes' : 'no'}`);
  } else {
    lines.push('Message: (no error captured)');
    lines.push('Stack: -');
    lines.push('Unhandled Promise: no');
  }
  lines.push('');
  lines.push('RECENT LOG:');
  // Take the last ~150 entries (newest first — buffer is already ordered newest-first).
  const recent = logs.slice(0, 150);
  recent.forEach((entry: any, idx: number) => {
    const meta = stripSensitiveDeep(entry.metadata || {});
    const metaStr = Object.keys(meta).length > 0
      ? ` ${JSON.stringify(meta).substring(0, 300)}`
      : '';
    lines.push(`${idx + 1}. [${entry.timestamp}] [${entry.eventType}] [${entry.screen}] ${entry.source}: ${entry.message}${metaStr}`);
  });
  if (recent.length === 0) lines.push('(no log entries)');

  lines.push('');
  lines.push('NATIVE CRASH:');
  lines.push('If Android showed "ScriptMate Pro closed because this app has a bug",');
  lines.push('the native-side crash details require adb logcat and are NOT visible to this JS report.');
  lines.push('The entries above capture everything the app knew immediately before the crash.');
  lines.push('');
  lines.push('=== end of report ===');

  return lines.join('\n');
};

/**
 * Copy the ChatGPT-friendly diagnostic report to the clipboard.
 */
export const copyChatGPTDiagnosticReport = async (): Promise<boolean> => {
  try {
    const text = await formatChatGPTDiagnosticReport();
    await Clipboard.setStringAsync(text);
    return true;
  } catch (error) {
    console.error('Failed to copy diagnostic report:', error);
    return false;
  }
};

/**
 * Copy just the last error + immediately preceding context.
 */
export const copyLastErrorToClipboard = async (): Promise<boolean> => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DebugLog } = require('./debugLogService');
    const last = DebugLog.getLastError ? DebugLog.getLastError() : null;
    const logs = DebugLog.getLogs ? DebugLog.getLogs() : [];

    const lines: string[] = [];
    lines.push('SCRIPT M8 — LAST ERROR');
    lines.push('======================');
    lines.push(`Timestamp: ${new Date().toISOString()}`);
    lines.push(`Screen: ${DebugLog.getCurrentScreen ? DebugLog.getCurrentScreen() : 'unknown'}`);
    lines.push(`Operation: ${DebugLog.getCurrentOperation ? DebugLog.getCurrentOperation() : 'idle'}`);
    lines.push('');
    if (last) {
      const meta = stripSensitiveDeep(last.metadata || {});
      lines.push(`Time: ${last.timestamp}`);
      lines.push(`Source: ${last.source}`);
      lines.push(`Message: ${last.message}`);
      lines.push(`Metadata: ${JSON.stringify(meta, null, 2)}`);
    } else {
      lines.push('(no error captured yet)');
    }
    lines.push('');
    lines.push('--- Preceding context (20 entries) ---');
    const preceding = logs.slice(0, 20);
    preceding.forEach((e: any, idx: number) => {
      lines.push(`${idx + 1}. [${e.timestamp}] [${e.eventType}] ${e.source}: ${e.message}`);
    });
    await Clipboard.setStringAsync(lines.join('\n'));
    return true;
  } catch (error) {
    console.error('Failed to copy last error:', error);
    return false;
  }
};

// Open email with diagnostics
export const sendDiagnosticsEmail = async (userNote?: string): Promise<void> => {
  const diag = await getDiagnostics();
  const diagnosticsText = await formatDiagnosticsText();
  
  const subject = encodeURIComponent(
    `ScriptM8 Bug Report – v${diag.appVersion} (${diag.platform})`
  );
  
  const body = encodeURIComponent(
    `Hi ScriptM8 Support,\n\n` +
    `${userNote ? `Issue: ${userNote}\n\n` : 'Please describe your issue here:\n\n\n'}` +
    `---\n\n` +
    diagnosticsText
  );
  
  const mailtoUrl = `mailto:support@scriptmate.app?subject=${subject}&body=${body}`;
  
  try {
    const canOpen = await Linking.canOpenURL(mailtoUrl);
    if (canOpen) {
      await Linking.openURL(mailtoUrl);
    } else {
      Alert.alert(
        'Email Not Available',
        'Please copy the diagnostics and email support@scriptmate.app manually.',
        [
          { text: 'Copy Diagnostics', onPress: copyDiagnosticsToClipboard },
          { text: 'OK' },
        ]
      );
    }
  } catch (error) {
    console.error('Failed to open email:', error);
    Alert.alert('Error', 'Could not open email client. Please copy diagnostics manually.');
  }
};

// Product sanity check - call on app start
export const checkProductAvailability = async (): Promise<{
  allPresent: boolean;
  missing: string[];
  available: string[];
}> => {
  const offerings = diagnosticsState.offerings;
  
  if (!offerings?.current) {
    return {
      allPresent: false,
      missing: EXPECTED_PRODUCT_IDS,
      available: [],
    };
  }
  
  const availableIds = offerings.current.availablePackages.map(p => p.identifier.toLowerCase());
  const missing: string[] = [];
  const available: string[] = [];
  
  // Check core products
  const coreProducts = ['monthly', 'yearly'];
  for (const productId of coreProducts) {
    if (availableIds.some(id => id.includes(productId) || id.includes('rc_' + (productId === 'yearly' ? 'annual' : productId)))) {
      available.push(productId);
    } else {
      missing.push(productId);
    }
  }
  
  // Check lifetime if enabled
  if (FeatureFlags.SHOW_LIFETIME) {
    if (availableIds.some(id => id.includes('lifetime'))) {
      available.push('lifetime');
    } else {
      missing.push('lifetime');
    }
  }
  
  diagnosticsState.missingProducts = missing;
  
  return {
    allPresent: missing.length === 0,
    missing,
    available,
  };
};
