// 업로드 재시도 큐 — "로컬 먼저, 업로드는 나중에"
// 녹음 종료(또는 파일 선택) 즉시 파일을 앱 문서 폴더로 옮기고 큐에 기록한다(네트워크 불필요).
// 이후 processQueue가 노트 생성 → 파일 업로드 → STT 요청을 진행하며,
// 어느 단계에서 실패해도 다음 재시도 때 이어서 진행한다(중복 생성 방지).
// 업로드 성공 후에도 로컬 원본은 지우지 않는다 — 로컬 저장이 1순위라는 원칙.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { decode } from "base64-arraybuffer";
import { supabase } from "./supabase";

const QUEUE_KEY = "chwijae.uploadQueue.v1";
const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;

const CONTENT_TYPES: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
};

export interface QueueItem {
  id: string; // 로컬 큐 항목 id (로컬 파일명에도 사용)
  localUri: string;
  ext: string; // m4a | mp3
  durationSec: number | null;
  recordedAt: string; // ISO — 업로드가 늦어져도 노트 제목은 녹음 시각 기준
  title?: string; // 파일 업로드면 원본 파일명
  memo?: string; // 녹음 전/중 작성한 메모 → 노트에 저장
  noteId?: string; // 이미 생성됐으면 재시도 때 건너뜀
  recordingId?: string;
  lastError?: string;
}

export async function loadQueue(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueueItem[]) : [];
}

async function saveQueue(items: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

async function enqueue(
  tempUri: string,
  ext: string,
  durationSec: number | null,
  title?: string,
  memo?: string
): Promise<QueueItem> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, {
    intermediates: true,
  }).catch(() => {});
  const localUri = `${RECORDINGS_DIR}${id}.${ext}`;
  await FileSystem.copyAsync({ from: tempUri, to: localUri });
  // 녹음 임시 파일은 캐시라 복사 후 정리 시도(실패해도 무방)
  await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});

  const item: QueueItem = {
    id,
    localUri,
    ext,
    durationSec,
    recordedAt: new Date().toISOString(),
    title,
    memo: memo?.trim() || undefined,
  };
  const queue = await loadQueue();
  queue.push(item);
  await saveQueue(queue);
  return item;
}

// 녹음 종료 직후 호출. 캐시 파일은 OS가 지울 수 있으므로 문서 폴더로 옮긴다.
export function enqueueRecording(
  tempUri: string,
  durationSec: number,
  memo?: string
): Promise<QueueItem> {
  return enqueue(tempUri, "m4a", durationSec, undefined, memo);
}

// 통화녹음 등 외부 음성 파일(mp3/m4a) 업로드용
export function enqueueFile(
  pickedUri: string,
  fileName: string,
  memo?: string
): Promise<QueueItem> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!CONTENT_TYPES[ext]) {
    return Promise.reject(
      new Error("mp3 또는 m4a 파일만 업로드할 수 있습니다.")
    );
  }
  return enqueue(pickedUri, ext, null, fileName, memo);
}

// 성공하면 null(큐에서 제거), 실패하면 진행 상태가 갱신된 item을 반환.
async function syncItem(
  item: QueueItem,
  userId: string
): Promise<QueueItem | null> {
  try {
    const ext = item.ext ?? "m4a";
    if (!item.noteId) {
      const title =
        item.title ??
        `취재 ${new Date(item.recordedAt).toLocaleString("ko-KR")}`;
      const { data, error } = await supabase
        .from("notes")
        .insert({
          user_id: userId,
          title,
          memo: item.memo ?? "",
          status: "active",
        })
        .select()
        .single();
      if (error) throw error;
      item.noteId = data.id;
    }

    if (!item.recordingId) {
      const { data, error } = await supabase
        .from("recordings")
        .insert({
          note_id: item.noteId,
          user_id: userId,
          storage_path: "",
          status: "uploading",
          duration_sec: item.durationSec,
        })
        .select()
        .single();
      if (error) throw error;
      item.recordingId = data.id;
    }

    const path = `${userId}/${item.recordingId}.${ext}`;
    const base64 = await FileSystem.readAsStringAsync(item.localUri, {
      encoding: "base64",
    });
    const { error: upErr } = await supabase.storage
      .from("recordings")
      .upload(path, decode(base64), {
        contentType: CONTENT_TYPES[ext] ?? "audio/mp4",
        upsert: true,
      });
    if (upErr) throw upErr;

    await supabase
      .from("recordings")
      .update({ storage_path: path, status: "uploaded" })
      .eq("id", item.recordingId);

    // STT는 결과를 기다리지 않는다. 실패해도 웹에서 "텍스트 변환"으로 재시도 가능.
    supabase.functions.invoke("transcribe", {
      body: { recording_id: item.recordingId },
    });

    // 로컬 원본은 보존 — 사용자에게 "폰에 파일이 남아 있다"는 확신을 준다
    return null;
  } catch (e) {
    item.lastError = e instanceof Error ? e.message : String(e);
    return item;
  }
}

// 큐 전체를 순서대로 처리하고 남은(실패한) 항목 수를 반환.
// 항목마다 진행 상태를 즉시 저장해, 중간에 앱이 죽어도 중복 생성이 없다.
export async function processQueue(userId: string): Promise<number> {
  const queue = await loadQueue();
  const remaining: QueueItem[] = [];
  for (let i = 0; i < queue.length; i++) {
    const failed = await syncItem(queue[i], userId);
    if (failed) remaining.push(failed);
    await saveQueue([...remaining, ...queue.slice(i + 1)]);
  }
  return remaining.length;
}
