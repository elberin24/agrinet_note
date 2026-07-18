// 메모 섹션 — 독립 메모 모음. 녹음 노트 연결/해제/수정, 취재원 연결(자리).
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Memo, Note } from "@chwijae/core";
import { C } from "../theme";
import { supabase } from "../lib/supabase";

type MemoWithNote = Memo & { notes: { title: string } | null };

export function MemosScreen({
  userId,
  onBack,
}: {
  userId: string;
  onBack: () => void;
}) {
  const [memos, setMemos] = useState<MemoWithNote[]>([]);
  const [editing, setEditing] = useState<MemoWithNote | null>(null);
  const [editBody, setEditBody] = useState("");
  const [linking, setLinking] = useState<MemoWithNote | null>(null);
  const [noteOptions, setNoteOptions] = useState<Note[]>([]);
  const [newBody, setNewBody] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("memos")
      .select("*, notes(title)")
      .order("updated_at", { ascending: false });
    if (data) setMemos(data as MemoWithNote[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function createMemo() {
    const body = newBody.trim();
    if (!body) return;
    const { error } = await supabase
      .from("memos")
      .insert({ user_id: userId, body });
    if (error) Alert.alert("저장 실패", error.message);
    else {
      setNewBody("");
      load();
    }
  }

  async function saveEdit() {
    if (!editing) return;
    await supabase
      .from("memos")
      .update({ body: editBody })
      .eq("id", editing.id);
    setEditing(null);
    load();
  }

  function confirmDelete(memo: MemoWithNote) {
    Alert.alert("메모 삭제", "이 메모를 삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          await supabase.from("memos").delete().eq("id", memo.id);
          load();
        },
      },
    ]);
  }

  async function unlink(memo: MemoWithNote) {
    await supabase.from("memos").update({ note_id: null }).eq("id", memo.id);
    load();
  }

  async function openLinkPicker(memo: MemoWithNote) {
    const { data } = await supabase
      .from("notes")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(20);
    setNoteOptions((data as Note[]) ?? []);
    setLinking(memo);
  }

  async function linkTo(noteId: string) {
    if (!linking) return;
    await supabase
      .from("memos")
      .update({ note_id: noteId })
      .eq("id", linking.id);
    setLinking(null);
    load();
  }

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.back}>‹</Text>
        </Pressable>
        <Text style={s.headerTitle}>메모</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={s.newCard}>
        <TextInput
          style={s.newInput}
          placeholder="새 메모 — 취재 아이디어, 확인할 것 등"
          placeholderTextColor="#A7AC9B"
          multiline
          value={newBody}
          onChangeText={setNewBody}
        />
        <Pressable
          style={[s.saveBtn, !newBody.trim() && { opacity: 0.4 }]}
          onPress={createMemo}
          disabled={!newBody.trim()}
        >
          <Text style={s.saveBtnText}>저장</Text>
        </Pressable>
      </View>

      <FlatList
        data={memos}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <Text style={s.empty}>
            아직 메모가 없습니다.{"\n"}녹음 화면의 메모는 녹음과 함께 여기에도 모입니다.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={s.memoCard}
            onPress={() => {
              setEditing(item);
              setEditBody(item.body);
            }}
            onLongPress={() => confirmDelete(item)}
            delayLongPress={500}
          >
            <Text style={s.body}>{item.body}</Text>
            <View style={s.tagRow}>
              {item.note_id && item.notes ? (
                <>
                  <View style={s.tag}>
                    <Text style={s.tagText} numberOfLines={1}>
                      🎙 {item.notes.title}
                    </Text>
                  </View>
                  <Pressable onPress={() => unlink(item)} hitSlop={6}>
                    <Text style={s.tagAction}>연결 해제</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable onPress={() => openLinkPicker(item)} hitSlop={6}>
                  <Text style={s.tagAction}>+ 녹음 연결</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() =>
                  Alert.alert("준비 중", "취재원 연결은 취재원 DB 구축 후 제공됩니다.")
                }
                hitSlop={6}
              >
                <Text style={[s.tagAction, { color: C.skyDeep }]}>+ 취재원</Text>
              </Pressable>
            </View>
            <Text style={s.meta}>
              {new Date(item.updated_at).toLocaleString("ko-KR")}
            </Text>
          </Pressable>
        )}
      />
      <Text style={s.hintFoot}>메모를 탭하면 수정, 길게 누르면 삭제</Text>

      {/* 메모 수정 모달 */}
      <Modal visible={!!editing} transparent animationType="fade">
        <View style={s.modalBack}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>메모 수정</Text>
            <TextInput
              style={[s.newInput, { minHeight: 90 }]}
              multiline
              value={editBody}
              onChangeText={setEditBody}
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={[s.modalBtn, { backgroundColor: C.surface2 }]}
                onPress={() => setEditing(null)}
              >
                <Text style={{ color: C.ink, fontWeight: "700" }}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: C.ink }]}
                onPress={saveEdit}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>저장</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 녹음 연결 선택 모달 */}
      <Modal visible={!!linking} transparent animationType="fade">
        <View style={s.modalBack}>
          <View style={[s.modalCard, { maxHeight: "70%" }]}>
            <Text style={s.modalTitle}>연결할 녹음 선택</Text>
            <FlatList
              data={noteOptions}
              keyExtractor={(n) => n.id}
              renderItem={({ item }) => (
                <Pressable style={s.pickRow} onPress={() => linkTo(item.id)}>
                  <Text style={s.pickTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={s.pickMeta}>
                    {new Date(item.updated_at).toLocaleString("ko-KR")}
                  </Text>
                </Pressable>
              )}
            />
            <Pressable
              style={[s.modalBtn, { backgroundColor: C.surface2 }]}
              onPress={() => setLinking(null)}
            >
              <Text style={{ color: C.ink, fontWeight: "700" }}>닫기</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 12,
  },
  back: { fontSize: 30, color: C.ink, lineHeight: 32, width: 24 },
  headerTitle: { fontSize: 17, fontWeight: "800", color: C.ink },

  newCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 16, padding: 13, marginBottom: 14,
  },
  newInput: {
    fontSize: 14, color: C.ink, lineHeight: 21, minHeight: 42,
    textAlignVertical: "top", padding: 0,
    borderWidth: 0,
  },
  saveBtn: {
    alignSelf: "flex-end", backgroundColor: C.ink, borderRadius: 999,
    paddingHorizontal: 18, paddingVertical: 7, marginTop: 8,
  },
  saveBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  memoCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 16, padding: 13, marginBottom: 10, gap: 8,
  },
  body: { fontSize: 14, color: C.ink, lineHeight: 21 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  tag: {
    backgroundColor: C.sageSoft, borderRadius: 999,
    paddingHorizontal: 10, paddingVertical: 3, maxWidth: "60%",
  },
  tagText: { fontSize: 11.5, fontWeight: "700", color: C.sageDeep },
  tagAction: { fontSize: 12, fontWeight: "800", color: C.clayDeep },
  meta: { fontSize: 11, color: C.inkSoft },
  empty: {
    color: C.inkSoft, textAlign: "center", paddingVertical: 40, lineHeight: 22,
  },
  hintFoot: {
    color: C.inkSoft, fontSize: 11, textAlign: "center", paddingVertical: 8,
  },

  modalBack: {
    flex: 1, backgroundColor: "rgba(43,47,40,0.4)",
    alignItems: "center", justifyContent: "center", padding: 28,
  },
  modalCard: {
    width: "100%", backgroundColor: C.surface, borderRadius: 18, padding: 18, gap: 12,
  },
  modalTitle: { fontSize: 15, fontWeight: "800", color: C.ink },
  modalBtn: { borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  pickRow: {
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line,
  },
  pickTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  pickMeta: { fontSize: 11.5, color: C.inkSoft, marginTop: 2 },
});
