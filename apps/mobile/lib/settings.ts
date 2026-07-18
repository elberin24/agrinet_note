// 사용자 설정 (AsyncStorage) — 제스처 액션, 요약 AI 선택
import AsyncStorage from "@react-native-async-storage/async-storage";

export type TapAction = "pause" | "stop" | "none";
export type LongPressAction = "stop" | "pause";

export interface GestureConfig {
  tap: TapAction; // 녹음 중 한 번 탭
  longPress: LongPressAction; // 녹음/일시정지 중 2초 길게
}

export const DEFAULT_GESTURES: GestureConfig = { tap: "pause", longPress: "stop" };

const GESTURE_KEY = "chwijae.settings.gesture.v1";
const AI_KEY = "chwijae.settings.summaryAi.v1";

export async function loadGestures(): Promise<GestureConfig> {
  try {
    const raw = await AsyncStorage.getItem(GESTURE_KEY);
    if (raw) return { ...DEFAULT_GESTURES, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_GESTURES;
}

export async function saveGestures(g: GestureConfig): Promise<void> {
  await AsyncStorage.setItem(GESTURE_KEY, JSON.stringify(g));
}

export type SummaryAi = "openai" | "gemini" | "claude";

export async function loadSummaryAi(): Promise<SummaryAi> {
  const raw = await AsyncStorage.getItem(AI_KEY);
  return (raw as SummaryAi) ?? "openai";
}

export async function saveSummaryAi(v: SummaryAi): Promise<void> {
  await AsyncStorage.setItem(AI_KEY, v);
}
