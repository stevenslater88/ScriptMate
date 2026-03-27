import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function App() {
  const [text, setText] = useState("");

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
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
  },
});
