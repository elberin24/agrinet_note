// 녹음 카드 상세 — 재생(단어 동기화), 다듬은 버전/원문 탭, 화자 이름 수정,
// 제목 수정, 자유 태그(분야/장소/취재원 등),
// 플로팅 메뉴(내보내기 PDF/TXT/MD, 질문하기)
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import type {
  Memo,
  Note,
  NoteTag,
  Recording,
  SpeakerSegment,
  Transcript,
} from "@chwijae/core";
import { C } from "../theme";
import { supabase } from "../lib/supabase";

type NoteFull = Note & {
  recordings: (Recording & { transcripts: Transcript[] })[];
};

const TAG_SUGGESTIONS = ["분야", "장소", "취재원"];

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function speakerLabel(names: Record<string, string>, speaker: string): string {
  return names[speaker] ?? `화자 ${speaker}`;
}

function Player({
  url,
  initialSeek,
  onTime,
  seekRef,
}: {
  url: string;
  initialSeek: number | null;
  onTime: (sec: number) => void;
  seekRef: React.MutableRefObject<((sec: number) => void) | null>;
}) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const [trackW, setTrackW] = useState(200);
  const playing = status.playing;

  useEffect(() => {
    seekRef.current = (sec: number) => {
      player.seekTo(sec);
      player.play();
    };
    if (initialSeek != null) {
      player.seekTo(initialSeek);
      player.play();
    }
    return () => {
      seekRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player]);

  // 단어 하이라이트용 — 과도한 리렌더를 막기 위해 0.25초 단위로만 전달
  const lastSent = useRef(0);
  useEffect(() => {
    if (Math.abs(status.currentTime - lastSent.current) >= 0.25) {
      lastSent.current = status.currentTime;
      onTime(status.currentTime);
    }
  }, [status.currentTime, onTime]);

  return (
    <View style={s.player}>
      <Pressable
        style={s.playBtn}
        onPress={() => (playing ? player.pause() : player.play())}
      >
        <Text style={{ color: "#fff", fontSize: 15 }}>{playing ? "❚❚" : "▶"}</Text>
      </Pressable>
      <Pressable
        style={s.track}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (status.duration > 0) {
            player.seekTo(
              (e.nativeEvent.locationX / trackW) * status.duration
            );
          }
        }}
      >
        <View
          style={[
            s.trackFill,
            {
              width: `${status.duration > 0 ? (status.currentTime / status.duration) * 100 : 0}%`,
            },
          ]}
        />
      </Pressable>
      <Text style={s.time}>
        {fmtTime(status.currentTime)} / {fmtTime(status.duration)}
      </Text>
    </View>
  );
}

