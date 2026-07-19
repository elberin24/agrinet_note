import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
} from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import type { Session } from "@supabase/supabase-js";
import type { Note, RecordingStatus } from "@chwijae/core";
import { C } from "./theme";
import { supabase } from "./lib/supabase";
import {
  cancelAndRemove,
  enqueueFile,
  loadQueue,
  processQueue,
  queueItemTitle,
  retryItem,
  type QueueItem,
} from "./lib/uploadQueue";
import { RecordField } from "./components/RecordField";
import { SideMenu, type MenuTarget } from "./components/SideMenu";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SourcesScreen } from "./screens/SourcesScreen";
import { MemosScreen } from "./screens/MemosScreen";
import { NoteDetailScreen } from "./screens/NoteDetailScreen";

type NoteRow = Note & {
  recordings: {
    id: string;
    storage_path: string;
    status: RecordingStatus;
    transcripts: { summary: string | null; raw_text: string | null }[];
  }[];
};

type Screen = "home" | "settings" | "sources" | "memos";

function errorMessage(message: string): string {
  if (message.includes("Invalid login credentials"))
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (message.includes("already registered")) return "이미 가입된 이메일입니다.";
  if (message.includes("at least 6 characters"))
    return "비밀번호는 6자 이상이어야 합니다.";
  return message;
}

// 노트의 대표 상태: 가장 "진행 중"인 녹음 기준으로 표시
function noteStatus(
  n: NoteRow
): { label: string; bg: string; fg: string } | null {
  const statuses = n.recordings.map((r) => r.status);
  if (statuses.length === 0) return null;
  if (statuses.includes("uploading") || statuses.includes("transcribing"))
    return { label: "변환 중", bg: C.skySoft, fg: C.skyDeep };
  if (statuses.includes("failed"))
    return { label: "변환 실패", bg: C.claySoft, fg: C.clayDeep };
  if (statuses.includes("uploaded"))
    return { label: "변환 대기", bg: C.goldSoft, fg: C.goldDeep };
  return { label: "완료", bg: C.sageSoft, fg: C.sageDeep };
}

