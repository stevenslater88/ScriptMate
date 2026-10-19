// Shared building blocks for the cinematic redesign. Visual only; no app logic.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { C, GRADIENT, RADIUS, TYPE, tint } from '../constants/cinematicTheme';

type IconName = keyof typeof Ionicons.glyphMap;

export const ScreenGlow = () => (
  <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    <LinearGradient
      colors={['rgba(124,92,255,0.22)', 'rgba(62,107,255,0.06)', 'rgba(11,10,26,0)']}
      start={{ x: 1, y: 0 }}
      end={{ x: 0.2, y: 0.45 }}
      style={StyleSheet.absoluteFill}
    />
  </View>
);

export const IconButton = ({ icon, onPress, testID, primary }: {
  icon: IconName; onPress: () => void; testID?: string; primary?: boolean;
}) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.8} testID={testID} accessibilityRole="button">
    {primary ? (
      <LinearGradient colors={GRADIENT.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.iconBtn}>
        <Ionicons name={icon} size={19} color="#fff" />
      </LinearGradient>
    ) : (
      <View style={[s.iconBtn, s.iconBtnPlain]}>
        <Ionicons name={icon} size={19} color="#CFCBF2" />
      </View>
    )}
  </TouchableOpacity>
);

export const IconWell = ({ icon, color, size = 34 }: { icon: IconName; color: string; size?: number }) => (
  <View style={[s.well, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: tint(color, 0.15) }]}>
    <Ionicons name={icon} size={size * 0.52} color={color} />
  </View>
);

export const Pill = ({ label, icon, color = C.violetSoft, style }: {
  label: string; icon?: IconName; color?: string; style?: StyleProp<ViewStyle>;
}) => (
  <View style={[s.pill, { backgroundColor: tint(color, 0.14) }, style]}>
    {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
    <Text style={[s.pillTx, { color }]}>{label}</Text>
  </View>
);

export const SectionLabel = ({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) => (
  <View style={style}><Text style={TYPE.label}>{children}</Text></View>
);

export const GradientButton = ({ label, icon, onPress, testID, style }: {
  label: string; icon?: IconName; onPress: () => void; testID?: string; style?: StyleProp<ViewStyle>;
}) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.85} testID={testID} style={style} accessibilityRole="button">
    <LinearGradient colors={GRADIENT.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.gBtn}>
      {icon ? <Ionicons name={icon} size={18} color="#fff" /> : null}
      <Text style={s.gBtnTx}>{label}</Text>
    </LinearGradient>
  </TouchableOpacity>
);

const s = StyleSheet.create({
  iconBtn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconBtnPlain: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  well: { alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADIUS.pill },
  pillTx: { fontSize: 11, fontWeight: '700' },
  gBtn: { height: 52, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  gBtnTx: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
