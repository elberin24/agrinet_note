// 업로드 재시도 큐 — "로컬 먼저, 업로드는 나중에"
// 녹음 종료(또는 파일 선택) 즉시 파일을 앱 문서 폴더로 옮기고 큐에 기록한다(네트워크 불필요).
// 업로드는 서명 URL + 파일 스트리밍(진행률 콜백/취소 지원)으로 진행하고,
// 실패 항목은 자동 재시도하지 않는다 — 홈 화면에서 카드를 탭해 개별 재업로드.
// 업로드 성공 후에도 로컬 원본은 지우지 않는다.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
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
  memo?: string; // 녹음 중 작성한 메모 → memos 테이블에 노트 태그로 저장
  noteId?: string; // 이미 생성됐으면 재시도 때 건너뜀
  recordingId?: string;
  lastError?: string;
}

export type ProgressFn = (itemId: string, pct: number) => void;

// 진행 중인 업로드 작업 (취소용)
const activeTasks = new Map<string, FileSystem.UploadTask>();
// 처리 도중 사용자가 취소·삭제한 항목 (큐 재저장 시 되살아나지 않도록)
const cancelledIds = new Set<string>();

export function queueItemTitle(item: QueueItem): string {
  return (
    item.title ?? `취재 ${new Date(item.recordedAt).toLocaleString("ko-KR")}`
  );
}

export async function loadQueue(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const items = raw ? (JSON.parse(raw) as QueueItem[]) : [];
  return items.filter((i) => !cancelledIds.has(i.id));
}

async function saveQueue(items: QueueItem[]): Promise<void> {
  await AsyncStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(items.filter((i) => !cancelledIds.has(i.id)))
  );
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

// 업로드 취소 + 큐에서 제거 + 서버에 만들어진 행 정리. 로컬 원본은 남긴다.
export async function cancelAndRemove(itemId: string): Promise<void> {
  cancelledIds.add(itemId);
  const task = activeTasks.get(itemId);
  if (task) {
    try {
      await task.cancelAsync();
    } catch {}
    activeTasks.delete(itemId);
  }
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  const items = raw ? (JSON.parse(raw) as QueueItem[]) : [];
  const item = items.find((q) => q.id === itemId);
  if (item?.noteId) {
    // 노트 삭제 시 recordings/memos는 FK로 함께 정리된다
    await supabase.from("notes").delete().eq("id", item.noteId);
  }
  await saveQueue(items.filter((q) => q.id !== itemId));
}

// 성공하면 null(큐에서 제거), 실패하면 진행 상태가 갱신된 item을 반환.
async function syncItem(
  item: QueueItem,
  userId: string,
  onProgress?: ProgressFn
): Promise<QueueItem | null> {
  try {
    const ext = item.ext ?? "m4a";
    if (!item.noteId) {
      const { data, error } = await supabase
        .from("notes")
        .insert({ user_id: userId, title: queueItemTitle(item), status: "active" })
        .select()
        .single();
      if (error) throw error;
      item.noteId = data.id;
      // 녹음 중 작성한 메모는 memos 테이블에 이 노트로 태그해 저장
      if (item.memo) {
        await supabase.from("memos").insert({
          user_id: userId,
          body: item.memo,
          note_id: item.noteId,
        });
        item.memo = undefined;
      }
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

    // 서명 업로드 URL 발급 → 파일 스트리밍 업로드 (진행률/취소 지원, base64 메모리 부담 없음)
    const { data: signed, error: signErr } = await supabase.storage
      .from("recordings")
      .createSignedUploadUrl(path, { upsert: true });
    if (signErr || !signed) {
      throw signErr ?? new Error("업로드 URL 발급 실패");
    }

    const task = FileSystem.createUploadTask(
      signed.signedUrl,
      item.localUri,
      {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          "Content-Type": CONTENT_TYPES[ext] ?? "audio/mp4",
          "x-upsert": "true",
        },
      },
      (p) => {
        if (p.totalBytesExpectedToSend > 0) {
          onProgress?.(item.id, p.totalBytesSent / p.totalBytesExpectedToSend);
        }
      }
    );
    activeTasks.set(item.id, task);
    const res = await task.uploadAsync();
    activeTasks.delete(item.id);

    if (!res) {
      // 사용자 취소 — cancelAndRemove가 정리하므로 여기서는 조용히 실패 처리
      item.lastError = "업로드가 취소됐습니다.";
      return item;
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`업로드 실패 (HTTP ${res.status})`);
    }

    await supabase
      .from("recordings")
      .update({ storage_path: path, status: "uploaded" })
      .eq("id", item.recordingId);

    // STT는 결과를 기다리지 않는다. 실패해도 상세에서 "다시 변환" 가능.
    supabase.functions.invoke("transcribe", {
      body: { recording_id: item.recordingId },
    });

    onProgress?.(item.id, 1);
    return null;
  } catch (e) {
    activeTasks.delete(item.id);
    item.lastError = e instanceof Error ? e.message : String(e);
    return item;
  }
}

// 큐 처리: 새 항목만 자동 업로드(실패 항목은 수동 재시도). 남은 항목 수 반환.
export async function processQueue(
  userId: string,
  onProgress?: ProgressFn
): Promise<number> {
  const queue = await loadQueue();
  const remaining: QueueItem[] = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (cancelledIds.has(item.id)) continue;
    if (item.lastError) {
      // 실패 항목은 자동 재시도하지 않음 — 카드 탭으로 개별 재업로드
      remaining.push(item);
      continue;
    }
    const failed = await syncItem(item, userId, onProgress);
    if (failed && !cancelledIds.has(failed.id)) remaining.push(failed);
    await saveQueue([...remaining, ...queue.slice(i + 1)]);
  }
  await saveQueue(remaining);
  return remaining.length;
}

// 실패 항목 1건 재업로드. 성공하면 true.
export async function retryItem(
  itemId: string,
  userId: string,
  onProgress?: ProgressFn
): Promise<boolean> {
  const queue = await loadQueue();
  const idx = queue.findIndex((q) => q.id === itemId);
  if (idx < 0) return false;
  const item = { ...queue[idx], lastError: undefined };
  const failed = await syncItem(item, userId, onProgress);
  const rest = queue.filter((q) => q.id !== itemId);
  if (failed && !cancelledIds.has(failed.id)) rest.unshift(failed);
  await saveQueue(rest);
  return failed === null;
}
