// Searchable FAQ Help Centre: category chips, search field, expandable answers.
import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, RADIUS, TYPE, tint } from '../constants/cinematicTheme';
import { FAQ_CATEGORIES, FAQ_ITEMS, FaqCategoryId } from '../constants/helpCentre';

export const HelpCentre = () => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<FaqCategoryId | 'all'>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ_ITEMS.filter((f) =>
      (category === 'all' || f.category === category) &&
      (!q || f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q)));
  }, [query, category]);

  return (
    <ScrollView style={s.scroll} contentContainerStyle={s.content} testID="support-faq-scroll" keyboardShouldPersistTaps="handled">
      <Text style={s.title}>Help Centre</Text>
      <View style={s.search}>
        <Ionicons name="search" size={16} color={C.dim} />
        <TextInput
          value={query} onChangeText={setQuery} placeholder="Search help articles" placeholderTextColor={C.dim}
          style={s.searchInput} testID="faq-search-input"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} testID="faq-search-clear"><Ionicons name="close-circle" size={18} color={C.dim} /></TouchableOpacity>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
        {[{ id: 'all' as const, label: 'All', icon: 'apps-outline' }, ...FAQ_CATEGORIES].map((c) => {
          const active = category === c.id;
          return (
            <TouchableOpacity key={c.id} onPress={() => setCategory(c.id)} style={[s.chip, active && s.chipActive]} testID={`faq-category-${c.id}`}>
              <Ionicons name={c.icon as any} size={13} color={active ? '#fff' : C.muted} />
              <Text style={[s.chipText, active && s.chipTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <Text style={s.count} testID="faq-result-count">{results.length} {results.length === 1 ? 'article' : 'articles'}</Text>
      {results.length === 0 ? (
        <View style={s.empty} testID="faq-empty"><Text style={s.emptyText}>No articles match your search. Try another word, or send a Bug Report.</Text></View>
      ) : results.map((f) => {
        const open = openId === f.id;
        return (
          <View key={f.id} style={[s.item, open && s.itemOpen]}>
            <TouchableOpacity style={s.qRow} onPress={() => setOpenId(open ? null : f.id)} testID={`faq-question-${f.id}`}>
              <Text style={s.q}>{f.q}</Text>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.violetSoft} />
            </TouchableOpacity>
            {open ? <Text style={s.a} testID={`faq-answer-${f.id}`}>{f.a}</Text> : null}
          </View>
        );
      })}
    </ScrollView>
  );
};

const s = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 18, paddingBottom: 48 },
  title: { ...TYPE.display, marginBottom: 14 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: C.line, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: C.text, fontSize: 15, paddingVertical: 12 },
  chips: { gap: 8, paddingVertical: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: RADIUS.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  chipActive: { backgroundColor: C.violet, borderColor: C.violet },
  chipText: { fontSize: 12.5, fontWeight: '600', color: C.muted },
  chipTextActive: { color: '#fff' },
  count: { ...TYPE.label, marginBottom: 10 },
  empty: { padding: 18, borderRadius: RADIUS.lg, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  emptyText: { color: C.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  item: { backgroundColor: C.surface, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: C.line, marginBottom: 10, overflow: 'hidden' },
  itemOpen: { borderColor: tint(C.violet, 0.4) },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  q: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text },
  a: { fontSize: 14, lineHeight: 21, color: '#D6D3F0', paddingHorizontal: 14, paddingBottom: 14 },
});
