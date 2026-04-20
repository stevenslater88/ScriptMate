import { View, Text, TextInput, Button, FlatList, Alert } from "react-native";
import { useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function App() {
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [scripts, setScripts] = useState([]);

  const loadScripts = async () => {
    const data = await AsyncStorage.getItem("scripts");
    if (data) setScripts(JSON.parse(data));
  };

  useEffect(() => {
    loadScripts();
  }, []);

  const saveScript = async () => {
    if (!title || !script) {
      Alert.alert("Missing", "Enter title and script");
      return;
    }

    const existing = await AsyncStorage.getItem("scripts");
    const currentScripts = existing ? JSON.parse(existing) : [];

    const newScript = {
      id: Date.now(),
      title,
      content: script,
    };

    const updated = [...currentScripts, newScript];

    await AsyncStorage.setItem("scripts", JSON.stringify(updated));

    // CRITICAL FIX - Update state directly
    setScripts(updated);

    setTitle("");
    setScript("");

    Alert.alert("Saved", "Script stored locally");
  };

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text>Script Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        style={{ borderWidth: 1, marginBottom: 10, padding: 10 }}
      />

      <Text>Script Text</Text>
      <TextInput
        value={script}
        onChangeText={setScript}
        multiline
        style={{ height: 120, borderWidth: 1, marginBottom: 10, padding: 10 }}
      />

      <Button title="SAVE SCRIPT" onPress={saveScript} />

      <Text style={{ marginTop: 20, fontSize: 18 }}>My Scripts</Text>

      <FlatList
        data={scripts}
        keyExtractor={(item: any) => item.id.toString()}
        renderItem={({ item }: any) => (
          <View style={{ borderWidth: 1, marginTop: 10, padding: 10 }}>
            <Text style={{ fontWeight: "bold" }}>{item.title}</Text>
            <Text numberOfLines={2}>{item.content}</Text>
          </View>
        )}
      />
    </View>
  );
}
