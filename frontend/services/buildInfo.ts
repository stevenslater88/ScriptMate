// Build information read at runtime from the installed binary and bundled config. Never hardcoded.
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';

export const UNAVAILABLE = 'Unavailable';

export interface BuildInfoRow {
  key: string;
  label: string;
  value: string;
  note?: string;
}

const val = (v: unknown): string => (v === null || v === undefined || v === '' ? UNAVAILABLE : String(v));

export const getBuildInfo = (): BuildInfoRow[] => {
  const isAndroid = Platform.OS === 'android';
  const cfg = Constants.expoConfig;
  return [
    { key: 'appVersion', label: 'App version', value: val(Application.nativeApplicationVersion), note: 'Installed app' },
    {
      key: 'versionCode',
      label: 'Android version code',
      value: isAndroid ? val(Application.nativeBuildVersion) : UNAVAILABLE,
      note: isAndroid ? 'Installed binary' : 'Android only',
    },
    {
      key: 'bundledConfig',
      label: 'Bundled config version',
      value: cfg?.version ? `${cfg.version}${cfg.android?.versionCode ? ` (${cfg.android.versionCode})` : ''}` : UNAVAILABLE,
      note: 'From the app configuration in this bundle, not the installed binary',
    },
    { key: 'sourceRevision', label: 'Source commit', value: UNAVAILABLE, note: 'No source revision is embedded in builds' },
    __DEV__
      ? { key: 'jsBundle', label: 'Environment', value: 'Development (debug bundle)' }
      : { key: 'jsBundle', label: 'Environment', value: 'Release bundle', note: 'Preview and production builds cannot be told apart' },
    { key: 'platform', label: isAndroid ? 'Android API level' : 'Platform', value: Platform.OS === 'web' ? 'web' : `${Platform.OS} ${val(Platform.Version)}` },
  ];
};

export const formatBuildInfo = (rows: BuildInfoRow[]): string =>
  ['ScriptM8 Build Information', ...rows.map((r) => `${r.label}: ${r.value}${r.note ? ` (${r.note})` : ''}`)].join('\n');
