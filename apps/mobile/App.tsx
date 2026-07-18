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
import type { Session } from "@supabase/supabase-js";
import type { Note, RecordingStatus } from "@chwijae/core";
import { supabase } from "./lib/supabase";
import { RecordScreen } from "./components/RecordScreen";
import { processQueue } from "./lib/uploadQueue";

type NoteRow = Note & {
  recordings: { id: string; storage_path: string; status: RecordingStatus }[];
};

const COLORS = {
  bg: "#f5f6f8",
  card: "#ffffff",
  ink: "#1a1c20",
  muted: "#6b7280",
  line: "#e5e7eb",
  accent: "#2563eb",
  accentSoft: "#e8f0fe",
  danger: "#dc2626",
  rec: "#d92d20",
  ok: "#15803d",
  okSoft: "#dcfce7",
  warn: "#b45309",
  warnSoft: "#fef3c7",
  dangerSoft: "#fee2e2",
};

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
    return { label: "변환 중", bg: COLORS.accentSoft, fg: COLORS.accent };
  if (statuses.includes("failed"))
    return { label: "변환 실패", bg: COLORS.dangerSoft, fg: COLORS.danger };
  if (statuses.includes("uploaded"))
    return { label: "변환 대기", bg: COLORS.warnSoft, fg: COLORS.warn };
  return { label: "변환 완료", bg: COLORS.okSoft, fg: COLORS.ok };
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
        <Text style={styles.brand}>
          취재수첩<Text style={{ color: COLORS.rec }}>.</Text>
        </Text>
        <Text style={styles.loginSub}>
          {mode === "login" ? "기자 계정으로 로그인하세요." : "새 계정을 만듭니다."}
        </Text>
        <TextInput
          style={styles.field}
          placeholder="이메일"
          placeholderTextColor={COLORS.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.field}
          placeholder="비밀번호 (6자 이상)"
          placeholderTextColor={COLORS.muted}
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

function HomeScreen({ session }: { session: Session }) {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // 로컬 큐 업로드 시도 + 노트 목록 갱신. 남은 항목 수를 반환.
  const sync = useCallback(async () => {
    setSyncing(true);
    let remaining = 0;
    try {
      remaining = await processQueue(session.user.id);
    } finally {
      setPending(remaining);
      setSyncing(false);
    }
    const { data, error } = await supabase
      .from("notes")
      .select("*, recordings(id, storage_path, status)")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (!error && data) setNotes(data as NoteRow[]);
    return remaining;
  }, [session.user.id]);

  useEffect(() => {
    sync();
    // 앱이 백그라운드에서 돌아올 때마다 밀린 업로드 자동 재시도
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") sync();
    });
    return () => sub.remove();
  }, [sync]);

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
        <Text style={styles.brand}>
          취재수첩<Text style={{ color: COLORS.rec }}>.</Text>
        </Text>
        <Pressable onPress={() => supabase.auth.signOut()}>
          <Text style={styles.link}>로그아웃</Text>
        </Pressable>
      </View>

      <RecordScreen onSaved={sync} />

      {pending > 0 && (
        <Pressable
          style={styles.pendingBanner}
          onPress={sync}
          disabled={syncing}
        >
          <Text style={styles.pendingText}>
            {syncing
              ? "업로드 재시도 중…"
              : `업로드 대기 ${pending}건 — 탭해서 다시 시도`}
          </Text>
        </Pressable>
      )}

      <TextInput
        style={styles.search}
        placeholder="제목 검색"
        placeholderTextColor={COLORS.muted}
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={filtered}
        keyExtractor={(n) => n.id}
        onRefresh={sync}
        refreshing={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {q
              ? "검색 결과가 없습니다."
              : "아직 기록이 없습니다.\n위 버튼으로 첫 녹음을 시작하세요."}
          </Text>
        }
        renderItem={({ item }) => {
          const status = noteStatus(item);
          return (
            <Pressable
              style={styles.noteCard}
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
              </View>
              <Text style={styles.noteMeta}>
                {new Date(item.updated_at).toLocaleString("ko-KR")}
              </Text>
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return (
    <SafeAreaProvider>
      {/* edges에 bottom 포함 — 독립 APK는 edge-to-edge라 하단 내비게이션바 영역도 피해야 한다 */}
      <SafeAreaView style={styles.container} edges={["top", "bottom", "left", "right"]}>
        <StatusBar barStyle="dark-content" backgroundColor={COLORS.bg} />
        {!ready ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : session ? (
          <HomeScreen session={session} />
        ) : (
          <LoginScreen />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  brand: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.5,
    color: COLORS.ink,
  },
  link: { color: COLORS.accent, fontSize: 14 },

  // 로그인
  loginWrap: { flex: 1, justifyContent: "center", padding: 24 },
  loginCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 24,
    gap: 10,
  },
  loginSub: { color: COLORS.muted, fontSize: 13, marginBottom: 4 },
  field: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
    color: COLORS.ink,
    backgroundColor: COLORS.card,
  },
  formError: { color: COLORS.danger, fontSize: 13 },
  btn: {
    backgroundColor: COLORS.ink,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  // 홈
  home: { flex: 1, paddingHorizontal: 20 },
  homeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
  },
  pendingBanner: {
    backgroundColor: COLORS.warnSoft,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  pendingText: { color: COLORS.warn, fontSize: 14, textAlign: "center" },
  search: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: COLORS.ink,
    backgroundColor: COLORS.card,
    marginBottom: 12,
  },
  empty: {
    color: COLORS.muted,
    textAlign: "center",
    paddingVertical: 40,
    lineHeight: 22,
  },

  // 노트 카드
  noteCard: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
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
    fontSize: 15,
    fontWeight: "700",
    color: COLORS.ink,
    flex: 1,
  },
  noteMeta: { fontSize: 12, color: COLORS.muted, marginTop: 3 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  chipText: { fontSize: 11, fontWeight: "700" },
  hint: {
    color: COLORS.muted,
    fontSize: 11,
    textAlign: "center",
    paddingVertical: 8,
  },
});
