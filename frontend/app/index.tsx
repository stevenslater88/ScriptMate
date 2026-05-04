import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { router } from 'expo-router';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>ScriptMate</Text>

      <Text style={styles.tagline}>
        Train. Rehearse. Perform.
      </Text>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={() => router.push('/scripts')}
      >
        <Text style={styles.primaryText}>View Scripts</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => router.push('/upload')}
      >
        <Text style={styles.secondaryText}>Add New Script</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logo: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 10,
  },
  tagline: {
    color: '#888',
    fontSize: 14,
    marginBottom: 40,
  },
  primaryButton: {
    backgroundColor: '#6366f1',
    padding: 18,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#6366f1',
    padding: 16,
    borderRadius: 14,
    width: '100%',
    alignItems: 'center',
  },
  secondaryText: {
    color: '#6366f1',
    fontSize: 15,
    fontWeight: '600',
  },
});