import { Stack } from 'expo-router';

export default function SelftapeLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="prep" />
      <Stack.Screen name="record" />
      <Stack.Screen name="library" />
      <Stack.Screen name="review" />
    </Stack>
  );
}
