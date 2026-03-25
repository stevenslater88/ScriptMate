import React from 'react';
import { Stack } from 'expo-router';
import { View, StyleSheet } from 'react-native';

console.log('APP STARTED');
console.log('BUILD ID: SM8-MINIMAL-CORE');

export default function RootLayout() {
  return (
    <View style={styles.container}>
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: '#000000' },
          headerTintColor: '#fff',
          contentStyle: { backgroundColor: '#000000' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'ScriptM8' }} />
        <Stack.Screen name="upload" options={{ title: 'Upload Script' }} />
        <Stack.Screen name="scripts" options={{ title: 'My Scripts' }} />
        <Stack.Screen name="player" options={{ title: 'Script Player' }} />
      </Stack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
