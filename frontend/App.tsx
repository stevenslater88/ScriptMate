import { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, FlatList, ScrollView, SafeAreaView, StatusBar, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";

console.log("APP STARTED");

// REHEARSE SCREEN - Full screen cinematic view with teleprompter and scene partner modes
function RehearseScreen({ script, onBack }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [speed, setSpeed] = useState(1); // 0=Slow, 1=Medium, 2=Fast
  const [tapIndicator, setTapIndicator] = useState(null); // Y position of tap indicator
  const [mode, setMode] = useState("teleprompter"); // "teleprompter" or "scene-partner"
  const [currentLine, setCurrentLine] = useState(0); // Current line in scene partner mode
  const [lines, setLines] = useState([]); // Parsed lines for scene partner
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

  // Parse script into lines on mount
  useEffect(() => {
    if (script?.content) {
      const parsed = parseScriptLines(script.content);
      setLines(parsed);
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

  // Speak a single segment and return a promise
  const speakSegment = (text) => {
    return new Promise((resolve) => {
      Speech.speak(text, {
        onDone: resolve,
        onStopped: resolve,
        onError: resolve,
      });
    });
  };

  // Delay helper
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Play with natural pauses
  const handlePlay = async () => {
    try {
      const textToSpeak = script?.content || "";
      if (textToSpeak.length === 0) return;

      setIsPlaying(true);
      speechCancelledRef.current = false;

      const segments = splitIntoSegments(textToSpeak);
      
      for (const segment of segments) {
        // Check if cancelled
        if (speechCancelledRef.current) break;
        
        // Speak segment
        await speakSegment(segment.text);
        
        // Check again after speaking
        if (speechCancelledRef.current) break;
        
        // Pause between segments
        if (segment.pause > 0) {
          await delay(segment.pause);
        }
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
      const textToSpeak = line.text || line.full;
      
      if (textToSpeak.length > 0) {
        setIsPlaying(true);
        Speech.speak(textToSpeak, {
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
    <SafeAreaView style={rehearseStyles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {/* Header */}
      <View style={rehearseStyles.header}>
        <TouchableOpacity style={rehearseStyles.backButton} onPress={handleBack}>
          <Text style={rehearseStyles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={rehearseStyles.title} numberOfLines={1}>{script.title}</Text>
        <View style={rehearseStyles.spacer} />
      </View>

      {/* Mode Toggle */}
      <View style={rehearseStyles.modeToggle}>
        <TouchableOpacity 
          style={[rehearseStyles.modeBtn, mode === "teleprompter" && rehearseStyles.modeBtnActive]}
          onPress={() => setMode("teleprompter")}
        >
          <Text style={[rehearseStyles.modeText, mode === "teleprompter" && rehearseStyles.modeTextActive]}>
            Teleprompter
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[rehearseStyles.modeBtn, mode === "scene-partner" && rehearseStyles.modeBtnActive]}
          onPress={() => { setMode("scene-partner"); resetLines(); }}
        >
          <Text style={[rehearseStyles.modeText, mode === "scene-partner" && rehearseStyles.modeTextActive]}>
            Scene Partner
          </Text>
        </TouchableOpacity>
      </View>

      {/* TELEPROMPTER MODE */}
      {mode === "teleprompter" && (
        <>
          {/* Tap hint */}
          <Text style={rehearseStyles.tapHint}>Tap anywhere to jump to that position</Text>

          {/* Script Content - Wrapped in Pressable for tap detection */}
          <Pressable style={rehearseStyles.scrollWrapper} onPress={handleTapToPosition}>
            <ScrollView 
              ref={scrollViewRef}
              style={rehearseStyles.scrollView}
              contentContainerStyle={rehearseStyles.scrollContent}
              onScroll={handleScroll}
              onContentSizeChange={handleContentSizeChange}
              scrollEventThrottle={16}
            >
              <Text style={rehearseStyles.scriptText}>{script.content}</Text>
            </ScrollView>

            {/* Tap Indicator */}
            {tapIndicator !== null && (
              <View style={[rehearseStyles.tapLine, { top: tapIndicator }]} />
            )}
          </Pressable>

      {/* Speed Selector */}
      <View style={rehearseStyles.speedRow}>
        {speeds.map((s, i) => (
          <TouchableOpacity
            key={i}
            style={[rehearseStyles.speedBtn, speed === i && rehearseStyles.speedBtnActive]}
            onPress={() => setSpeed(i)}
          >
            <Text style={[rehearseStyles.speedText, speed === i && rehearseStyles.speedTextActive]}>
              {s.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Scroll Controls */}
      <View style={rehearseStyles.scrollControls}>
        <TouchableOpacity 
          style={[rehearseStyles.scrollBtn, isScrolling && rehearseStyles.scrollBtnActive]} 
          onPress={startScroll}
        >
          <Text style={rehearseStyles.controlText}>
            {isScrolling ? "⏬ Scrolling..." : "⏬ START SCROLL"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={rehearseStyles.scrollStopBtn} onPress={stopScroll}>
          <Text style={rehearseStyles.controlText}>⏹ STOP</Text>
        </TouchableOpacity>
      </View>

      {/* Voice Controls */}
      <View style={rehearseStyles.controls}>
        <TouchableOpacity 
          style={[rehearseStyles.playBtn, isPlaying && rehearseStyles.playingBtn]} 
          onPress={handlePlay}
        >
          <Text style={rehearseStyles.controlText}>
            {isPlaying ? "🔊 Playing..." : "🔊 VOICE"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={rehearseStyles.stopBtn} onPress={handleStop}>
          <Text style={rehearseStyles.controlText}>■ STOP</Text>
        </TouchableOpacity>
      </View>
        </>
      )}

      {/* SCENE PARTNER MODE */}
      {mode === "scene-partner" && (
        <>
          {/* Line Counter */}
          <Text style={rehearseStyles.lineCounter}>
            Line {currentLine + 1} of {lines.length}
          </Text>

          {/* Current Line Display */}
          <ScrollView 
            ref={sceneScrollRef}
            style={rehearseStyles.sceneContent}
            contentContainerStyle={rehearseStyles.sceneContentInner}
          >
            {lines.map((line, index) => (
              <View 
                key={line.id} 
                style={[
                  rehearseStyles.lineItem,
                  index === currentLine && rehearseStyles.lineItemActive,
                  index < currentLine && rehearseStyles.lineItemPast,
                ]}
              >
                {line.speaker && (
                  <Text style={rehearseStyles.lineSpeaker}>{line.speaker}</Text>
                )}
                <Text style={[
                  rehearseStyles.lineText,
                  index === currentLine && rehearseStyles.lineTextActive,
                ]}>
                  {line.text || line.full}
                </Text>
              </View>
            ))}
          </ScrollView>

          {/* Scene Partner Controls */}
          <View style={rehearseStyles.sceneControls}>
            <TouchableOpacity style={rehearseStyles.prevBtn} onPress={prevLine}>
              <Text style={rehearseStyles.controlText}>← PREV</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[rehearseStyles.playLineBtn, isPlaying && rehearseStyles.playingBtn]} 
              onPress={playCurrentLine}
            >
              <Text style={rehearseStyles.controlText}>
                {isPlaying ? "🔊..." : "🔊 PLAY"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={rehearseStyles.nextBtn} onPress={nextLine}>
              <Text style={rehearseStyles.controlText}>NEXT →</Text>
            </TouchableOpacity>
          </View>

          {/* Stop / Reset */}
          <View style={rehearseStyles.sceneSecondary}>
            <TouchableOpacity style={rehearseStyles.stopBtn} onPress={handleStop}>
              <Text style={rehearseStyles.controlText}>■ STOP</Text>
            </TouchableOpacity>
            <TouchableOpacity style={rehearseStyles.resetBtn} onPress={resetLines}>
              <Text style={rehearseStyles.controlText}>↺ RESET</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const rehearseStyles = StyleSheet.create({
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
  // Mode Toggle Styles
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
  // Scene Partner Styles
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

// Script View Screen Component (KEPT FOR COMPATIBILITY)
function ScriptViewScreen({ script, onBack }) {
  const [isPlaying, setIsPlaying] = useState(false);

  const handlePlay = () => {
    console.log("PLAY PRESSED - SCRIPT OBJECT:", script);
    
    const textToSpeak = script?.content || script?.raw_text || "";
    console.log("TEXT TO SPEAK:", textToSpeak);

    if (textToSpeak.length > 0) {
      setIsPlaying(true);
      Speech.speak(textToSpeak, {
        onDone: () => setIsPlaying(false),
        onStopped: () => setIsPlaying(false),
        onError: () => setIsPlaying(false),
      });
    } else {
      console.log("ERROR: No valid text found for speech");
    }
  };

  const handleStop = () => {
    Speech.stop();
    setIsPlaying(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>{script.title || "Script"}</Text>

      <ScrollView style={styles.scriptBox}>
        <Text style={styles.scriptText}>{script.content}</Text>
      </ScrollView>

      <View style={styles.row}>
        <TouchableOpacity 
          style={[styles.playBtn, isPlaying && styles.playingBtn]} 
          onPress={handlePlay}
        >
          <Text style={styles.btnText}>{isPlaying ? "Playing..." : "▶️ Play"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
          <Text style={styles.btnText}>⏹ Stop</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.backBtn} onPress={() => { Speech.stop(); onBack(); }}>
        <Text style={styles.btnText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

// Main App Component - SINGLE SCREEN
export default function App() {
  const [title, setTitle] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [scripts, setScripts] = useState([]);
  const [screen, setScreen] = useState("home");
  const [selectedScript, setSelectedScript] = useState(null);

  // Load scripts on app start
  useEffect(() => {
    loadScripts();
  }, []);

  const loadScripts = async () => {
    try {
      const data = await AsyncStorage.getItem("scripts");
      if (data) {
        const parsed = JSON.parse(data);
        setScripts(parsed);
        console.log("LOADED SCRIPTS:", parsed.length);
      } else {
        setScripts([]);
        console.log("LOADED SCRIPTS:", 0);
      }
    } catch (e) {
      console.log("Error loading scripts:", e);
      setScripts([]);
    }
  };

  const saveScript = async () => {
    if (!title.trim() || !scriptText.trim()) {
      Alert.alert("Error", "Please enter both title and script text");
      return;
    }

    try {
      const newScript = {
        id: Date.now().toString(),
        title: title.trim(),
        content: scriptText.trim(),
        createdAt: new Date().toISOString(),
      };

      const existing = await AsyncStorage.getItem("scripts");
      const allScripts = existing ? JSON.parse(existing) : [];
      allScripts.unshift(newScript);
      await AsyncStorage.setItem("scripts", JSON.stringify(allScripts));

      console.log("SAVE SUCCESS");
      console.log("SCRIPT SAVED LOCALLY");
      
      setTitle("");
      setScriptText("");
      setScripts(allScripts);
      
      Alert.alert("Saved", "Script saved");
    } catch (e) {
      console.log("Error saving script:", e);
      Alert.alert("Error", "Failed to save");
    }
  };

  const viewScript = (script) => {
    setSelectedScript(script);
    setScreen("rehearse");
  };

  // Rehearse Screen (Full Screen Mode)
  if (screen === "rehearse" && selectedScript) {
    return (
      <RehearseScreen 
        script={selectedScript} 
        onBack={() => setScreen("home")} 
      />
    );
  }

  // Script View Screen (kept for compatibility)
  if (screen === "view" && selectedScript) {
    return (
      <ScriptViewScreen 
        script={selectedScript} 
        onBack={() => setScreen("home")} 
      />
    );
  }

  // Main Home Screen
  return (
    <View style={styles.container}>
      <Text style={styles.screenTitle}>ScriptMate</Text>

      <TextInput
        style={styles.input}
        placeholder="Script Title"
        placeholderTextColor="#666"
        value={title}
        onChangeText={setTitle}
      />

      <TextInput
        style={styles.textArea}
        placeholder="Paste your script here..."
        placeholderTextColor="#666"
        value={scriptText}
        onChangeText={setScriptText}
        multiline
        textAlignVertical="top"
      />

      <TouchableOpacity style={styles.saveBtn} onPress={saveScript}>
        <Text style={styles.btnText}>SAVE</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Saved Scripts</Text>

      {scripts.length === 0 ? (
        <Text style={styles.emptyText}>No scripts saved yet</Text>
      ) : (
        <FlatList
          data={scripts}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.listItem} onPress={() => viewScript(item)}>
              <Text style={styles.itemTitle}>{item.title}</Text>
              <Text style={styles.itemPreview} numberOfLines={1}>
                {item.content.substring(0, 50)}...
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: 60,
    backgroundColor: "#000",
  },
  screenTitle: {
    color: "#fff",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    backgroundColor: "#111",
    color: "#fff",
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
    marginBottom: 10,
  },
  textArea: {
    backgroundColor: "#111",
    color: "#fff",
    padding: 15,
    borderRadius: 8,
    fontSize: 16,
    height: 120,
    marginBottom: 15,
  },
  saveBtn: {
    backgroundColor: "#4a90d9",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 25,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  sectionTitle: {
    color: "#888",
    fontSize: 14,
    marginBottom: 10,
  },
  emptyText: {
    color: "#555",
    textAlign: "center",
    marginTop: 20,
  },
  list: {
    flex: 1,
  },
  listItem: {
    backgroundColor: "#111",
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  itemTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  itemPreview: {
    color: "#888",
    fontSize: 14,
    marginTop: 5,
  },
  scriptBox: {
    flex: 1,
    backgroundColor: "#111",
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
  },
  scriptText: {
    color: "#fff",
    fontSize: 16,
    lineHeight: 24,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  playBtn: {
    flex: 1,
    backgroundColor: "#4a90d9",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  playingBtn: {
    backgroundColor: "#2a6a99",
  },
  stopBtn: {
    flex: 1,
    backgroundColor: "#d94a4a",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
  backBtn: {
    backgroundColor: "#333",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
  },
});
