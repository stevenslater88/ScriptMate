// Analytics Service for tracking Self Tape events
import { addBreadcrumb } from './sentryService';

// Track Self Tape opened
export const trackSelfTapeOpened = (scriptId?: string) => {
  console.log('[Analytics] Self Tape Opened', { scriptId });
  addBreadcrumb('Self Tape Opened', 'selftape', { scriptId });
};

// Track Recording started
export const trackRecordingStarted = (scriptId: string, sceneIndex: number) => {
  console.log('[Analytics] Recording Started', { scriptId, sceneIndex });
  addBreadcrumb('Recording Started', 'selftape', { scriptId, sceneIndex });
};

// Track Recording completed
export const trackRecordingCompleted = (scriptId: string, durationSeconds: number) => {
  console.log('[Analytics] Recording Completed', { scriptId, durationSeconds });
  addBreadcrumb('Recording Completed', 'selftape', { scriptId, durationSeconds });
};

// Track Teleprompter toggled
export const trackTeleprompterToggled = (enabled: boolean) => {
  console.log('[Analytics] Teleprompter Toggled', { enabled });
  addBreadcrumb('Teleprompter Toggled', 'selftape', { enabled });
};

// Track Upgrade triggered from Self Tape
export const trackUpgradeTriggered = (source: string) => {
  console.log('[Analytics] Upgrade Triggered', { source });
  addBreadcrumb('Upgrade Triggered', 'selftape', { source });
};

// Track Video saved
export const trackVideoSaved = (scriptId: string) => {
  console.log('[Analytics] Video Saved', { scriptId });
  addBreadcrumb('Video Saved', 'selftape', { scriptId });
};

// Track Video shared
export const trackVideoShared = (scriptId: string) => {
  console.log('[Analytics] Video Shared', { scriptId });
  addBreadcrumb('Video Shared', 'selftape', { scriptId });
};
