// 설정 — 목록 화면과 하위 화면(제스처/요약 AI/회원 정보)
import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { Session } from "@supabase/supabase-js";
import { C } from "../theme";
import { supabase } from "../lib/supabase";
import {
  DEFAULT_GESTURES,
  loadGestures,
  loadSummaryAi,
  saveGestures,
  saveSummaryAi,
  type GestureConfig,
  type SummaryAi,
} from "../lib/settings";

type Sub = "menu" | "gesture" | "ai" | "account";

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={12}>
        <Text style={s.back}>‹</Text>
      </Pressable>
      <Text style={s.headerTitle}>{title}</Text>
      <View style={{ width: 24 }} />
    </View>
  );
}

function Radio({
  selected,
  label,
  desc,
  onPress,
}: {
  selected: boolean;
  label: string;
  desc?: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={[s.radio, selected && s.radioOn]} onPress={onPress}>
      <View style={[s.radioDot, selected && s.radioDotOn]} />
      <View style={{ flex: 1 }}>
        <Text style={s.radioLabel}>{label}</Text>
        {desc ? <Text style={s.radioDesc}>{desc}</Text> : null}
      </View>
    </Pressable>
  );
}

function GestureSettings({ onBack }: { onBack: () => void }) {
  const [g, setG] = useState<GestureConfig>(DEFAULT_GESTURES);
  useEffect(() => { loadGestures().then(setG); }, []);
  function update(next: GestureConfig) { setG(next); saveGestures(next); }

  return (
    <View style={s.screen}>
      <Header title="제스처 액션 설정" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={s.section}>녹음 중 한 번 탭</Text>
        <Radio selected={g.tap === "pause"} label="일시정지" desc="다시 탭하면 이어서 녹음"
          onPress={() => update({ ...g, tap: "pause" })} />
        <Radio selected={g.tap === "stop"} label="녹음 정지(저장)"
          onPress={() => update({ ...g, tap: "stop" })} />
        <Radio selected={g.tap === "none"} label="동작 없음" desc="실수 탭 방지"
          onPress={() => update({ ...g, tap: "none" })} />

        <Text style={s.section}>2초 길게 누르기</Text>
        <Radio selected={g.longPress === "stop"} label="녹음 정지(저장)"
          onPress={() => update({ ...g, longPress: "stop" })} />
        <Radio selected={g.longPress === "pause"} label="일시정지 / 재개"
          onPress={() => update({ ...g, longPress: "pause" })} />
        <Text style={s.note}>변경 사항은 바로 적용됩니다.</Text>
      </ScrollView>
    </View>
  );
}

function AiSettings({ onBack }: { onBack: () => void }) {
  const [ai, setAi] = useState<SummaryAi>("openai");
  useEffect(() => { loadSummaryAi().then(setAi); }, []);
  function update(v: SummaryAi) { setAi(v); saveSummaryAi(v); }

  return (
    <View style={s.screen}>
      <Header title="요약 AI 설정" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={s.section}>요약에 사용할 AI</Text>
        <Radio selected={ai === "openai"} label="OpenAI" desc="현재 음성 변환에 사용 중"
          onPress={() => update("openai")} />
        <Radio selected={ai === "gemini"} label="Gemini" desc="준비 중"
          onPress={() => update("gemini")} />
        <Radio selected={ai === "claude"} label="Claude" desc="준비 중"
          onPress={() => update("claude")} />
        <Text style={s.note}>요약 기능이 출시되면 선택한 AI가 적용됩니다.</Text>
      </ScrollView>
    </View>
  );
}

