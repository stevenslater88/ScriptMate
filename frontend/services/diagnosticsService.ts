import { Platform, Alert } from 'react-native';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import Purchases, { PurchasesOfferings, CustomerInfo } from 'react-native-purchases';
import { getConfigAudit, ConfigAudit } from './appConfig';

// Build fingerprint — imported from _layout.tsx would create a circular dependency,
// so we duplicate the exact same value here.
export const BUILD_FINGERPRINT = 'SM8-FIX-0315A';

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
