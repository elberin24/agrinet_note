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
import { enqueueFile, processQueue } from "./lib/uploadQueue";
import { RecordField } from "./components/RecordField";
import { SideMenu, type MenuTarget } from "./components/SideMenu";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SourcesScreen } from "./screens/SourcesScreen";

type NoteRow = Note & {
  recordings: { id: string; storage_path: string; status: RecordingStatus }[];
};

type Screen = "home" | "settings" | "sources";

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

function HomeScreen({
  session,
  onOpenMenu,
}: {
  session: Session;
  onOpenMenu: () => void;
}) {
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

  async function pickAudioFile() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ["audio/*"],
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
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
            <RecordField onSaved={sync} />
            <Pressable style={styles.uploadRow} onPress={pickAudioFile}>
              <Text style={styles.uploadText}>
                🎧 음성 파일 업로드 <Text style={{ color: C.inkSoft }}>(통화녹음 등 · mp3, m4a)</Text>
              </Text>
            </Pressable>
            {pending > 0 && (
              <Pressable
                style={styles.pendingBanner}
                onPress={sync}
                disabled={syncing}
              >
                <Text style={styles.pendingText}>
                  {syncing
                    ? "업로드 재시도 중…"
                    : `업로드 대기 ${pending}건 — 탭해서 다시 시도 (파일은 폰에 안전하게 보관 중)`}
                </Text>
              </Pressable>
            )}
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
              {item.memo ? (
                <Text style={styles.noteMemo} numberOfLines={1}>
                  ✎ {item.memo}
                </Text>
              ) : null}
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
        ) : screen === "settings" ? (
          <SettingsScreen session={session} onBack={() => setScreen("home")} />
        ) : screen === "sources" ? (
          <SourcesScreen onBack={() => setScreen("home")} />
        ) : (
          <HomeScreen session={session} onOpenMenu={() => setMenuOpen(true)} />
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
    alignItems: "center",
    marginTop: 12,
  },
  uploadText: { fontSize: 13.5, fontWeight: "700", color: C.ink },
  pendingBanner: {
    backgroundColor: C.goldSoft,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  pendingText: {
    color: C.goldDeep,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
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
    fontSize: 15,
    fontWeight: "700",
    color: C.ink,
    flex: 1,
  },
  noteMeta: { fontSize: 12, color: C.inkSoft, marginTop: 3 },
  noteMemo: { fontSize: 12.5, color: C.sageDeep, marginTop: 6 },
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