function AccountSettings({ session, onBack }: { session: Session; onBack: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function changePassword() {
    if (pw.length < 6) { Alert.alert("확인", "비밀번호는 6자 이상이어야 합니다."); return; }
    if (pw !== pw2) { Alert.alert("확인", "두 비밀번호가 일치하지 않습니다."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) Alert.alert("변경 실패", error.message);
    else { setPw(""); setPw2(""); Alert.alert("완료", "비밀번호가 변경됐습니다."); }
  }

  return (
    <View style={s.screen}>
      <Header title="회원 정보" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Text style={s.section}>프로필</Text>
        <View style={s.infoCard}>
          <Text style={s.infoLabel}>이메일</Text>
          <Text style={s.infoValue}>{session.user.email}</Text>
        </View>

        <Text style={s.section}>비밀번호 변경</Text>
        <View style={s.infoCard}>
          <TextInput
            style={s.input} placeholder="새 비밀번호 (6자 이상)" placeholderTextColor="#A7AC9B"
            secureTextEntry value={pw} onChangeText={setPw}
          />
          <TextInput
            style={s.input} placeholder="새 비밀번호 확인" placeholderTextColor="#A7AC9B"
            secureTextEntry value={pw2} onChangeText={setPw2}
          />
          <Pressable style={[s.btn, busy && { opacity: 0.5 }]} onPress={changePassword} disabled={busy}>
            <Text style={s.btnText}>{busy ? "변경 중…" : "비밀번호 변경"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

export function SettingsScreen({
  session,
  onBack,
}: {
  session: Session;
  onBack: () => void;
}) {
  const [sub, setSub] = useState<Sub>("menu");

  if (sub === "gesture") return <GestureSettings onBack={() => setSub("menu")} />;
  if (sub === "ai") return <AiSettings onBack={() => setSub("menu")} />;
  if (sub === "account") return <AccountSettings session={session} onBack={() => setSub("menu")} />;

  const rows: { key: Sub; icon: string; label: string; desc: string }[] = [
    { key: "gesture", icon: "👆", label: "제스처 액션 설정", desc: "녹음 중 탭 · 길게 누르기 동작" },
    { key: "ai", icon: "✨", label: "요약 AI 설정", desc: "OpenAI · Gemini · Claude" },
    { key: "account", icon: "👤", label: "회원 정보", desc: "비밀번호 변경 · 프로필" },
  ];

  return (
    <View style={s.screen}>
      <Header title="설정" onBack={onBack} />
      {rows.map((r) => (
        <Pressable
          key={r.key}
          style={({ pressed }) => [s.row, pressed && { backgroundColor: C.surface2 }]}
          onPress={() => setSub(r.key)}
        >
          <Text style={s.rowIcon}>{r.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>{r.label}</Text>
            <Text style={s.rowDesc}>{r.desc}</Text>
          </View>
          <Text style={s.chev}>›</Text>
        </Pressable>
      ))}
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

  row: {
    flexDirection: "row", alignItems: "center", gap: 13,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 16, padding: 15, marginBottom: 10,
  },
  rowIcon: { fontSize: 20 },
  rowLabel: { fontSize: 15, fontWeight: "750" as never, color: C.ink },
  rowDesc: { fontSize: 12, color: C.inkSoft, marginTop: 2 },
  chev: { fontSize: 22, color: C.inkSoft },

  section: {
    fontSize: 12, fontWeight: "800", color: C.inkSoft,
    letterSpacing: 0.5, marginTop: 18, marginBottom: 8, marginLeft: 4,
  },
  radio: {
    flexDirection: "row", alignItems: "center", gap: 11,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 14, padding: 14, marginBottom: 8,
  },
  radioOn: { borderColor: C.sage, backgroundColor: "#F4F7EF" },
  radioDot: {
    width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.line,
  },
  radioDotOn: { borderColor: C.sageDeep, backgroundColor: C.sage },
  radioLabel: { fontSize: 14.5, fontWeight: "700", color: C.ink },
  radioDesc: { fontSize: 12, color: C.inkSoft, marginTop: 1 },
  note: { fontSize: 12, color: C.inkSoft, marginTop: 10, marginLeft: 4 },

  infoCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 16, padding: 15, gap: 10,
  },
  infoLabel: { fontSize: 12, color: C.inkSoft, fontWeight: "700" },
  infoValue: { fontSize: 15, color: C.ink, fontWeight: "600" },
  input: {
    borderWidth: 1, borderColor: C.line, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: C.ink,
    backgroundColor: C.surface,
  },
  btn: {
    backgroundColor: C.ink, borderRadius: 10, paddingVertical: 12,
    alignItems: "center",
  },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
});
