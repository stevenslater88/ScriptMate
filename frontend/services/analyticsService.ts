// Analytics Service for tracking Self Tape events
import { addBreadcrumb } from './sentryService';

// Track Self Tape opened
export const trackSelfTapeOpened = (scriptId?: string) => {
  console.log('[Analytics] self_tape_opened', { scriptId });
  addBreadcrumb('self_tape_opened', 'selftape', { scriptId });
};

// Track Recording started
export const trackRecordingStarted = (scriptId: string, sceneIndex: number) => {
  console.log('[Analytics] recording_started', { scriptId, sceneIndex });
  addBreadcrumb('recording_started', 'selftape', { scriptId, sceneIndex });
};

// Track Recording completed
export const trackRecordingCompleted = (scriptId: string, durationSeconds: number) => {
  console.log('[Analytics] recording_completed', { scriptId, durationSeconds });
  addBreadcrumb('recording_completed', 'selftape', { scriptId, durationSeconds });
};

// Track Teleprompter toggled
export const trackTeleprompterToggled = (enabled: boolean) => {
  const event = enabled ? 'teleprompter_enabled' : 'teleprompter_disabled';
  console.log(`[Analytics] ${event}`);
  addBreadcrumb(event, 'selftape', { enabled });
};

// Track Upgrade triggered from Self Tape
export const trackUpgradeTriggered = (source: string) => {
  console.log('[Analytics] paywall_shown_from_self_tape', { source });
  addBreadcrumb('paywall_shown_from_self_tape', 'selftape', { source });
};

// Track Share initiated
export const trackShareInitiated = (scriptId: string) => {
  console.log('[Analytics] share_initiated', { scriptId });
  addBreadcrumb('share_initiated', 'selftape', { scriptId });
};

// Track Share completed
export const trackShareCompleted = (scriptId: string) => {
  console.log('[Analytics] share_completed', { scriptId });
  addBreadcrumb('share_completed', 'selftape', { scriptId });
};

// Track Video saved
export const trackVideoSaved = (scriptId: string) => {
  console.log('[Analytics] save_completed', { scriptId });
  addBreadcrumb('save_completed', 'selftape', { scriptId });
};

// Track Retake started
export const trackRetakeStarted = (scriptId: string) => {
  console.log('[Analytics] retake_started', { scriptId });
  addBreadcrumb('retake_started', 'selftape', { scriptId });
};

// Track Video shared (legacy alias)
export const trackVideoShared = (scriptId: string) => {
  trackShareInitiated(scriptId);
};

// Track Watermark applied
export const trackWatermarkApplied = (success: boolean) => {
  const event = success ? 'watermark_applied_success' : 'watermark_failed';
  console.log(`[Analytics] ${event}`);
  addBreadcrumb(event, 'selftape', { success });
};
