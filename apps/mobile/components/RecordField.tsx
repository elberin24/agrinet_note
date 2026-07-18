// 수확 인디케이터 녹음 필드
// - 필드를 탭하면 녹음 시작, 녹음 중 탭/2초 길게 누르기는 설정된 제스처 동작 수행
// - 소리가 크면 트랙터가 빨라진다 (metering dB → 속도)
// - 타이머는 필드 우상단에 작게 표시
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { C } from "../theme";
import { supabase } from "../lib/supabase";
import { enqueueRecording } from "../lib/uploadQueue";
import {
  DEFAULT_GESTURES,
  loadGestures,
  type GestureConfig,
} from "../lib/settings";

const FIELD_HEIGHT = 168;
const SOIL_HEIGHT = 16;
const STALK_GAP = 9;
const TRACTOR_W = 46;

type RecState = "idle" | "recording" | "paused" | "saving";

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function Tractor() {
  return (
    <View style={{ width: TRACTOR_W, height: 34 }}>
      {/* 운전실 */}
      <View style={t.cab}>
        <View style={t.window} />
      </View>
      {/* 몸체 */}
      <View style={t.body} />
      {/* 예취부(앞) */}
      <View style={t.header} />
      {/* 바퀴 */}
      <View style={[t.wheel, { left: 2, bottom: 0, width: 14, height: 14, borderRadius: 7 }]}>
        <View style={t.hub} />
      </View>
      <View style={[t.wheel, { left: 26, bottom: 0, width: 9, height: 9, borderRadius: 5 }]}>
        <View style={[t.hub, { width: 3, height: 3, borderRadius: 2 }]} />
      </View>
    </View>
  );
}

const t = StyleSheet.create({
  cab: {
    position: "absolute", left: 20, top: 0, width: 14, height: 13,
    backgroundColor: C.clayDeep, borderRadius: 3,
    alignItems: "center", justifyContent: "center",
  },
  window: { width: 8, height: 6, borderRadius: 2, backgroundColor: C.skySoft },
  body: {
    position: "absolute", left: 2, top: 11, width: 32, height: 12,
    backgroundColor: C.clay, borderRadius: 3,
  },
  header: {
    position: "absolute", left: 36, top: 18, width: 8, height: 8,
    backgroundColor: "#8A7355", borderRadius: 2,
  },
  wheel: { position: "absolute", backgroundColor: "#3A3B34", alignItems: "center", justifyContent: "center" },
  hub: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#E9E5D8" },
});

