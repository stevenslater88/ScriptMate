/**
 * FORENSIC DEBUG LOG SERVICE
 * 
 * Purpose: Capture detailed execution traces for real-device debugging
 * without wasting paid builds on guesswork.
 * 
 * Features:
 * - Capped ring buffer (max 300 entries)
 * - Structured log entries with timestamps
 * - API request/response tracking
 * - User action tracing
 * - Persistence via AsyncStorage (survives app restart)
 * - Safe masking of secrets
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { BUILD_PROOF } from './diagnosticsService';

// ─── TYPES ─────────────────────────────────────────────────────────────────

export type DebugEventType =
  | 'APP_START'
  | 'SCREEN_VIEW'
  | 'BUTTON_PRESS'
  | 'FUNCTION_START'
  | 'FUNCTION_SUCCESS'
  | 'FUNCTION_ERROR'
  | 'API_REQUEST'
  | 'API_RESPONSE'
  | 'API_ERROR'
  | 'STORE_UPDATE'
  | 'ALERT_SHOWN'
  | 'PURCHASE_EVENT'
  | 'NAVIGATION'
  | 'DIAGNOSTIC';

export interface DebugLogEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  buildNumber: string;
  branch: string;
  commit: string;
  screen: string;
  eventType: DebugEventType;
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ApiLogMetadata {
  requestId: string;
  method: string;
  baseUrl: string;
  endpoint: string;
  fullUrl: string;
  requestStartTime: string;
  responseTime?: string;
  status?: number | string;
  statusText?: string;
  responseBodySummary?: string;
  errorMessage?: string;
  durationMs?: number;
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const MAX_LOG_ENTRIES = 300;
const STORAGE_KEY = 'SM8_DEBUG_LOG';
const SESSION_ID = generateSessionId();

function generateSessionId(): string {
  return `S${Date.now().toString(36).toUpperCase()}`;
}

function generateRequestId(): string {
  return `R${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`.toUpperCase();
}

// ─── LOG BUFFER ────────────────────────────────────────────────────────────

let logBuffer: DebugLogEntry[] = [];
let currentScreen = 'unknown';
let previousScreen = 'unknown';
let currentOperation = 'idle';
let lastOperation = 'idle';
let lastError: DebugLogEntry | null = null;
let isInitialized = false;

// ─── MASKING HELPERS ───────────────────────────────────────────────────────

const SENSITIVE_KEYS = [
  'password', 'token', 'secret', 'key', 'auth', 'bearer',
  'api_key', 'apiKey', 'purchase_token', 'purchaseToken',
  'credential', 'private', 'session'
];

function maskSensitiveData(obj: unknown, depth = 0): unknown {
  if (depth > 3) return '[DEPTH_LIMIT]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (obj.length > 200) return obj.substring(0, 200) + '...[TRUNCATED]';
    return obj;
  }
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    if (obj.length > 10) return `[Array(${obj.length}) TRUNCATED]`;
    return obj.map(item => maskSensitiveData(item, depth + 1));
  }
  
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some(sk => lowerKey.includes(sk))) {
      masked[key] = '[MASKED]';
    } else if (typeof value === 'string' && value.length > 200) {
      masked[key] = value.substring(0, 200) + '...[TRUNCATED]';
    } else if (typeof value === 'object' && value !== null) {
      masked[key] = maskSensitiveData(value, depth + 1);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// ─── CORE LOGGING ──────────────────────────────────────────────────────────

function createLogEntry(
  eventType: DebugEventType,
  source: string,
  message: string,
  metadata?: Record<string, unknown>
): DebugLogEntry {
  return {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    timestamp: new Date().toISOString(),
    sessionId: SESSION_ID,
    buildNumber: String(BUILD_PROOF.build),
    branch: BUILD_PROOF.branch,
    commit: BUILD_PROOF.commit,
    screen: currentScreen,
    eventType,
    source,
    message,
    metadata: metadata ? (maskSensitiveData(metadata) as Record<string, unknown>) : undefined,
  };
}

function addLog(entry: DebugLogEntry): void {
  logBuffer.unshift(entry); // newest first
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer = logBuffer.slice(0, MAX_LOG_ENTRIES);
  }
  // Async persist (fire and forget)
  persistLogs();
}

// ─── PERSISTENCE ───────────────────────────────────────────────────────────

const LAST_ERROR_KEY = 'SM8_LAST_ERROR';

async function persistLogs(): Promise<void> {
  try {
    // Only persist last 100 for storage efficiency
    const toStore = logBuffer.slice(0, 100);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) {
    // Silent fail - don't break app for logging
  }
}

async function persistLastError(entry: DebugLogEntry | null): Promise<void> {
  try {
    if (entry) {
      await AsyncStorage.setItem(LAST_ERROR_KEY, JSON.stringify(entry));
    } else {
      await AsyncStorage.removeItem(LAST_ERROR_KEY);
    }
  } catch (e) {
    // Silent fail
  }
}

async function loadPersistedLogs(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as DebugLogEntry[];
      // Mark persisted logs and merge
      const marked = parsed.map(log => ({
        ...log,
        message: log.sessionId !== SESSION_ID ? `[PREV_SESSION] ${log.message}` : log.message,
      }));
      logBuffer = [...logBuffer, ...marked].slice(0, MAX_LOG_ENTRIES);
    }
    // Restore last error too — survives app restart/crash so the diagnostic
    // report still contains the error that caused the crash.
    try {
      const lastErrStr = await AsyncStorage.getItem(LAST_ERROR_KEY);
      if (lastErrStr) {
        lastError = JSON.parse(lastErrStr) as DebugLogEntry;
      }
    } catch { /* ignore */ }
    isInitialized = true;
  } catch (e) {
    isInitialized = true;
  }
}

