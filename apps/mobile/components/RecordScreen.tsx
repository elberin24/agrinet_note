import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { enqueueRecording } from "../lib/uploadQueue";

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RecordScreen({
  onSaved,
}: {
  // 녹음이 로컬 큐에 들어간 뒤 호출. 반환값: 동기화 후 남은(실패한) 항목 수.
  onSaved: () => Promise<number>;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 500);
  const [saving, setSaving] = useState(false);

  async function start() {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "취재 녹음을 위해 마이크 권한을 허용해 주세요.");
      return;
    }
    // playsInSilentMode: iOS 무음 모드에서도 녹음 유지 (취재 중 벨소리 끔 상태 대비)
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stopAndSave() {
    setSaving(true);
    const durationSec = Math.round(state.durationMillis / 1000);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("녹음 파일을 찾을 수 없습니다.");

      // 1) 네트워크 없이 로컬에 먼저 보존 — 이 시점 이후 기록은 유실되지 않는다
      await enqueueRecording(uri, durationSec);

      // 2) 업로드 시도 (실패해도 큐에 남아 자동 재시도됨)
      const remaining = await onSaved();
      if (remaining === 0) {
        Alert.alert(
          "저장 완료",
          `녹음 ${formatElapsed(durationSec)} 업로드됨. 텍스트 변환이 시작됩니다.`
        );
      } else {
        Alert.alert(
          "로컬에 보관됨",
          "네트워크 문제로 업로드하지 못했습니다. 녹음은 안전하게 저장되어 있고, 연결되면 자동으로 다시 시도합니다."
        );
      }
    } catch (e) {
      Alert.alert("저장 실패", e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const recording = state.isRecording;

  return (
    <View style={styles.wrap}>
      <Pressable
        style={[styles.recordButton, recording && styles.recordingActive]}
        onPress={recording ? stopAndSave : start}
        disabled={saving}
      >
        {saving ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : (
          <Text style={styles.recordButtonText}>
            {recording ? "정지" : "녹음"}
          </Text>
        )}
      </Pressable>
      <Text style={styles.status}>
        {saving
          ? "저장 중…"
          : recording
            ? `녹음 중 ${formatElapsed(state.durationMillis / 1000)}`
            : "탭 한 번으로 녹음을 시작합니다"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", paddingVertical: 24 },
  recordButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#c22",
    alignItems: "center",
    justifyContent: "center",
  },
  recordingActive: { backgroundColor: "#222" },
  recordButtonText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  status: { marginTop: 12, color: "#666" },
});