function Wordmark() {
  return (
    <Text style={styles.brand}>
      취재수첩<Text style={{ color: C.clay }}>.</Text>
    </Text>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setNotice("");
    const { error } =
      mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (error) {
      setNotice(errorMessage(error.message));
    } else if (mode === "signup") {
      setNotice("가입 완료. 로그인해 주세요.");
      setMode("login");
    }
    setBusy(false);
  }

  return (
    <View style={styles.loginWrap}>
      <View style={styles.loginCard}>
        <Wordmark />
        <Text style={styles.loginSub}>
          {mode === "login" ? "기자 계정으로 로그인하세요." : "새 계정을 만듭니다."}
        </Text>
        <TextInput
          style={styles.field}
          placeholder="이메일"
          placeholderTextColor="#A7AC9B"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.field}
          placeholder="비밀번호 (6자 이상)"
          placeholderTextColor="#A7AC9B"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {notice ? <Text style={styles.formError}>{notice}</Text> : null}
        <Pressable style={styles.btn} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>
              {mode === "login" ? "로그인" : "회원가입"}
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={() => {
            setMode(mode === "login" ? "signup" : "login");
            setNotice("");
          }}
        >
          <Text style={styles.link}>
            {mode === "login"
              ? "계정이 없나요? 회원가입"
              : "이미 계정이 있나요? 로그인"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// 목록 카드 미리보기: AI 요약 우선, 없으면 원문 앞부분
function notePreview(n: NoteRow): string | null {
  for (const r of n.recordings) {
    const t = r.transcripts?.[0];
    if (t?.summary) return t.summary;
    if (t?.raw_text) {
      const snip = t.raw_text.slice(0, 60);
      return t.raw_text.length > 60 ? `${snip}…` : snip;
    }
  }
  return null;
}

function HomeScreen({
  session,
  onOpenMenu,
  onOpenNote,
}: {
  session: Session;
  onOpenMenu: () => void;
  onOpenNote: (noteId: string) => void;
}) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [search, setSearch] = useState("");
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});

  // 로컬 큐 업로드 시도(진행률 표시) + 노트 목록 갱신. 남은 항목 수를 반환.
  const sync = useCallback(async () => {
    let remaining = 0;
    try {
      remaining = await processQueue(session.user.id, (id, pct) => {
        setProgress((p) => ({ ...p, [id]: pct }));
        // 진행률이 바뀔 때마다 큐 카드도 갱신
        loadQueue().then(setQueueItems);
      });
    } finally {
      setQueueItems(await loadQueue());
      setProgress({});
    }
    const { data, error } = await supabase
      .from("notes")
      .select("*, recordings(id, storage_path, status, transcripts(summary, raw_text))")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (!error && data) setNotes(data as NoteRow[]);
    return remaining;
  }, [session.user.id]);

  // 실패 항목 삭제 — 목록에서만 지울지, 폰의 원본 파일까지 지울지 선택
  function askDeleteFailed(item: QueueItem) {
    Alert.alert(
      "실패 항목 삭제",
      `"${queueItemTitle(item)}"\n원본 파일 처리 방법을 선택하세요.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "목록에서만 삭제",
          onPress: async () => {
            await cancelAndRemove(item.id);
            sync();
          },
        },
        {
          text: "원본 파일도 삭제",
          style: "destructive",
          onPress: async () => {
            await cancelAndRemove(item.id, { deleteLocalFile: true });
            sync();
          },
        },
      ]
    );
  }

  // 실패한 큐 항목 카드 탭 → 재업로드/삭제 선택
  function askRetry(item: QueueItem) {
    Alert.alert(
      "재업로드 하시겠습니까?",
      `"${queueItemTitle(item)}"\n실패 사유: ${item.lastError ?? "알 수 없음"}`,
      [
        { text: "나중에", style: "cancel" },
        { text: "삭제…", onPress: () => askDeleteFailed(item) },
        {
          text: "재업로드",
          onPress: async () => {
            await retryItem(item.id, session.user.id, (id, pct) => {
              setProgress((p) => ({ ...p, [id]: pct }));
            });
            setProgress({});
            sync();
          },
        },
      ]
    );
  }

  // 업로드 중 취소 / 실패 항목 삭제
  function askCancelQueueItem(item: QueueItem, uploading: boolean) {
    Alert.alert(
      uploading ? "업로드 취소" : "항목 삭제",
      uploading
        ? "업로드를 취소할까요? 녹음 원본은 폰에 그대로 보관됩니다."
        : "이 항목을 목록에서 삭제할까요? 녹음 원본은 폰에 그대로 보관됩니다.",
      [
        { text: "아니오", style: "cancel" },
        {
          text: uploading ? "업로드 취소" : "삭제",
          style: "destructive",
          onPress: async () => {
            await cancelAndRemove(item.id);
            sync();
          },
        },
      ]
    );
  }

  useEffect(() => {
    sync();
    // 앱이 백그라운드에서 돌아올 때마다 밀린 업로드 자동 재시도
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") sync();
    });
    return () => sub.remove();
  }, [sync]);

  async function pickAudioFile() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["audio/*"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];

    // 용량 사전 검사 — 실패할 업로드는 시작 전에 알려준다
    const sizeMB = (asset.size ?? 0) / (1024 * 1024);
    if (sizeMB > 50) {
      Alert.alert(
        "파일이 너무 큽니다",
        `이 파일은 ${Math.round(sizeMB)}MB입니다.\n현재 저장소 플랜의 업로드 한도는 파일당 50MB입니다.\n\n긴 통화녹음은 편집 앱에서 나눠서 올려주세요. (장시간 파일 자동 분할 기능은 준비 중입니다)`
      );
      return;
    }
    const doEnqueue = async () => {
      try {
        // 로컬 보존 → 업로드 → STT (녹음과 동일 파이프라인)
        await enqueueFile(asset.uri, asset.name);
        const remaining = await sync();
        Alert.alert(
          "파일 등록됨",
          remaining === 0
            ? "업로드가 끝났고 텍스트 변환이 시작됩니다."
            : "폰에 보관됐습니다. 네트워크가 연결되면 자동으로 업로드합니다."
        );
      } catch (e) {
        Alert.alert("업로드 불가", e instanceof Error ? e.message : String(e));
      }
    };
    if (sizeMB > 25) {
      Alert.alert(
        "변환이 실패할 수 있어요",
        `이 파일은 ${Math.round(sizeMB)}MB입니다.\n음성 변환(AI)은 파일당 25MB까지만 지원해서, 업로드는 되지만 텍스트 변환은 실패할 수 있습니다.`,
        [
          { text: "취소", style: "cancel" },
          { text: "그래도 업로드", onPress: doEnqueue },
        ]
      );
      return;
    }
    doEnqueue();
  }

  function confirmDelete(note: NoteRow) {
    Alert.alert(
      "노트 삭제",
      `"${note.title}"\n녹음 파일과 변환 텍스트도 함께 삭제됩니다.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: async () => {
            const paths = note.recordings
              .map((r) => r.storage_path)
              .filter((p) => p.length > 0);
            if (paths.length > 0) {
              await supabase.storage.from("recordings").remove(paths);
            }
            await supabase.from("notes").delete().eq("id", note.id);
            sync();
          },
        },
      ]
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? notes.filter(
        (n) =>
          n.title.toLowerCase().includes(q) || n.memo.toLowerCase().includes(q)
      )
    : notes;

  return (
    <View style={styles.home}>
      <View style={styles.homeHeader}>
        <Wordmark />
        <Pressable onPress={onOpenMenu} hitSlop={8}>
          <View style={styles.avatarBtn}>
            <Text style={{ fontSize: 15 }}>👤</Text>
          </View>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(n) => n.id}
        onRefresh={sync}
        refreshing={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View>
            <RecordField userId={session.user.id} onSaved={sync} />
            <Pressable style={styles.uploadRow} onPress={pickAudioFile}>
              <Text style={styles.uploadText}>🎧 음성 파일 업로드</Text>
              <Text style={styles.uploadSub}>통화녹음 등 · mp3, m4a</Text>
            </Pressable>
            {queueItems.map((item) => {
              const pct = progress[item.id];
              const uploading = pct != null && !item.lastError;
              return (
                <Pressable
                  key={item.id}
                  style={styles.noteCard}
                  onPress={() =>
                    item.lastError
                      ? askRetry(item)
                      : askCancelQueueItem(item, true)
                  }
                >
                  <View style={styles.noteRow}>
                    <Text style={styles.noteTitle} numberOfLines={1}>
                      {queueItemTitle(item)}
                    </Text>
                    {item.lastError ? (
                      <View style={[styles.chip, { backgroundColor: C.claySoft }]}>
                        <Text style={[styles.chipText, { color: C.clayDeep }]}>
                          업로드 실패
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.chip, { backgroundColor: C.skySoft }]}>
                        <Text style={[styles.chipText, { color: C.skyDeep }]}>
                          업로드 중 {Math.round((pct ?? 0) * 100)}%
                        </Text>
                      </View>
                    )}
                  </View>
                  {uploading && (
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${Math.round((pct ?? 0) * 100)}%` },
                        ]}
                      />
                    </View>
                  )}
                  <Text style={styles.noteMeta}>
                    {item.lastError
                      ? "탭하면 재업로드 여부를 선택합니다 (원본은 폰에 보관 중)"
                      : "탭하면 업로드를 취소할 수 있습니다"}
                  </Text>
                </Pressable>
              );
            })}
            <TextInput
              style={styles.search}
              placeholder="제목·메모 검색"
              placeholderTextColor="#A7AC9B"
              value={search}
              onChangeText={setSearch}
            />
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {q
              ? "검색 결과가 없습니다."
              : "아직 기록이 없습니다.\n논밭을 탭해 첫 녹음을 시작하세요."}
          </Text>
        }
        renderItem={({ item }) => {
          const status = noteStatus(item);
          const preview = notePreview(item);
          const busy = status?.label === "변환 중";
          return (
            <Pressable
              style={styles.noteCard}
              onPress={() => onOpenNote(item.id)}
              onLongPress={() => confirmDelete(item)}
              delayLongPress={500}
            >
              <View style={styles.noteRow}>
                <Text style={styles.noteTitle} numberOfLines={1}>
                  {item.title || "(제목 없음)"}
                </Text>
                {status && (
                  <View style={[styles.chip, { backgroundColor: status.bg }]}>
                    <Text style={[styles.chipText, { color: status.fg }]}>
                      {status.label}
                    </Text>
                  </View>
                )}
                {busy && (
                  <Pressable
                    hitSlop={8}
                    onPress={() =>
                      Alert.alert(
                        "변환 취소",
                        "텍스트 변환을 취소할까요? 노트와 녹음이 삭제됩니다.",
                        [
                          { text: "계속 변환", style: "cancel" },
                          {
                            text: "취소하고 삭제",
                            style: "destructive",
                            onPress: async () => {
                              const paths = item.recordings
                                .map((r) => r.storage_path)
                                .filter((p) => p.length > 0);
                              if (paths.length > 0) {
                                await supabase.storage
                                  .from("recordings")
                                  .remove(paths);
                              }
                              await supabase
                                .from("notes")
                                .delete()
                                .eq("id", item.id);
                              sync();
                            },
                          },
                        ]
                      )
                    }
                  >
                    <Text style={styles.cancelX}>×</Text>
                  </Pressable>
                )}
              </View>
              {busy && (
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, styles.progressBusy]} />
                </View>
              )}
              <Text style={styles.noteMeta}>
                {new Date(item.updated_at).toLocaleString("ko-KR")}
              </Text>
              {preview && (
                <Text style={styles.notePreview} numberOfLines={2}>
                  {preview}
                </Text>
              )}
            </Pressable>
          );
        }}
      />
      <Text style={styles.hint}>노트를 길게 누르면 삭제할 수 있습니다</Text>
    </View>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [detailNoteId, setDetailNoteId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) setScreen("home");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  function handleMenu(target: MenuTarget) {
    if (target === "logout") {
      supabase.auth.signOut();
      return;
    }
    setScreen(target);
  }

  return (
    <SafeAreaProvider>
      {/* edges에 bottom 포함 — 독립 APK는 edge-to-edge라 하단 내비게이션바 영역도 피해야 한다 */}
      <SafeAreaView
        style={styles.container}
        edges={["top", "bottom", "left", "right"]}
      >
        <StatusBar barStyle="dark-content" backgroundColor={C.bg} />
        {!ready ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : !session ? (
          <LoginScreen />
        ) : detailNoteId ? (
          <NoteDetailScreen
            noteId={detailNoteId}
            onBack={() => setDetailNoteId(null)}
          />
        ) : screen === "settings" ? (
          <SettingsScreen session={session} onBack={() => setScreen("home")} />
        ) : screen === "sources" ? (
          <SourcesScreen onBack={() => setScreen("home")} />
        ) : screen === "memos" ? (
          <MemosScreen
            userId={session.user.id}
            onBack={() => setScreen("home")}
          />
        ) : (
          <HomeScreen
            session={session}
            onOpenMenu={() => setMenuOpen(true)}
            onOpenNote={setDetailNoteId}
          />
        )}
        {session && (
          <SideMenu
            visible={menuOpen}
            email={session.user.email ?? ""}
            onClose={() => setMenuOpen(false)}
            onNavigate={handleMenu}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  brand: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: C.ink,
  },
  link: { color: C.skyDeep, fontSize: 14, textAlign: "center" },

  // 로그인
  loginWrap: { flex: 1, justifyContent: "center", padding: 24 },
  loginCard: {
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    padding: 24,
    gap: 10,
  },
  loginSub: { color: C.inkSoft, fontSize: 13, marginBottom: 4 },
  field: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
    color: C.ink,
    backgroundColor: C.surface,
  },
  formError: { color: C.clayDeep, fontSize: 13 },
  btn: {
    backgroundColor: C.ink,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  // 홈
  home: { flex: 1, paddingHorizontal: 20 },
  homeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  avatarBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.sageSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  uploadRow: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 2,
    marginTop: 12,
  },
  uploadText: { fontSize: 14, fontWeight: "700", color: C.ink },
  uploadSub: { fontSize: 11.5, color: C.inkSoft },
  progressTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: C.surface2,
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: {
    height: 5,
    borderRadius: 3,
    backgroundColor: C.sage,
  },
  progressBusy: { width: "38%", backgroundColor: C.sky, alignSelf: "flex-start" },
  cancelX: { fontSize: 20, color: C.inkSoft, marginLeft: 2, lineHeight: 22 },
  search: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: C.ink,
    backgroundColor: C.surface,
    marginTop: 12,
    marginBottom: 12,
  },
  empty: {
    color: C.inkSoft,
    textAlign: "center",
    paddingVertical: 40,
    lineHeight: 22,
  },

  // 노트 카드
  noteCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  noteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  noteTitle: {
    fontSize: 15.5,
    fontWeight: "800",
    color: C.ink,
    flex: 1,
  },
  noteMeta: { fontSize: 12, color: C.inkSoft, marginTop: 3 },
  notePreview: { fontSize: 12.5, color: C.inkSoft, marginTop: 6, lineHeight: 18 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  chipText: { fontSize: 11, fontWeight: "700" },
  hint: {
    color: C.inkSoft,
    fontSize: 11,
    textAlign: "center",
    paddingVertical: 8,
  },
});
