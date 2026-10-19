// Build Information panel with a Copy Diagnostics action (copies exactly the displayed rows).
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { C, RADIUS, TYPE } from '../constants/cinematicTheme';
import { getBuildInfo, formatBuildInfo, UNAVAILABLE } from '../services/buildInfo';

export const BuildInfoPanel = () => {
  const rows = useMemo(getBuildInfo, []);
  const [status, setStatus] = useState<'idle' | 'ok' | 'error'>('idle');

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(formatBuildInfo(rows));
      setStatus('ok');
      Alert.alert('Copied', 'Build information copied to clipboard.');
    } catch {
      setStatus('error');
      Alert.alert('Copy Failed', 'Could not copy build information.');
    }
  };

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} testID="support-build-scroll">
      <Text style={s.title}>Build Information</Text>
      <Text style={s.helper}>Read from the installed app. Values that cannot be determined show as Unavailable.</Text>
      <View style={s.card}>
        {rows.map((r, i) => (
          <View key={r.key} style={[s.row, i > 0 && s.rowBorder]} testID={`build-info-row-${r.key}`}>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{r.label}</Text>
              {r.note ? <Text style={s.note}>{r.note}</Text> : null}
            </View>
            <Text style={[s.value, r.value === UNAVAILABLE && s.valueMuted]} testID={`build-info-value-${r.key}`} selectable>{r.value}</Text>
          </View>
        ))}
      </View>
      <TouchableOpacity style={s.btn} onPress={copy} testID="copy-build-diagnostics-btn" accessibilityRole="button">
        <Ionicons name="copy-outline" size={18} color="#fff" />
        <Text style={s.btnText}>Copy Diagnostics</Text>
      </TouchableOpacity>
      {status !== 'idle' ? (
        <Text style={[s.status, status === 'error' && { color: C.danger }]} testID="copy-build-diagnostics-status">
          {status === 'ok' ? 'Copied to clipboard' : 'Copy failed. Please try again.'}
        </Text>
      ) : null}
      <Text style={s.privacy}>Copies only the values shown above. It never includes account details, tokens or keys.</Text>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 18, paddingBottom: 48 },
  title: { ...TYPE.display, marginBottom: 6 },
  helper: { fontSize: 13, color: C.muted, lineHeight: 19, marginBottom: 16 },
  card: { backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.line, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  rowBorder: { borderTopWidth: 1, borderTopColor: C.line },
  label: { fontSize: 14, fontWeight: '700', color: C.text },
  note: { fontSize: 11, color: C.dim, marginTop: 2, lineHeight: 15 },
  value: { fontSize: 14, fontWeight: '700', color: C.violetSoft, maxWidth: '50%', textAlign: 'right' },
  valueMuted: { color: C.dim, fontWeight: '600' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingVertical: 15, borderRadius: RADIUS.md, backgroundColor: C.violet },
  btnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  status: { marginTop: 10, textAlign: 'center', fontSize: 13, fontWeight: '600', color: C.success },
  privacy: { fontSize: 11, color: C.dim, textAlign: 'center', marginTop: 14, lineHeight: 16 },
});
