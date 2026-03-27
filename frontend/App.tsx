import { useState, useEffect } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, FlatList } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// My Scripts Screen Component
function MyScriptsScreen({ onBack }) {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);

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
    setLoading(false);
  };

  const handleScriptTap = (script) => {
    console.log("Script tapped:", script);
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Loading...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Scripts</Text>

      {scripts.length === 0 ? (
        <Text style={styles.emptyText}>No scripts yet</Text>
      ) : (
        <FlatList
          data={scripts}
          keyExtractor={(item) => item.id}
          style={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.scriptItem} onPress={() => handleScriptTap(item)}>
              <Text style={styles.scriptText} numberOfLines={2}>
                {item.content.substring(0, 100)}
              </Text>
              <Text style={styles.scriptDate}>
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.buttonText}>Back</Text>
      </TouchableOpacity>
    </View>
  );
}

// Main App Component
export default function App() {
  const [text, setText] = useState("");
  const [screen, setScreen] = useState("home");

  console.log("APP STARTED");

  const saveScript = async () => {
    if (!text.trim()) {
      Alert.alert("Error", "Please enter some text");
      return;
    }

    const script = {
      id: Date.now().toString(),
      content: text.trim(),
      createdAt: new Date().toISOString(),
    };

    const existing = await AsyncStorage.getItem("scripts");
    const scripts = existing ? JSON.parse(existing) : [];
    scripts.push(script);
    await AsyncStorage.setItem("scripts", JSON.stringify(scripts));

    console.log("SCRIPT SAVED LOCALLY");
    Alert.alert("Saved", "Script saved locally!");
    setText("");
  };

  // Show My Scripts screen
  if (screen === "my-scripts") {
    return <MyScriptsScreen onBack={() => setScreen("home")} />;
  }

  // Home screen
  return (
    <View style={styles.container}>
      <Text style={styles.title}>APP IS WORKING</Text>
      
      <TextInput
        style={styles.input}
        placeholder="Paste script here..."
        placeholderTextColor="#666"
        value={text}
        onChangeText={setText}
        multiline
      />

      <TouchableOpacity style={styles.button} onPress={saveScript}>
        <Text style={styles.buttonText}>Save</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen("my-scripts")}>
        <Text style={styles.buttonText}>My Scripts</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#000",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    marginBottom: 20,
  },
  input: {
    width: "100%",
    height: 150,
    backgroundColor: "#111",
    color: "#fff",
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  button: {
    backgroundColor: "#4a90d9",
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 8,
    marginBottom: 10,
  },
  secondaryButton: {
    backgroundColor: "#333",
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 8,
  },
  backButton: {
    backgroundColor: "#333",
    paddingVertical: 15,
    paddingHorizontal: 40,
    borderRadius: 8,
    marginTop: 20,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
  },
  emptyText: {
    color: "#666",
    fontSize: 16,
  },
  list: {
    width: "100%",
    flex: 1,
  },
  scriptItem: {
    backgroundColor: "#111",
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
  },
  scriptText: {
    color: "#fff",
    fontSize: 14,
  },
  scriptDate: {
    color: "#666",
    fontSize: 12,
    marginTop: 5,
  },
});