export function RecordField({
  userId,
  onSaved,
}: {
  userId: string;
  // 녹음이 로컬 큐에 들어간 뒤 호출. 반환값: 동기화 후 남은(실패한) 항목 수.
  onSaved: () => Promise<number>;
}) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const audioState = useAudioRecorderState(recorder, 120);
  const [state, setState] = useState<RecState>("idle");
  const [memo, setMemo] = useState("");
  const [gestures, setGestures] = useState<GestureConfig>(DEFAULT_GESTURES);

  // 트랙터 위치는 ref로 관리하고 저빈도(10fps)로만 리렌더
  const [fieldW, setFieldW] = useState(0);
  const xRef = useRef(-TRACTOR_W);
  const [, force] = useState(0);
  const stateRef = useRef<RecState>("idle");
  stateRef.current = state;
  const meterRef = useRef(0.4);
  const meterValue = (audioState as { metering?: number }).metering;
  if (typeof meterValue === "number") {
    // dB(-60..0) → 0..1
    meterRef.current = Math.min(1, Math.max(0, (meterValue + 50) / 50));
  }

  useEffect(() => {
    loadGestures().then(setGestures);
  }, [state]); // 설정 화면 다녀온 뒤에도 반영되도록 상태 전환마다 재로드

  useEffect(() => {
    const id = setInterval(() => {
      if (stateRef.current === "recording" && fieldW > 0) {
        const speed = 8 + meterRef.current * 110; // px/s
        xRef.current += speed * 0.1;
        if (xRef.current > fieldW + TRACTOR_W) xRef.current = -TRACTOR_W;
        force((n) => n + 1);
      }
    }, 100);
    return () => clearInterval(id);
  }, [fieldW]);

  // 벼 배치 — 트랙터(34px)보다 낮게 12~22px
  const stalks = useMemo(() => {
    const count = Math.max(0, Math.floor(fieldW / STALK_GAP));
    return Array.from({ length: count }, (_, i) => ({
      x: i * STALK_GAP + 4,
      h: 12 + ((i * 7919) % 100) / 10, // 12~22px 고정 랜덤
    }));
  }, [fieldW]);

  async function start() {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "취재 녹음을 위해 마이크 권한을 허용해 주세요.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    xRef.current = -TRACTOR_W;
    setState("recording");
  }

  function pause() {
    recorder.pause();
    setState("paused");
  }

  function resume() {
    recorder.record();
    setState("recording");
  }

  async function stopAndSave() {
    setState("saving");
    const durationSec = Math.round(audioState.durationMillis / 1000);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("녹음 파일을 찾을 수 없습니다.");

      // 1) 네트워크 없이 로컬에 먼저 보존 — 이 시점 이후 기록은 유실되지 않는다
      await enqueueRecording(uri, durationSec, memo);
      setMemo("");
      setState("idle");

      // 2) 업로드 시도 (실패해도 큐에 남아 자동 재시도됨)
      const remaining = await onSaved();
      if (remaining === 0) {
        Alert.alert(
          "휴대폰에 저장됨",
          `녹음 ${formatElapsed(durationSec)}이 폰에 보관됐고 업로드도 끝났습니다. 텍스트 변환이 시작됩니다.`
        );
      } else {
        Alert.alert(
          "휴대폰에 저장됨",
          "녹음은 폰에 안전하게 보관됐습니다. 네트워크가 연결되면 자동으로 업로드합니다."
        );
      }
    } catch (e) {
      setState("idle");
      Alert.alert("저장 실패", e instanceof Error ? e.message : String(e));
    }
  }

  function onTap() {
    if (state === "saving") return;
    if (state === "idle") { start(); return; }
    if (state === "paused") { resume(); return; }
    // recording
    if (gestures.tap === "pause") pause();
    else if (gestures.tap === "stop") stopAndSave();
  }

  function onLongPress() {
    if (state !== "recording" && state !== "paused") return;
    if (gestures.longPress === "stop") stopAndSave();
    else if (gestures.longPress === "pause") {
      if (state === "recording") pause();
      else resume();
    }
  }

  const elapsed = formatElapsed(audioState.durationMillis / 1000);
  const hint =
    state === "idle"
      ? "탭하면 수확(녹음)이 시작됩니다"
      : state === "recording"
        ? `탭: ${gestures.tap === "pause" ? "일시정지" : gestures.tap === "stop" ? "저장" : "-"} · 2초 길게: ${gestures.longPress === "stop" ? "저장" : "일시정지"}`
        : "탭하면 이어서 녹음합니다";

  const memoLabel =
    state === "idle"
      ? "✎ 메모"
      : "✎ 메모 — 녹음이 끝나면 이 녹음에 연결됩니다";

  // 녹음 전(대기 중) 메모는 태그 없이 독립 저장
  async function saveStandaloneMemo() {
    const body = memo.trim();
    if (!body) return;
    const { error } = await supabase
      .from("memos")
      .insert({ user_id: userId, body });
    if (error) {
      Alert.alert("저장 실패", error.message);
    } else {
      setMemo("");
      Alert.alert("메모 저장됨", "사이드 메뉴 > 메모에서 확인할 수 있습니다.");
    }
  }

  return (
    <View>
      <View style={s.statusRow}>
        {state === "recording" && (
          <View style={[s.pill, { backgroundColor: C.claySoft }]}>
            <View style={[s.dot, { backgroundColor: C.clayDeep }]} />
            <Text style={[s.pillText, { color: C.clayDeep }]}>녹음 중</Text>
          </View>
        )}
        {state === "paused" && (
          <View style={[s.pill, { backgroundColor: C.goldSoft }]}>
            <View style={[s.dot, { backgroundColor: C.goldDeep }]} />
            <Text style={[s.pillText, { color: C.goldDeep }]}>일시정지</Text>
          </View>
        )}
        {state === "idle" && (
          <View style={[s.pill, { backgroundColor: C.surface2 }]}>
            <Text style={[s.pillText, { color: C.inkSoft }]}>대기 중</Text>
          </View>
        )}
      </View>

      <Pressable
        onPress={onTap}
        onLongPress={onLongPress}
        delayLongPress={2000}
        style={s.field}
        onLayout={(e) => setFieldW(e.nativeEvent.layout.width)}
      >
        {/* 벼/그루터기 */}
        {stalks.map((st) => {
          const cut = st.x < xRef.current - 6 && state !== "idle";
          return cut ? (
            <View
              key={st.x}
              style={[s.stubble, { left: st.x, height: 5 }]}
            />
          ) : (
            <View key={st.x} style={[s.stalkWrap, { left: st.x }]}>
              <View style={s.grain} />
              <View style={[s.stalk, { height: st.h }]} />
            </View>
          );
        })}
        {/* 토양 */}
        <View style={s.soil} />
        {/* 트랙터 */}
        {state !== "idle" && (
          <View style={[s.tractor, { left: xRef.current - TRACTOR_W + 6 }]}>
            <Tractor />
          </View>
        )}
        {/* 타이머 — 우상단, 작게 */}
        {state !== "idle" && (
          <View style={s.timerChip}>
            <Text style={s.timerText}>{elapsed}</Text>
          </View>
        )}
        {/* 일시정지 베일 */}
        {state === "paused" && (
          <View style={s.veil}>
            <Text style={s.veilText}>일시정지</Text>
          </View>
        )}
        {state === "saving" && (
          <View style={s.veil}>
            <ActivityIndicator color={C.sageDeep} />
            <Text style={s.veilText}>저장 중…</Text>
          </View>
        )}
        <View style={s.hintChip}>
          <Text style={s.hintText}>{hint}</Text>
        </View>
      </Pressable>

      <View style={s.memoCard}>
        <Text style={s.memoLabel}>{memoLabel}</Text>
        <TextInput
          style={s.memoInput}
          placeholder="예) 12시 럼피스킨 방역 브리핑 — 방역과장 인터뷰 예정"
          placeholderTextColor="#A7AC9B"
          multiline
          value={memo}
          onChangeText={setMemo}
        />
        {state === "idle" && memo.trim().length > 0 && (
          <Pressable style={s.memoSaveBtn} onPress={saveStandaloneMemo}>
            <Text style={s.memoSaveText}>메모만 저장</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  statusRow: { flexDirection: "row", marginBottom: 8, minHeight: 26 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 11, paddingVertical: 4, borderRadius: 999,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: "700" },

  field: {
    height: FIELD_HEIGHT,
    backgroundColor: C.fieldBg,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.line,
    overflow: "hidden",
  },
  soil: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    height: SOIL_HEIGHT, backgroundColor: C.soil,
  },
  stalkWrap: {
    position: "absolute", bottom: SOIL_HEIGHT, alignItems: "center", width: 4,
  },
  stalk: { width: 2, backgroundColor: C.stalk, borderRadius: 1 },
  grain: {
    width: 3.5, height: 6, borderRadius: 2, backgroundColor: C.gold,
    marginBottom: -1,
  },
  stubble: {
    position: "absolute", bottom: SOIL_HEIGHT, width: 2,
    backgroundColor: C.stubble, borderRadius: 1,
  },
  tractor: { position: "absolute", bottom: SOIL_HEIGHT - 2 },

  timerChip: {
    position: "absolute", top: 10, right: 12,
    backgroundColor: "rgba(251,250,245,0.82)",
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
  },
  timerText: {
    fontSize: 15, fontWeight: "600", color: C.ink,
    fontVariant: ["tabular-nums"],
  },
  hintChip: {
    position: "absolute", left: 12, bottom: 10,
    backgroundColor: "rgba(251,250,245,0.72)",
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3,
  },
  hintText: { fontSize: 11, fontWeight: "600", color: "#5B6B4F" },
  veil: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(237,234,224,0.55)",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  veilText: { fontSize: 15, fontWeight: "800", color: C.goldDeep, letterSpacing: 1 },

  memoCard: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: 18, padding: 13, marginTop: 12,
  },
  memoLabel: { fontSize: 12, fontWeight: "700", color: C.sageDeep, marginBottom: 5 },
  memoInput: {
    fontSize: 13.5, color: C.ink, lineHeight: 20, minHeight: 40,
    textAlignVertical: "top", padding: 0,
  },
  memoSaveBtn: {
    alignSelf: "flex-end", backgroundColor: C.sageDeep, borderRadius: 999,
    paddingHorizontal: 16, paddingVertical: 6, marginTop: 8,
  },
  memoSaveText: { color: "#fff", fontSize: 12.5, fontWeight: "800" },
});
