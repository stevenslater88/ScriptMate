import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, SafeAreaView, StatusBar, Pressable } from "react-native";
import * as Speech from "expo-speech";

// =============================================================================
// REHEARSE SCREEN COMPONENT
// =============================================================================
// Modes: Teleprompter (auto-scroll) | Scene Partner (line-by-line)
// Features: TTS playback, speed control, tap-to-position
// =============================================================================

export default function RehearseScreen({ script, onBack }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [speed, setSpeed] = useState(1); // 0=Slow, 1=Medium, 2=Fast
  const [tapIndicator, setTapIndicator] = useState(null); // Y position of tap indicator
  const [mode, setMode] = useState("teleprompter"); // "teleprompter" or "scene-partner"
  const [currentLine, setCurrentLine] = useState(0); // Current line in scene partner mode
  const [lines, setLines] = useState([]); // Parsed lines for scene partner
  const [characters, setCharacters] = useState([]); // Unique character names
  const [characterVoices, setCharacterVoices] = useState({}); // Voice per character
  const [availableVoices, setAvailableVoices] = useState([]); // System voices
  const [userCharacter, setUserCharacter] = useState(null); // Character to skip (user's role)
  const scrollViewRef = useRef(null);
  const scrollIntervalRef = useRef(null);
  const scrollPositionRef = useRef(0);
  const contentHeightRef = useRef(0);
  const sceneScrollRef = useRef(null);

  const speeds = [
    { label: "Slow", value: 0.5 },
    { label: "Med", value: 1.5 },
    { label: "Fast", value: 3 },
  ];

  // Load available voices on mount
  useEffect(() => {
    const loadVoices = async () => {
      try {
        const voices = await Speech.getAvailableVoicesAsync();
        setAvailableVoices(voices);
      } catch (e) {
        console.log("Could not load voices:", e);
      }
    };
    loadVoices();
  }, []);

  // Parse script into lines on mount
  useEffect(() => {
    if (script?.content) {
      const parsed = parseScriptLines(script.content);
      setLines(parsed);
      
      // Extract unique characters and assign voices
      const uniqueChars = [...new Set(parsed.filter(l => l.speaker).map(l => l.speaker.toUpperCase()))];
      setCharacters(uniqueChars);
      
      // Assign alternating pitch/rate to simulate different voices
      const voiceAssignments = {};
      uniqueChars.forEach((char, index) => {
        voiceAssignments[char] = {
          pitch: index % 2 === 0 ? 1.0 : 1.2,  // Alternate pitch
          rate: index % 3 === 0 ? 0.9 : (index % 3 === 1 ? 1.0 : 1.1), // Vary rate
        };
      });
      setCharacterVoices(voiceAssignments);
      
      console.log("CHARACTERS DETECTED:", uniqueChars);
    }
  }, [script]);

  // Parse script into lines (by newline or speaker format)
  const parseScriptLines = (text) => {
    // Split by newlines first
    const rawLines = text.split(/\n/).filter(line => line.trim().length > 0);
    
    return rawLines.map((line, index) => {
      // Check for speaker format (NAME: or NAME-)
      const speakerMatch = line.match(/^([A-Z][A-Z0-9\s]*)[:\-]\s*(.*)$/i);
      if (speakerMatch) {
        return {
          id: index,
          speaker: speakerMatch[1].trim(),
          text: speakerMatch[2].trim(),
          full: line.trim(),
        };
      }
      return {
        id: index,
        speaker: null,
        text: line.trim(),
        full: line.trim(),
      };
    });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
      try { Speech.stop(); } catch (e) {}
    };
  }, []);

  const startScroll = () => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
    }
    setIsScrolling(true);
    scrollIntervalRef.current = setInterval(() => {
      scrollPositionRef.current += speeds[speed].value;
      if (scrollViewRef.current) {
        scrollViewRef.current.scrollTo({
          y: scrollPositionRef.current,
          animated: false,
        });
      }
    }, 16); // ~60fps
  };

  const stopScroll = () => {
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    setIsScrolling(false);
  };

  // Handle tap to jump to position
  const handleTapToPosition = (event) => {
    const tapY = event.nativeEvent.locationY;
    const newScrollPosition = scrollPositionRef.current + tapY - 100; // Offset to center tap point
    
    // Clamp to valid range
    const clampedPosition = Math.max(0, newScrollPosition);
    
    // Update scroll position
    scrollPositionRef.current = clampedPosition;
    
    // Jump to position
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        y: clampedPosition,
        animated: true,
      });
    }

    // Show tap indicator briefly
    setTapIndicator(tapY);
    setTimeout(() => setTapIndicator(null), 300);
  };

  // Ref to track if speech should be cancelled
  const speechCancelledRef = useRef(false);

  // Split text into segments with punctuation-based pauses
  const splitIntoSegments = (text) => {
    // Split by sentence-ending punctuation, keeping the punctuation
    const segments = [];
    let current = "";
    
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      current += char;
      
      if (char === '.' || char === '?' || char === '!') {
        segments.push({ text: current.trim(), pause: char === ',' ? 250 : (char === '.' ? 500 : 700) });
        current = "";
      } else if (char === ',') {
        segments.push({ text: current.trim(), pause: 250 });
        current = "";
      }
    }
    
    // Add remaining text
    if (current.trim()) {
      segments.push({ text: current.trim(), pause: 0 });
    }
    
    return segments.filter(s => s.text.length > 0);
  };

  // Speak a single segment with optional voice settings
  const speakSegment = (text, voiceSettings = {}) => {
    return new Promise((resolve) => {
      Speech.speak(text, {
        pitch: voiceSettings.pitch || 1.0,
        rate: voiceSettings.rate || 1.0,
        onDone: resolve,
        onStopped: resolve,
        onError: resolve,
      });
    });
  };

  // Delay helper
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Play with character voices
  const handlePlay = async () => {
    console.log("PLAY PRESSED - CHARACTER MODE");
    
    try {
      if (lines.length === 0) return;

      setIsPlaying(true);
      speechCancelledRef.current = false;

      for (const line of lines) {
        // Check if cancelled
        if (speechCancelledRef.current) break;
        
        const speaker = line.speaker?.toUpperCase();
        const textToSpeak = line.text || line.full;
        
        // Skip if this is the user's character
        if (speaker && userCharacter && speaker === userCharacter.toUpperCase()) {
          console.log("SKIPPING USER CHARACTER:", speaker);
          await delay(1500); // Pause for user to read their line
          continue;
        }
        
        if (speaker) {
          console.log("PLAYING CHARACTER:", speaker);
          const voiceSettings = characterVoices[speaker] || { pitch: 1.0, rate: 1.0 };
          await speakSegment(textToSpeak, voiceSettings);
        } else {
          // Non-character line (narration)
          await speakSegment(textToSpeak, { pitch: 0.9, rate: 0.95 });
        }
        
        // Check again after speaking
        if (speechCancelledRef.current) break;
        
        // Brief pause between lines
        await delay(400);
      }

      setIsPlaying(false);
    } catch (e) {
      console.log("TTS Error:", e);
      setIsPlaying(false);
    }
  };

  const handleStop = () => {
    try {
      speechCancelledRef.current = true;
      Speech.stop();
      setIsPlaying(false);
    } catch (e) {
      console.log("Stop Error:", e);
    }
  };

  // Scene Partner Mode Functions
  const playCurrentLine = () => {
    if (lines.length === 0 || currentLine >= lines.length) return;
    
    try {
      const line = lines[currentLine];
      const speaker = line.speaker?.toUpperCase();
      const textToSpeak = line.text || line.full;
      
      // Skip if this is the user's character
      if (speaker && userCharacter && speaker === userCharacter.toUpperCase()) {
        console.log("SKIPPING USER CHARACTER:", speaker);
        return;
      }
      
      if (textToSpeak.length > 0) {
        setIsPlaying(true);
        console.log("PLAYING CHARACTER:", speaker || "NARRATOR");
        
        const voiceSettings = speaker ? (characterVoices[speaker] || { pitch: 1.0, rate: 1.0 }) : { pitch: 0.9, rate: 0.95 };
        
        Speech.speak(textToSpeak, {
          pitch: voiceSettings.pitch,
          rate: voiceSettings.rate,
          onDone: () => setIsPlaying(false),
          onStopped: () => setIsPlaying(false),
          onError: () => setIsPlaying(false),
        });
      }
    } catch (e) {
      console.log("Scene Partner TTS Error:", e);
      setIsPlaying(false);
    }
  };

  const nextLine = () => {
    try { Speech.stop(); } catch (e) {}
    setIsPlaying(false);
    
    if (currentLine < lines.length - 1) {
      setCurrentLine(prev => prev + 1);
    }
  };

  const prevLine = () => {
    try { Speech.stop(); } catch (e) {}
    setIsPlaying(false);
    
    if (currentLine > 0) {
      setCurrentLine(prev => prev - 1);
    }
  };

  const resetLines = () => {
    try { Speech.stop(); } catch (e) {}
    setIsPlaying(false);
    setCurrentLine(0);
  };

  const handleBack = () => {
    stopScroll();
    try { Speech.stop(); } catch (e) {}
    onBack();
  };

  const handleScroll = (event) => {
    scrollPositionRef.current = event.nativeEvent.contentOffset.y;
  };

  const handleContentSizeChange = (w, h) => {
    contentHeightRef.current = h;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{script.title}</Text>
        <View style={styles.spacer} />
      </View>

      {/* Mode Toggle */}
      <View style={styles.modeToggle}>
        <TouchableOpacity 
          style={[styles.modeBtn, mode === "teleprompter" && styles.modeBtnActive]}
          onPress={() => setMode("teleprompter")}
        >
          <Text style={[styles.modeText, mode === "teleprompter" && styles.modeTextActive]}>
            Teleprompter
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.modeBtn, mode === "scene-partner" && styles.modeBtnActive]}
          onPress={() => { setMode("scene-partner"); resetLines(); }}
        >
          <Text style={[styles.modeText, mode === "scene-partner" && styles.modeTextActive]}>
            Scene Partner
          </Text>
        </TouchableOpacity>
      </View>

      {/* TELEPROMPTER MODE */}
      {mode === "teleprompter" && (
        <>
          {/* Tap hint */}
          <Text style={styles.tapHint}>Tap anywhere to jump to that position</Text>

          {/* Script Content - Wrapped in Pressable for tap detection */}
          <Pressable style={styles.scrollWrapper} onPress={handleTapToPosition}>
            <ScrollView 
              ref={scrollViewRef}
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              onScroll={handleScroll}
              onContentSizeChange={handleContentSizeChange}
              scrollEventThrottle={16}
            >
              <Text style={styles.scriptText}>{script.content}</Text>
            </ScrollView>

            {/* Tap Indicator */}
            {tapIndicator !== null && (
              <View style={[styles.tapLine, { top: tapIndicator }]} />
            )}
          </Pressable>

          {/* Speed Selector */}
          <View style={styles.speedRow}>
            {speeds.map((s, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.speedBtn, speed === i && styles.speedBtnActive]}
                onPress={() => setSpeed(i)}
              >
                <Text style={[styles.speedText, speed === i && styles.speedTextActive]}>
                  {s.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Scroll Controls */}
          <View style={styles.scrollControls}>
            <TouchableOpacity 
              style={[styles.scrollBtn, isScrolling && styles.scrollBtnActive]} 
              onPress={startScroll}
            >
              <Text style={styles.controlText}>
                {isScrolling ? "⏬ Scrolling..." : "⏬ START SCROLL"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.scrollStopBtn} onPress={stopScroll}>
              <Text style={styles.controlText}>⏹ STOP</Text>
            </TouchableOpacity>
          </View>

          {/* Voice Controls */}
          <View style={styles.controls}>
            <TouchableOpacity 
              style={[styles.playBtn, isPlaying && styles.playingBtn]} 
              onPress={handlePlay}
            >
              <Text style={styles.controlText}>
                {isPlaying ? "🔊 Playing..." : "🔊 VOICE"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
              <Text style={styles.controlText}>■ STOP</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* SCENE PARTNER MODE */}
      {mode === "scene-partner" && (
        <>
          {/* Line Counter */}
          <Text style={styles.lineCounter}>
            Line {currentLine + 1} of {lines.length}
          </Text>

          {/* Current Line Display */}
          <ScrollView 
            ref={sceneScrollRef}
            style={styles.sceneContent}
            contentContainerStyle={styles.sceneContentInner}
          >
            {lines.map((line, index) => (
              <View 
                key={line.id} 
                style={[
                  styles.lineItem,
                  index === currentLine && styles.lineItemActive,
                  index < currentLine && styles.lineItemPast,
                ]}
              >
                {line.speaker && (
                  <Text style={styles.lineSpeaker}>{line.speaker}</Text>
                )}
                <Text style={[
                  styles.lineText,
                  index === currentLine && styles.lineTextActive,
                ]}>
                  {line.text || line.full}
                </Text>
              </View>
            ))}
          </ScrollView>

          {/* Scene Partner Controls */}
          <View style={styles.sceneControls}>
            <TouchableOpacity style={styles.prevBtn} onPress={prevLine}>
              <Text style={styles.controlText}>← PREV</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.playLineBtn, isPlaying && styles.playingBtn]} 
              onPress={playCurrentLine}
            >
              <Text style={styles.controlText}>
                {isPlaying ? "🔊..." : "🔊 PLAY"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.nextBtn} onPress={nextLine}>
              <Text style={styles.controlText}>NEXT →</Text>
            </TouchableOpacity>
          </View>

          {/* Stop / Reset */}
          <View style={styles.sceneSecondary}>
            <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
              <Text style={styles.controlText}>■ STOP</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.resetBtn} onPress={resetLines}>
              <Text style={styles.controlText}>↺ RESET</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  backButton: {
    paddingVertical: 5,
    paddingRight: 15,
  },
  backText: {
    color: "#4a90d9",
    fontSize: 16,
  },
  title: {
    flex: 1,
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  spacer: {
    width: 60,
  },
  tapHint: {
    color: "#555",
    fontSize: 12,
    textAlign: "center",
    paddingVertical: 5,
  },
  scrollWrapper: {
    flex: 1,
    position: "relative",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 25,
    paddingBottom: 100,
  },
  scriptText: {
    color: "#fff",
    fontSize: 22,
    lineHeight: 36,
    textAlign: "left",
  },
  tapLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: "#4a90d9",
  },
  speedRow: {
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#222",
  },
  speedBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: "#222",
  },
  speedBtnActive: {
    backgroundColor: "#4a90d9",
  },
  speedText: {
    color: "#888",
    fontSize: 14,
  },
  speedTextActive: {
    color: "#fff",
  },
  scrollControls: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 10,
  },
  scrollBtn: {
    flex: 1,
    backgroundColor: "#2a8a2a",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  scrollBtnActive: {
    backgroundColor: "#1a6a1a",
  },
  scrollStopBtn: {
    flex: 1,
    backgroundColor: "#555",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  controls: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 5,
    gap: 10,
  },
  playBtn: {
    flex: 1,
    backgroundColor: "#4a90d9",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  playingBtn: {
    backgroundColor: "#2a6a99",
  },
  stopBtn: {
    flex: 1,
    backgroundColor: "#d94a4a",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  controlText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  modeToggle: {
    flexDirection: "row",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  modeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: "#222",
  },
  modeBtnActive: {
    backgroundColor: "#4a90d9",
  },
  modeText: {
    color: "#888",
    fontSize: 14,
  },
  modeTextActive: {
    color: "#fff",
  },
  lineCounter: {
    color: "#888",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 10,
  },
  sceneContent: {
    flex: 1,
    paddingHorizontal: 20,
  },
  sceneContentInner: {
    paddingVertical: 20,
  },
  lineItem: {
    paddingVertical: 12,
    paddingHorizontal: 15,
    marginBottom: 8,
    borderRadius: 8,
    backgroundColor: "#111",
    borderLeftWidth: 3,
    borderLeftColor: "transparent",
  },
  lineItemActive: {
    backgroundColor: "#1a3a5a",
    borderLeftColor: "#4a90d9",
  },
  lineItemPast: {
    opacity: 0.5,
  },
  lineSpeaker: {
    color: "#4a90d9",
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 4,
  },
  lineText: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 26,
  },
  lineTextActive: {
    fontSize: 20,
  },
  sceneControls: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 10,
  },
  prevBtn: {
    flex: 1,
    backgroundColor: "#333",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  playLineBtn: {
    flex: 1,
    backgroundColor: "#4a90d9",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  nextBtn: {
    flex: 1,
    backgroundColor: "#2a8a2a",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  sceneSecondary: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 10,
  },
  resetBtn: {
    flex: 1,
    backgroundColor: "#555",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
});
