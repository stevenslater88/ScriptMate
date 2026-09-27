import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { isWatermarkEnabled, WATERMARK_TEXT, WATERMARK_SUBTEXT } from '../services/watermarkService';

interface Props {
  visible?: boolean;
}

export const Watermark: React.FC<Props> = ({ visible }) => {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    isWatermarkEnabled().then(setEnabled);
  }, []);

  if (visible === false || !enabled) return null;

  return (
    <View style={styles.container} pointerEvents="none" data-testid="watermark-overlay">
      <Text style={styles.mainText}>{WATERMARK_TEXT}</Text>
      <Text style={styles.subText}>{WATERMARK_SUBTEXT}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  mainText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subText: {
    fontSize: 9,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.45)',
    letterSpacing: 0.3,
    marginTop: 1,
    textShadowColor: 'rgba(0, 0, 0, 0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
