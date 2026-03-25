import { View, Text } from "react-native";
import { registerRootComponent } from "expo";

function App() {
  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#000" }}>
      <Text style={{ color: "#fff", fontSize: 24 }}>APP IS WORKING</Text>
    </View>
  );
}

registerRootComponent(App);

export default App;
