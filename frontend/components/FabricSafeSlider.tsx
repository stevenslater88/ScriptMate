/**
 * FabricSafeSlider — drop-in replacement for
 * `@react-native-community/slider` that renders entirely in JavaScript
 * (Animated.View + PanResponder) so the Fabric / New Architecture
 * bridge cannot fail during native view attach.
 *
 * Background (2026-02, physical Samsung S23 Ultra / Android 16):
 * `@react-native-community/slider@4.5.5` intermittently crashes on
 * mount under Fabric on this device — deterministic on Recall (2+
 * sliders on-mount) and intermittent on ScriptScreen (1 slider
 * on-mount + 1 modal-deferred). Root cause traced to the community
 * slider's incomplete Fabric interop in the 4.x series.
 *
 * This wrapper preserves the community slider's *exact* prop
 * signature so call sites don't have to change any behaviour:
 *
 *   • value: number
 *   • onValueChange: (value: number) => void
 *   • minimumValue, maximumValue, step
 *   • minimumTrackTintColor, maximumTrackTintColor, thumbTintColor
 *   • style
 *   • testID
 *
 * The underlying library, `@miblanchard/react-native-slider`, uses
 * `value: number | number[]` and `onValueChange: (value: number[]) =>
 * void`. This wrapper hides that shape so callers can keep their
 * `useState<number>` state and `setState` callbacks unchanged.
 *
 * No native module, no codegen, no Fabric interop — safe on every
 * arch. Same visual output as the community slider.
 */

import React, { useCallback, useMemo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Slider as MiSlider } from '@miblanchard/react-native-slider';

export interface FabricSafeSliderProps {
  value?: number;
  minimumValue?: number;
  maximumValue?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  onSlidingStart?: (value: number) => void;
  onSlidingComplete?: (value: number) => void;
  minimumTrackTintColor?: string;
  maximumTrackTintColor?: string;
  thumbTintColor?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function FabricSafeSlider(props: FabricSafeSliderProps) {
  const {
    value,
    onValueChange,
    onSlidingStart,
    onSlidingComplete,
    thumbTintColor,
    ...rest
  } = props;

  const arrayValue = useMemo<number[] | undefined>(
    () => (typeof value === 'number' ? [value] : undefined),
    [value],
  );

  const handleValueChange = useCallback(
    (v: number | number[]) => {
      if (!onValueChange) return;
      const n = Array.isArray(v) ? v[0] : v;
      onValueChange(n);
    },
    [onValueChange],
  );

  const handleSlidingStart = useCallback(
    (v: number | number[]) => {
      if (!onSlidingStart) return;
      const n = Array.isArray(v) ? v[0] : v;
      onSlidingStart(n);
    },
    [onSlidingStart],
  );

  const handleSlidingComplete = useCallback(
    (v: number | number[]) => {
      if (!onSlidingComplete) return;
      const n = Array.isArray(v) ? v[0] : v;
      onSlidingComplete(n);
    },
    [onSlidingComplete],
  );

  return (
    <MiSlider
      {...rest}
      value={arrayValue}
      onValueChange={handleValueChange}
      onSlidingStart={handleSlidingStart}
      onSlidingComplete={handleSlidingComplete}
      thumbTintColor={thumbTintColor}
    />
  );
}

export default FabricSafeSlider;