// ─── PUBLIC API ────────────────────────────────────────────────────────────

export const DebugLog = {
  /**
   * Initialize the debug log system. Call once at app start.
   */
  async init(): Promise<void> {
    if (isInitialized) return;
    await loadPersistedLogs();
    this.log('APP_START', 'DebugLogService', 'Debug log initialized', {
      sessionId: SESSION_ID,
      buildProof: BUILD_PROOF.marker,
    });
  },

  /**
   * Set current screen name for context
   */
  setScreen(screenName: string): void {
    const prev = currentScreen;
    if (prev !== screenName) {
      previousScreen = prev;
      currentScreen = screenName;
      this.log('SCREEN_VIEW', 'Navigation', `Screen: ${screenName}`, { from: prev });
    }
  },

  /**
   * Set current operation label — used by the diagnostic report to show
   * exactly what the app was doing when a failure occurred.
   */
  setOperation(op: string, details?: Record<string, unknown>): void {
    lastOperation = currentOperation;
    currentOperation = op;
    this.log('FUNCTION_START', 'Operation', `op: ${op}`, details);
  },

  clearOperation(): void {
    lastOperation = currentOperation;
    currentOperation = 'idle';
  },

  /**
   * Structured error capture — used by global error handler and try/catch sites.
   * Adds the entry to the ring buffer AND stores it as the "last error" for
   * quick copy-to-clipboard.
   */
  errorCaught(context: string, err: unknown, extra?: Record<string, unknown>): void {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? (err.stack || '').substring(0, 2000) : undefined;
    const errorName = err instanceof Error ? err.name : typeof err;
    const meta: Record<string, unknown> = {
      context,
      errorName,
      errorMessage: errorMsg,
      stack: errorStack,
      currentScreen,
      previousScreen,
      currentOperation,
      lastOperation,
      ...(extra || {}),
    };
    const entry = createLogEntry('FUNCTION_ERROR', context, `ERROR in ${context}: ${errorMsg}`, meta);
    lastError = entry;
    persistLastError(entry);
    addLog(entry);
    console.log(`[DebugLog] [ERROR_CAUGHT] [${context}] ${errorMsg}`);
  },

  /**
   * Log a stage of a file-import / parser pipeline.
   * Every TXT/PDF/DOCX import step should log a stage so the diagnostic
   * report shows exactly where the pipeline stopped.
   */
  importStage(
    stage: string,
    details?: Record<string, unknown>
  ): void {
    this.log('DIAGNOSTIC', 'ImportPipeline', `stage: ${stage}`, details);
  },

  /**
   * Log an HTTP error with full response snapshot (status, body preview).
   */
  httpErrorSnapshot(
    method: string,
    url: string,
    status: number | string,
    responseBody: unknown,
    errorMessage: string,
  ): void {
    let bodyPreview = '';
    try {
      bodyPreview = typeof responseBody === 'string'
        ? responseBody.substring(0, 500)
        : JSON.stringify(responseBody).substring(0, 500);
    } catch { bodyPreview = '[unserializable]'; }
    const entry = createLogEntry('API_ERROR', 'HttpErrorSnapshot',
      `${method} ${url} -> ${status}`,
      { method, url, status, errorMessage, responseBody: bodyPreview, currentScreen, currentOperation }
    );
    lastError = entry;
    persistLastError(entry);
    addLog(entry);
  },

  /**
   * Getters for the diagnostic report.
   */
  getCurrentScreen(): string { return currentScreen; },
  getPreviousScreen(): string { return previousScreen; },
  getCurrentOperation(): string { return currentOperation; },
  getLastOperation(): string { return lastOperation; },
  getLastError(): DebugLogEntry | null { return lastError; },

  /**
   * Core log function
   */
  log(
    eventType: DebugEventType,
    source: string,
    message: string,
    metadata?: Record<string, unknown>
  ): void {
    const entry = createLogEntry(eventType, source, message, metadata);
    addLog(entry);
    // Also console.log for logcat
    console.log(`[DebugLog] [${eventType}] [${source}] ${message}`);
  },

  /**
   * Log button press
   */
  buttonPress(buttonId: string, screen?: string): void {
    if (screen) currentScreen = screen;
    this.log('BUTTON_PRESS', currentScreen, `Button pressed: ${buttonId}`, { buttonId });
  },

  /**
   * Log function start
   */
  functionStart(funcName: string, params?: Record<string, unknown>): void {
    this.log('FUNCTION_START', funcName, `${funcName} started`, params);
  },

  /**
   * Log function success
   */
  functionSuccess(funcName: string, result?: Record<string, unknown>): void {
    this.log('FUNCTION_SUCCESS', funcName, `${funcName} succeeded`, result);
  },

  /**
   * Log function error
   */
  functionError(funcName: string, error: unknown): void {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack?.substring(0, 300) : undefined;
    const entry = createLogEntry('FUNCTION_ERROR', funcName, `${funcName} failed: ${errorMsg}`, {
      error: errorMsg,
      stack: errorStack,
      currentScreen,
      previousScreen,
      currentOperation,
    });
    lastError = entry;
    persistLastError(entry);
    addLog(entry);
    console.log(`[DebugLog] [FUNCTION_ERROR] [${funcName}] ${errorMsg}`);
  },

  /**
   * Log API request start - returns requestId for pairing with response
   */
  apiRequest(
    method: string,
    baseUrl: string,
    endpoint: string,
    bodyPreview?: string
  ): string {
    const requestId = generateRequestId();
    const fullUrl = `${baseUrl}${endpoint}`;
    this.log('API_REQUEST', 'ApiClient', `${method} ${endpoint}`, {
      requestId,
      method,
      baseUrl,
      endpoint,
      fullUrl,
      requestStartTime: new Date().toISOString(),
      bodyPreview: bodyPreview?.substring(0, 100),
    } as ApiLogMetadata);
    return requestId;
  },

  /**
   * Log API response
   */
  apiResponse(
    requestId: string,
    method: string,
    endpoint: string,
    status: number | string,
    durationMs: number,
    responseSummary?: string
  ): void {
    this.log('API_RESPONSE', 'ApiClient', `${method} ${endpoint} -> ${status} (${durationMs}ms)`, {
      requestId,
      method,
      endpoint,
      status,
      durationMs,
      responseTime: new Date().toISOString(),
      responseBodySummary: responseSummary?.substring(0, 200),
    } as Partial<ApiLogMetadata>);
  },

  /**
   * Log API error
   */
  apiError(
    requestId: string,
    method: string,
    endpoint: string,
    status: number | string,
    errorMessage: string,
    durationMs: number
  ): void {
    this.log('API_ERROR', 'ApiClient', `${method} ${endpoint} FAILED: ${status} - ${errorMessage}`, {
      requestId,
      method,
      endpoint,
      status,
      errorMessage,
      durationMs,
      responseTime: new Date().toISOString(),
    } as Partial<ApiLogMetadata>);
  },

  /**
   * Log alert shown to user
   */
  alertShown(title: string, message: string): void {
    this.log('ALERT_SHOWN', currentScreen, `Alert: ${title}`, { title, message });
  },

  /**
   * Log store state update
   */
  storeUpdate(storeName: string, action: string, details?: Record<string, unknown>): void {
    this.log('STORE_UPDATE', storeName, action, details);
  },

  /**
   * Log navigation event
   */
  navigation(from: string, to: string, params?: Record<string, unknown>): void {
    this.log('NAVIGATION', 'Router', `${from} -> ${to}`, params);
  },

  /**
   * Log purchase event
   */
  purchaseEvent(action: string, details?: Record<string, unknown>): void {
    this.log('PURCHASE_EVENT', 'Purchases', action, details);
  },

  /**
   * Get all logs
   */
  getLogs(): DebugLogEntry[] {
    return [...logBuffer];
  },

  /**
   * Clear all logs
   */
  async clearLogs(): Promise<void> {
    logBuffer = [];
    lastError = null;
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem(LAST_ERROR_KEY);
    this.log('DIAGNOSTIC', 'DebugLogService', 'Logs cleared');
  },

  /**
   * Export logs as formatted text
   */
  exportAsText(): string {
    const lines = [
      '=== SCRIPTM8 FORENSIC DEBUG LOG ===',
      `Exported: ${new Date().toISOString()}`,
      `Session: ${SESSION_ID}`,
      `Build: ${BUILD_PROOF.build}`,
      `Branch: ${BUILD_PROOF.branch}`,
      `Commit: ${BUILD_PROOF.commit}`,
      `Total entries: ${logBuffer.length}`,
      '',
      '--- LOG ENTRIES (newest first) ---',
      '',
    ];

    for (const entry of logBuffer) {
      lines.push(`[${entry.timestamp}] [${entry.eventType}]`);
      lines.push(`  Screen: ${entry.screen}`);
      lines.push(`  Source: ${entry.source}`);
      lines.push(`  Message: ${entry.message}`);
      if (entry.metadata) {
        lines.push(`  Metadata: ${JSON.stringify(entry.metadata, null, 2).split('\n').join('\n    ')}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  },

  /**
   * Get session ID
   */
  getSessionId(): string {
    return SESSION_ID;
  },
};

// Auto-init on import
DebugLog.init().catch(() => {});

export default DebugLog;
