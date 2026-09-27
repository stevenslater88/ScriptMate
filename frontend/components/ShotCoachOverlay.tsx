// Shot Coach - Framing Grid Overlay Component
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ShotCoachOverlayProps {
  showGrid: boolean;
  showEyeLine: boolean;
  showHeadroom: boolean;
  cameraHeight: number;
}

export default function ShotCoachOverlay({
  showGrid,
  showEyeLine,
  showHeadroom,
  cameraHeight,
}: ShotCoachOverlayProps) {
  if (!showGrid && !showEyeLine && !showHeadroom) {
    return null;
  }

  return (
    <View style={[styles.container, { height: cameraHeight }]} pointerEvents="none">
      {/* Rule of Thirds Grid */}
      {showGrid && (
        <>
          {/* Vertical lines */}
          <View style={[styles.gridLine, styles.verticalLine, { left: '33.33%' }]} />
          <View style={[styles.gridLine, styles.verticalLine, { left: '66.66%' }]} />
          {/* Horizontal lines */}
          <View style={[styles.gridLine, styles.horizontalLine, { top: '33.33%' }]} />
          <View style={[styles.gridLine, styles.horizontalLine, { top: '66.66%' }]} />
        </>
      )}

      {/* Eye-line Marker - Upper third intersection */}
      {showEyeLine && (
        <>
          <View style={styles.eyeLineZone}>
            <View style={styles.eyeLineDashed} />
            <Text style={styles.eyeLineLabel}>Eye Line</Text>
          </View>
          {/* Eye position markers */}
          <View style={[styles.eyeMarker, { left: '30%', top: '30%' }]} />
          <View style={[styles.eyeMarker, { right: '30%', top: '30%' }]} />
        </>
      )}

      {/* Headroom Boundary - Top 15% */}
      {showHeadroom && (
        <>
          <View style={styles.headroomZone}>
            <View style={styles.headroomLine} />
            <Text style={styles.headroomLabel}>Headroom</Text>
          </View>
          {/* Safe zone indicator */}
          <View style={styles.safeZoneTop} />
        </>
      )}

      {/* Center Face Guide */}
      {(showGrid || showEyeLine) && (
        <View style={styles.centerGuide}>
          <View style={styles.centerOval} />
        </View>
      )}

      {/* Frame corners for mid-shot reference */}
      {showGrid && (
        <>
          <View style={[styles.frameCorner, styles.topLeft]} />
          <View style={[styles.frameCorner, styles.topRight]} />
          <View style={[styles.frameCorner, styles.bottomLeft]} />
          <View style={[styles.frameCorner, styles.bottomRight]} />
        </>
      )}
    </View>
  );
}

// Framing Score Calculator (for Director Mode feedback)
export interface FramingFeedback {
  score: number;
  castingReady: boolean;
  feedback: string[];
  tips: string[];
}

export const calculateFramingScore = (
  // In a real implementation, these would come from face detection
  // For MVP, we'll provide a manual scoring interface
  manualScores: {
    eyeLineCorrect: boolean;
    headroomGood: boolean;
    centered: boolean;
    notToClose: boolean;
    notTooFar: boolean;
  }
): FramingFeedback => {
  let score = 0;
  const feedback: string[] = [];
  const tips: string[] = [];

  if (manualScores.eyeLineCorrect) {
    score += 25;
    feedback.push('Eye line positioned well');
  } else {
    tips.push('Position eyes at upper third line');
  }

  if (manualScores.headroomGood) {
    score += 20;
    feedback.push('Good headroom');
  } else {
    tips.push('Adjust headroom - not too much or too little');
  }

  if (manualScores.centered) {
    score += 20;
    feedback.push('Well centered in frame');
  } else {
    tips.push('Center yourself in the frame');
  }

  if (manualScores.notToClose) {
    score += 17;
    feedback.push('Good distance from camera');
  } else {
    tips.push('Move back slightly - too close to camera');
  }

  if (manualScores.notTooFar) {
    score += 18;
    feedback.push('Frame filled appropriately');
  } else {
    tips.push('Move closer - you appear too small in frame');
  }

  return {
    score,
    castingReady: score >= 85,
    feedback,
    tips,
  };
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  
  // Grid lines
  gridLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  verticalLine: {
    width: 1,
    height: '100%',
  },
  horizontalLine: {
    height: 1,
    width: '100%',
  },

  // Eye-line
  eyeLineZone: {
    position: 'absolute',
    top: '28%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  eyeLineDashed: {
    width: '80%',
    height: 2,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.6)',
  },
  eyeLineLabel: {
    fontSize: 10,
    color: 'rgba(99, 102, 241, 0.8)',
    marginTop: 4,
    fontWeight: '600',
  },
  eyeMarker: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(99, 102, 241, 0.5)',
  },

  // Headroom
  headroomZone: {
    position: 'absolute',
    top: '12%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  headroomLine: {
    width: '60%',
    height: 2,
    backgroundColor: 'rgba(245, 158, 11, 0.5)',
  },
  headroomLabel: {
    fontSize: 10,
    color: 'rgba(245, 158, 11, 0.8)',
    marginTop: 4,
    fontWeight: '600',
  },
  safeZoneTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '10%',
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.2)',
  },

  // Center guide
  centerGuide: {
    position: 'absolute',
    top: '20%',
    left: '25%',
    right: '25%',
    height: '50%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerOval: {
    width: '100%',
    height: '80%',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 1000,
  },

  // Frame corners
  frameCorner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: 'rgba(16, 185, 129, 0.5)',
  },
  topLeft: {
    top: '15%',
    left: '10%',
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  topRight: {
    top: '15%',
    right: '10%',
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  bottomLeft: {
    bottom: '15%',
    left: '10%',
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  bottomRight: {
    bottom: '15%',
    right: '10%',
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
});
