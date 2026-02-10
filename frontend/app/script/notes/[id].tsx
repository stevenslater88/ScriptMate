import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useScriptStore } from '../../../store/scriptStore';
import { useAuth } from '../../../contexts/AuthContext';
import { 
  getNotesForScript, 
  saveNote as syncSaveNote, 
  deleteNote as syncDeleteNote,
  DirectorNote as SyncDirectorNote 
} from '../../../services/syncService';

interface DirectorNote {
  id: string;
  lineIndex: number;
  note: string;
  type: 'intention' | 'emotion' | 'action' | 'beat' | 'general';
  createdAt: Date;
}

const NOTE_TYPES = [
  { id: 'intention', label: 'Intention', icon: 'bulb', color: '#f59e0b' },
  { id: 'emotion', label: 'Emotion', icon: 'heart', color: '#ef4444' },
  { id: 'action', label: 'Action', icon: 'body', color: '#10b981' },
  { id: 'beat', label: 'Beat', icon: 'musical-note', color: '#8b5cf6' },
  { id: 'general', label: 'General', icon: 'chatbubble', color: '#6366f1' },
];

export default function DirectorNotesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { currentScript, fetchScript, isPremium } = useScriptStore();
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState<DirectorNote[]>([]);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<string>('general');
  const [showNoteInput, setShowNoteInput] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (id) {
        await fetchScript(id);
        // Load saved notes from sync service (server or local)
        try {
          const savedNotes = await getNotesForScript(id);
          // Convert from sync format to local format
          const convertedNotes: DirectorNote[] = savedNotes.map(n => ({
            id: n.id,
            lineIndex: n.line_index,
            note: n.content,
            type: (n.note_type as any) || 'general',
            createdAt: new Date(n.created_at || Date.now()),
          }));
          setNotes(convertedNotes);
        } catch (error) {
          console.error('Error loading notes:', error);
        }
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (!isPremium) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Director Notes</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.premiumRequired}>
          <Ionicons name="lock-closed" size={64} color="#f59e0b" />
          <Text style={styles.premiumTitle}>Premium Feature</Text>
          <Text style={styles.premiumSubtitle}>
            Director Notes help you mark intentions, emotions, and beats throughout your script.
          </Text>
          <TouchableOpacity 
            style={styles.upgradeButton}
            onPress={() => router.push('/premium')}
          >
            <Ionicons name="star" size={20} color="#fff" />
            <Text style={styles.upgradeButtonText}>Upgrade to Premium</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const addNote = async () => {
    if (selectedLine === null || !noteText.trim() || !id) return;

    setSaving(true);
    const newNote: DirectorNote = {
      id: Date.now().toString(),
      lineIndex: selectedLine,
      note: noteText.trim(),
      type: noteType as any,
      createdAt: new Date(),
    };

    // Convert to sync format and save
    const syncNote: SyncDirectorNote = {
      id: newNote.id,
      script_id: id,
      line_index: newNote.lineIndex,
      note_type: newNote.type,
      content: newNote.note,
      color: getNoteTypeInfo(newNote.type).color,
    };

    try {
      await syncSaveNote(syncNote);
      setNotes([...notes, newNote]);
      setNoteText('');
      setShowNoteInput(false);
      setSelectedLine(null);
    } catch (error) {
      console.error('Error saving note:', error);
      Alert.alert('Error', 'Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  const deleteNoteHandler = (noteId: string) => {
    Alert.alert('Delete Note', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        if (!id) return;
        try {
          await syncDeleteNote(noteId, id);
          setNotes(notes.filter(n => n.id !== noteId));
        } catch (error) {
          console.error('Error deleting note:', error);
          Alert.alert('Error', 'Failed to delete note');
        }
      }},
    ]);
  };

  const getNotesForLine = (lineIndex: number) => {
    return notes.filter(n => n.lineIndex === lineIndex);
  };

  const getNoteTypeInfo = (type: string) => {
    return NOTE_TYPES.find(t => t.id === type) || NOTE_TYPES[4];
  };

  if (loading || !currentScript) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        style={styles.flex} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Director Notes</Text>
          <View style={styles.placeholder} />
        </View>

        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Ionicons name="information-circle" size={20} color="#6366f1" />
          <Text style={styles.infoBannerText}>
            Tap any line to add intentions, emotions, or beats
          </Text>
        </View>

        {/* Script with Notes */}
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {currentScript.lines.map((line, index) => {
            const lineNotes = getNotesForLine(index);
            const isSelected = selectedLine === index;
            
            return (
              <TouchableOpacity
                key={line.id}
                style={[
                  styles.lineContainer,
                  isSelected && styles.lineContainerSelected,
                ]}
                onPress={() => {
                  setSelectedLine(index);
                  setShowNoteInput(true);
                }}
                activeOpacity={0.7}
              >
                {line.is_stage_direction ? (
                  <Text style={styles.stageDirection}>{line.text}</Text>
                ) : (
                  <>
                    <Text style={styles.characterName}>{line.character}</Text>
                    <Text style={styles.lineText}>{line.text}</Text>
                  </>
                )}
                
                {/* Notes for this line */}
                {lineNotes.length > 0 && (
                  <View style={styles.notesContainer}>
                    {lineNotes.map((note) => {
                      const typeInfo = getNoteTypeInfo(note.type);
                      return (
                        <TouchableOpacity
                          key={note.id}
                          style={[styles.noteTag, { backgroundColor: `${typeInfo.color}20`, borderColor: typeInfo.color }]}
                          onLongPress={() => deleteNote(note.id)}
                        >
                          <Ionicons name={typeInfo.icon as any} size={14} color={typeInfo.color} />
                          <Text style={[styles.noteTagText, { color: typeInfo.color }]}>{note.note}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Note Input Panel */}
        {showNoteInput && (
          <View style={styles.noteInputPanel}>
            <View style={styles.noteInputHeader}>
              <Text style={styles.noteInputTitle}>Add Note</Text>
              <TouchableOpacity onPress={() => setShowNoteInput(false)}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {/* Note Type Selection */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeSelector}>
              {NOTE_TYPES.map((type) => (
                <TouchableOpacity
                  key={type.id}
                  style={[
                    styles.typeButton,
                    noteType === type.id && { backgroundColor: `${type.color}30`, borderColor: type.color },
                  ]}
                  onPress={() => setNoteType(type.id)}
                >
                  <Ionicons name={type.icon as any} size={18} color={noteType === type.id ? type.color : '#6b7280'} />
                  <Text style={[styles.typeButtonText, noteType === type.id && { color: type.color }]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Note Text Input */}
            <TextInput
              style={styles.noteInput}
              placeholder="Enter your note..."
              placeholderTextColor="#4a4a5e"
              value={noteText}
              onChangeText={setNoteText}
              multiline
            />

            {/* Add Button */}
            <TouchableOpacity 
              style={[styles.addButton, !noteText.trim() && styles.addButtonDisabled]}
              onPress={addNote}
              disabled={!noteText.trim()}
            >
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.addButtonText}>Add Note</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  placeholder: {
    width: 36,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#6b7280',
    fontSize: 16,
  },
  premiumRequired: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  premiumTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
    marginTop: 16,
  },
  premiumSubtitle: {
    fontSize: 15,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 22,
  },
  upgradeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f59e0b',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 24,
    gap: 8,
  },
  upgradeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  infoBannerText: {
    color: '#6366f1',
    fontSize: 14,
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  lineContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  lineContainerSelected: {
    borderColor: '#6366f1',
  },
  stageDirection: {
    fontSize: 14,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  characterName: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6366f1',
    marginBottom: 4,
  },
  lineText: {
    fontSize: 15,
    color: '#e5e7eb',
    lineHeight: 22,
  },
  notesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 10,
    gap: 8,
  },
  noteTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  noteTagText: {
    fontSize: 12,
    fontWeight: '500',
  },
  noteInputPanel: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#2a2a3e',
  },
  noteInputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  noteInputTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  typeSelector: {
    marginBottom: 16,
  },
  typeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#0a0a0f',
    gap: 6,
  },
  typeButtonText: {
    fontSize: 14,
    color: '#6b7280',
    fontWeight: '500',
  },
  noteInput: {
    backgroundColor: '#0a0a0f',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#fff',
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    marginBottom: 16,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366f1',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  addButtonDisabled: {
    opacity: 0.5,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
