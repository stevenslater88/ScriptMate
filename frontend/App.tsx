import { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, FlatList, ScrollView, SafeAreaView, StatusBar, Pressable } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";

console.log("APP STARTED");

// REHEARSE SCREEN - Full screen cinematic view with teleprompter
function RehearseScreen({ script, onBack }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [speed, setSpeed] = useState(1); // 0=Slow, 1=Medium, 2=Fast
  const [tapIndicator, setTapIndicator] = useState(null); // Y position of tap indicator
  const scrollViewRef = useRef(null);
  const scrollIntervalRef = useRef(null);
  const scrollPositionRef = useRef(0);
  const contentHeightRef = useRef(0);

  const speeds = [
    { label: "Slow", value: 0.5 },
    { label: "Med", value: 1.5 },
    { label: "Fast", value: 3 },
  ];

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

  const handlePlay = () => {
    try {
      const textToSpeak = script?.content || "";
      if (textToSpeak.length > 0) {
        setIsPlaying(true);
        Speech.speak(textToSpeak, {
          onDone: () => setIsPlaying(false),
          onStopped: () => setIsPlaying(false),
          onError: () => setIsPlaying(false),
        });
      }
    } catch (e) {
      console.log("TTS Error:", e);
      setIsPlaying(false);
    }
  };

  const handleStop = () => {
    try {
      Speech.stop();
      setIsPlaying(false);
    } catch (e) {
      console.log("Stop Error:", e);
    }
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
        setScripts(JSON.parse(data));
      }
    } catch (e) {
      console.log("Error loading scripts:", e);
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

      console.log("SCRIPT SAVED LOCALLY");
      
      setTitle("");
      setScriptText("");
      setScripts(allScripts);
      
      Alert.alert("Saved", "Saved locally");
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