export function NoteDetailScreen({
  noteId,
  onBack,
}: {
  noteId: string;
  onBack: () => void;
}) {
  const [note, setNote] = useState<NoteFull | null>(null);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [tab, setTab] = useState<"refined" | "raw">("refined");
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(-1);
  const seekRef = useRef<((sec: number) => void) | null>(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [qa, setQa] = useState<{ q: string; a: string }[]>([]);
  const [renaming, setRenaming] = useState<{ speaker: string; value: string } | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [tagEdit, setTagEdit] = useState<{
    index: number; // -1이면 새 태그
    name: string;
    value: string;
  } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notes")
      .select("*, recordings(*, transcripts(*))")
      .eq("id", noteId)
      .single();
    if (data) setNote(data as NoteFull);
    const { data: m } = await supabase
      .from("memos")
      .select("*")
      .eq("note_id", noteId)
      .order("created_at");
    if (m) setMemos(m as Memo[]);
  }, [noteId]);

  useEffect(() => {
    load();
  }, [load]);

  const rec = note?.recordings?.[0];
  const t = rec?.transcripts?.[0];
  const names = (t?.speaker_names ?? {}) as Record<string, string>;
  const refined = t?.refined ?? null;
  const hasRefined = Array.isArray(refined) && refined.length > 0;
  const activeTab = hasRefined ? tab : "raw";
  const tags: NoteTag[] = note?.tags ?? [];

  async function openPlayer(seekSec: number | null) {
    if (!rec?.storage_path) return;
    if (playUrl) {
      if (seekSec != null) seekRef.current?.(seekSec);
      return;
    }
    const { data, error } = await supabase.storage
      .from("recordings")
      .createSignedUrl(rec.storage_path, 3600);
    if (error || !data) {
      Alert.alert("재생 실패", error?.message ?? "URL 발급 실패");
      return;
    }
    setPendingSeek(seekSec);
    setPlayUrl(data.signedUrl);
  }

  async function saveTitle() {
    if (editingTitle == null || !note) return;
    const title = editingTitle.trim();
    if (title && title !== note.title) {
      await supabase.from("notes").update({ title }).eq("id", note.id);
    }
    setEditingTitle(null);
    load();
  }

  async function saveTags(next: NoteTag[]) {
    if (!note) return;
    await supabase.from("notes").update({ tags: next }).eq("id", note.id);
    load();
  }

  function applyTagEdit(remove = false) {
    if (!tagEdit || !note) return;
    const next = [...tags];
    if (remove) {
      if (tagEdit.index >= 0) next.splice(tagEdit.index, 1);
    } else {
      const name = tagEdit.name.trim();
      const value = tagEdit.value.trim();
      if (!name || !value) {
        Alert.alert("확인", "태그 이름과 값을 모두 입력해 주세요.");
        return;
      }
      if (tagEdit.index >= 0) next[tagEdit.index] = { name, value };
      else next.push({ name, value });
    }
    setTagEdit(null);
    saveTags(next);
  }

  async function saveSpeakerName() {
    if (!renaming || !t) return;
    const next = { ...names, [renaming.speaker]: renaming.value.trim() };
    if (!renaming.value.trim()) delete next[renaming.speaker];
    await supabase
      .from("transcripts")
      .update({ speaker_names: next })
      .eq("id", t.id);
    setRenaming(null);
    load();
  }

  function buildExportText(markdown: boolean): string {
    if (!note) return "";
    const head = markdown ? `# ${note.title}\n\n` : `${note.title}\n`;
    const date = `${new Date(note.updated_at).toLocaleString("ko-KR")}\n\n`;
    let body = "";
    if (activeTab === "refined" && hasRefined) {
      body = (refined as SpeakerSegment[])
        .map((seg) =>
          markdown
            ? `**${speakerLabel(names, seg.speaker)}:** ${seg.text}`
            : `${speakerLabel(names, seg.speaker)}: ${seg.text}`
        )
        .join("\n\n");
    } else {
      body = t?.edited_text ?? t?.raw_text ?? "(변환된 텍스트 없음)";
    }
    return head + date + body + "\n";
  }

  async function exportAs(format: "txt" | "md" | "pdf") {
    setFabOpen(false);
    if (!note) return;
    try {
      const safe = note.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
      if (format === "pdf") {
        const html = `<html><head><meta charset="utf-8"><style>
          body{font-family:sans-serif;line-height:1.8;padding:24px;color:#2B2F28}
          h1{font-size:20px} .meta{color:#757A6B;font-size:12px;margin-bottom:20px}
          .sp{font-weight:700;color:#5F7749}</style></head><body>
          <h1>${note.title}</h1>
          <div class="meta">${new Date(note.updated_at).toLocaleString("ko-KR")} · 취재수첩</div>
          ${
            activeTab === "refined" && hasRefined
              ? (refined as SpeakerSegment[])
                  .map((seg) => `<p><span class="sp">${speakerLabel(names, seg.speaker)}:</span> ${seg.text}</p>`)
                  .join("")
              : `<p>${(t?.edited_text ?? t?.raw_text ?? "").replace(/\n/g, "<br>")}</p>`
          }</body></html>`;
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: "application/pdf" });
      } else {
        const content = buildExportText(format === "md");
        const uri = `${FileSystem.cacheDirectory}${safe}.${format}`;
        await FileSystem.writeAsStringAsync(uri, content);
        await Sharing.shareAsync(uri, {
          mimeType: format === "md" ? "text/markdown" : "text/plain",
        });
      }
    } catch (e) {
      Alert.alert("내보내기 실패", e instanceof Error ? e.message : String(e));
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || !rec || asking) return;
    setAsking(true);
    setQuestion("");
    try {
      const { data, error } = await supabase.functions.invoke("ask", {
        body: { recording_id: rec.id, question: q },
      });
      if (error || data?.error) throw new Error(error?.message ?? data?.error);
      setQa((prev) => [...prev, { q, a: data.answer }]);
    } catch (e) {
      setQa((prev) => [
        ...prev,
        { q, a: `오류: ${e instanceof Error ? e.message : String(e)}` },
      ]);
    } finally {
      setAsking(false);
    }
  }

  if (!note) {
    return (
      <View style={[s.screen, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={s.back}>‹</Text>
        </Pressable>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => setEditingTitle(note.title)}
        >
          <Text style={s.headerTitle} numberOfLines={1}>{note.title}</Text>
          <Text style={s.headerHint}>제목을 탭하면 수정</Text>
        </Pressable>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <Text style={s.meta}>
          {new Date(note.updated_at).toLocaleString("ko-KR")}
          {rec?.duration_sec != null ? ` · ${fmtTime(rec.duration_sec)}` : ""}
        </Text>

        {/* 태그 */}
        <View style={s.tagsRow}>
          {tags.map((tg, i) => (
            <Pressable
              key={`${tg.name}-${i}`}
              style={s.tagChip}
              onPress={() =>
                setTagEdit({ index: i, name: tg.name, value: tg.value })
              }
            >
              <Text style={s.tagChipText}>
                {tg.name} · {tg.value}
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={[s.tagChip, s.tagChipAdd]}
            onPress={() => setTagEdit({ index: -1, name: "", value: "" })}
          >
            <Text style={[s.tagChipText, { color: C.inkSoft }]}>+ 태그</Text>
          </Pressable>
        </View>

        {memos.length > 0 && (
          <View style={s.memoCard}>
            <Text style={s.memoLabel}>✎ 메모</Text>
            {memos.map((m) => (
              <Text key={m.id} style={s.memoBody}>{m.body}</Text>
            ))}
          </View>
        )}

        {rec?.storage_path ? (
          playUrl ? (
            <Player
              url={playUrl}
              initialSeek={pendingSeek}
              onTime={setCurrentTime}
              seekRef={seekRef}
            />
          ) : (
            <Pressable style={s.playRow} onPress={() => openPlayer(null)}>
              <Text style={s.playRowText}>▶ 녹음 재생</Text>
            </Pressable>
          )
        ) : null}

        {hasRefined && (
          <View style={s.tabs}>
            <Pressable
              style={[s.tabBtn, activeTab === "refined" && s.tabOn]}
              onPress={() => setTab("refined")}
            >
              <Text style={[s.tabText, activeTab === "refined" && s.tabTextOn]}>
                다듬은 버전
              </Text>
            </Pressable>
            <Pressable
              style={[s.tabBtn, activeTab === "raw" && s.tabOn]}
              onPress={() => setTab("raw")}
            >
              <Text style={[s.tabText, activeTab === "raw" && s.tabTextOn]}>
                원문 (재생 동기화)
              </Text>
            </Pressable>
          </View>
        )}

        {activeTab === "refined" && hasRefined ? (
          <View style={{ gap: 10 }}>
            {(refined as SpeakerSegment[]).map((seg, i) => (
              <View key={i} style={s.segment}>
                <Pressable
                  style={s.speakerChip}
                  onPress={() =>
                    setRenaming({
                      speaker: seg.speaker,
                      value: names[seg.speaker] ?? "",
                    })
                  }
                >
                  <Text style={s.speakerText}>
                    {speakerLabel(names, seg.speaker)}
                  </Text>
                </Pressable>
                <Text style={s.segText}>{seg.text}</Text>
              </View>
            ))}
            <Text style={s.hint}>화자 이름을 탭하면 수정할 수 있습니다</Text>
          </View>
        ) : t?.edited_text != null ? (
          <Text style={s.rawText}>{t.edited_text}</Text>
        ) : t?.words && t.words.length > 0 ? (
          // PC와 동일한 단어 동기화: 재생 위치의 단어를 강조, 단어 탭 → 해당 시점 재생
          <View>
            <Text style={s.rawText}>
              {t.words.map((w, i) => {
                const active = currentTime >= w.start && currentTime < w.end;
                return (
                  <Text
                    key={i}
                    onPress={() => openPlayer(w.start)}
                    style={active ? s.wordOn : undefined}
                  >
                    {w.word}{" "}
                  </Text>
                );
              })}
            </Text>
            <Text style={s.hint}>단어를 탭하면 그 시점부터 재생됩니다</Text>
          </View>
        ) : (
          <Text style={s.rawText}>
            {t?.raw_text ?? "아직 변환된 텍스트가 없습니다."}
          </Text>
        )}

        {qa.length > 0 && (
          <View style={{ marginTop: 18, gap: 8 }}>
            <Text style={s.memoLabel}>💬 질문/답변</Text>
            {qa.map((item, i) => (
              <View key={i} style={s.qaCard}>
                <Text style={s.qaQ}>Q. {item.q}</Text>
                <Text style={s.qaA}>{item.a}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* 플로팅 버튼 + 메뉴 */}
      {fabOpen && (
        <View style={s.fabMenu}>
          <Pressable style={s.fabItem} onPress={() => { setFabOpen(false); setAskOpen(true); }}>
            <Text style={s.fabItemText}>💬 질문하기</Text>
          </Pressable>
          <Pressable style={s.fabItem} onPress={() => exportAs("pdf")}>
            <Text style={s.fabItemText}>📄 PDF로 내보내기</Text>
          </Pressable>
          <Pressable style={s.fabItem} onPress={() => exportAs("txt")}>
            <Text style={s.fabItemText}>📃 TXT로 내보내기</Text>
          </Pressable>
          <Pressable style={s.fabItem} onPress={() => exportAs("md")}>
            <Text style={s.fabItemText}>Ⓜ️ MD로 내보내기</Text>
          </Pressable>
        </View>
      )}
      <Pressable style={s.fab} onPress={() => setFabOpen((v) => !v)}>
        <Text style={{ color: "#fff", fontSize: 24, lineHeight: 26 }}>
          {fabOpen ? "×" : "⋯"}
        </Text>
      </Pressable>

      {/* 질문 입력 바 */}
      {askOpen && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={s.askBarWrap}
        >
          <View style={s.askBar}>
            <TextInput
              style={s.askInput}
              placeholder="이 녹음에 대해 질문하세요"
              placeholderTextColor="#A7AC9B"
              value={question}
              onChangeText={setQuestion}
              onSubmitEditing={ask}
              returnKeyType="send"
              autoFocus
            />
            <Pressable style={s.askSend} onPress={ask} disabled={asking}>
              {asking ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "800" }}>↑</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setAskOpen(false)} hitSlop={8}>
              <Text style={{ color: C.inkSoft, fontSize: 18, marginLeft: 6 }}>×</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* 제목 수정 모달 */}
      <Modal visible={editingTitle != null} transparent animationType="fade">
        <View style={s.modalBack}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>제목 수정</Text>
            <TextInput
              style={s.modalInput}
              value={editingTitle ?? ""}
              onChangeText={setEditingTitle}
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={[s.modalBtn, { backgroundColor: C.surface2 }]}
                onPress={() => setEditingTitle(null)}
              >
                <Text style={{ color: C.ink, fontWeight: "700" }}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: C.ink }]}
                onPress={saveTitle}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>저장</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 태그 추가/수정 모달 */}
      <Modal visible={!!tagEdit} transparent animationType="fade">
        <View style={s.modalBack}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              {tagEdit?.index === -1 ? "태그 추가" : "태그 수정"}
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {TAG_SUGGESTIONS.map((name) => (
                <Pressable
                  key={name}
                  style={[
                    s.suggestChip,
                    tagEdit?.name === name && s.suggestChipOn,
                  ]}
                  onPress={() =>
                    setTagEdit((te) => (te ? { ...te, name } : te))
                  }
                >
                  <Text
                    style={[
                      s.suggestText,
                      tagEdit?.name === name && { color: "#fff" },
                    ]}
                  >
                    {name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={s.modalInput}
              placeholder="태그 이름 (예: 분야, 장소, 취재원…)"
              placeholderTextColor="#A7AC9B"
              value={tagEdit?.name ?? ""}
              onChangeText={(v) =>
                setTagEdit((te) => (te ? { ...te, name: v } : te))
              }
            />
            <TextInput
              style={s.modalInput}
              placeholder="값 (예: 축산, 세종청사, 김과장…)"
              placeholderTextColor="#A7AC9B"
              value={tagEdit?.value ?? ""}
              onChangeText={(v) =>
                setTagEdit((te) => (te ? { ...te, value: v } : te))
              }
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {tagEdit && tagEdit.index >= 0 && (
                <Pressable
                  style={[s.modalBtn, { backgroundColor: C.claySoft }]}
                  onPress={() => applyTagEdit(true)}
                >
                  <Text style={{ color: C.clayDeep, fontWeight: "700" }}>삭제</Text>
                </Pressable>
              )}
              <Pressable
                style={[s.modalBtn, { backgroundColor: C.surface2 }]}
                onPress={() => setTagEdit(null)}
              >
                <Text style={{ color: C.ink, fontWeight: "700" }}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: C.ink }]}
                onPress={() => applyTagEdit(false)}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>저장</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 화자 이름 수정 모달 */}
      <Modal visible={!!renaming} transparent animationType="fade">
        <View style={s.modalBack}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>
              화자 {renaming?.speaker} 이름 수정
            </Text>
            <TextInput
              style={s.modalInput}
              placeholder={`예) 김과장 (비우면 "화자 ${renaming?.speaker}")`}
              placeholderTextColor="#A7AC9B"
              value={renaming?.value ?? ""}
              onChangeText={(v) =>
                setRenaming((r) => (r ? { ...r, value: v } : r))
              }
              autoFocus
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={[s.modalBtn, { backgroundColor: C.surface2 }]}
                onPress={() => setRenaming(null)}
              >
                <Text style={{ color: C.ink, fontWeight: "700" }}>취소</Text>
              </Pressable>
              <Pressable
                style={[s.modalBtn, { backgroundColor: C.ink }]}
                onPress={saveSpeakerName}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>저장</Text>
              </Pressable>
            </View>
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
    paddingVertical: 10, gap: 8,
  },
  back: { fontSize: 30, color: C.ink, lineHeight: 32, width: 24 },
  headerTitle: { fontSize: 16, fontWeight: "800", color: C.ink, textAlign: "center" },
  headerHint: { fontSize: 10, color: C.inkSoft, textAlign: "center", marginTop: 1 },
  meta: { fontSize: 12, color: C.inkSoft, marginBottom: 10 },

  tagsRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12,
  },
  tagChip: {
    backgroundColor: C.goldSoft, borderRadius: 999,
    paddingHorizontal: 11, paddingVertical: 4,
  },
  tagChipAdd: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderStyle: "dashed",
  },
  tagChipText: { fontSize: 12, fontWeight: "700", color: C.goldDeep },

  memoCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 12, marginBottom: 12, gap: 4,
  },
  memoLabel: { fontSize: 12, fontWeight: "800", color: C.sageDeep },
  memoBody: { fontSize: 13.5, color: C.ink, lineHeight: 20 },

  playRow: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, paddingVertical: 12, alignItems: "center", marginBottom: 12,
  },
  playRowText: { fontSize: 14, fontWeight: "800", color: C.clayDeep },
  player: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.surface2, borderRadius: 14, padding: 10, marginBottom: 12,
  },
  playBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.clay,
    alignItems: "center", justifyContent: "center",
  },
  track: {
    flex: 1, height: 18, justifyContent: "center",
  },
  trackFill: { height: 6, backgroundColor: C.sage, borderRadius: 3 },
  time: { fontSize: 11, color: C.inkSoft, fontVariant: ["tabular-nums"] },

  tabs: {
    flexDirection: "row", backgroundColor: C.surface2, borderRadius: 12,
    padding: 3, marginBottom: 12,
  },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 10 },
  tabOn: { backgroundColor: C.surface },
  tabText: { fontSize: 13, fontWeight: "700", color: C.inkSoft },
  tabTextOn: { color: C.ink },

  segment: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 12,
  },
  speakerChip: {
    alignSelf: "flex-start", backgroundColor: C.sageSoft,
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, marginBottom: 6,
  },
  speakerText: { fontSize: 12, fontWeight: "800", color: C.sageDeep },
  segText: { fontSize: 14, color: C.ink, lineHeight: 22 },
  rawText: { fontSize: 14, color: C.ink, lineHeight: 26 },
  wordOn: {
    color: C.skyDeep, fontWeight: "800", backgroundColor: C.skySoft,
  },
  hint: { fontSize: 11.5, color: C.inkSoft, textAlign: "center", marginTop: 8 },

  qaCard: {
    backgroundColor: C.skySoft, borderRadius: 14, padding: 12, gap: 6,
  },
  qaQ: { fontSize: 13, fontWeight: "800", color: C.skyDeep },
  qaA: { fontSize: 13.5, color: C.ink, lineHeight: 20 },

  fab: {
    position: "absolute", right: 20, bottom: 24,
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.clay,
    alignItems: "center", justifyContent: "center",
    shadowColor: C.clayDeep, shadowOpacity: 0.4, shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  fabMenu: {
    position: "absolute", right: 20, bottom: 90, gap: 8, alignItems: "flex-end",
  },
  fabItem: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10,
    shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  fabItemText: { fontSize: 13.5, fontWeight: "700", color: C.ink },

  askBarWrap: { position: "absolute", left: 16, right: 16, bottom: 20 },
  askBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  askInput: { flex: 1, fontSize: 14, color: C.ink, padding: 0 },
  askSend: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: C.sageDeep,
    alignItems: "center", justifyContent: "center",
  },

  modalBack: {
    flex: 1, backgroundColor: "rgba(43,47,40,0.4)",
    alignItems: "center", justifyContent: "center", padding: 32,
  },
  modalCard: {
    width: "100%", backgroundColor: C.surface, borderRadius: 18, padding: 18, gap: 12,
  },
  modalTitle: { fontSize: 15, fontWeight: "800", color: C.ink },
  modalInput: {
    borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.ink,
  },
  modalBtn: {
    flex: 1, borderRadius: 10, paddingVertical: 11, alignItems: "center",
  },
  suggestChip: {
    backgroundColor: C.surface2, borderRadius: 999,
    paddingHorizontal: 13, paddingVertical: 5,
  },
  suggestChipOn: { backgroundColor: C.sageDeep },
  suggestText: { fontSize: 12.5, fontWeight: "700", color: C.ink },
});
