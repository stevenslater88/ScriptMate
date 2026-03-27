import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, FlatList, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";

console.log("APP STARTED");

// Script View Screen Component
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
    setScreen("view");
  };

  // Script View Screen
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
