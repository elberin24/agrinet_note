export type NoteStatus = "draft" | "active" | "archived";
export type RecordingStatus =
  | "uploading"
  | "uploaded"
  | "transcribing"
  | "done"
  | "failed";

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  created_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  title: string;
  memo: string;
  status: NoteStatus;
  created_at: string;
  updated_at: string;
}

export interface Recording {
  id: string;
  note_id: string;
  user_id: string;
  storage_path: string;
  duration_sec: number | null;
  status: RecordingStatus;
  created_at: string;
}

// notes → recordings → transcripts 중첩 조회 결과용
export interface RecordingWithTranscripts extends Recording {
  transcripts: Transcript[];
}

export interface NoteWithRecordings extends Note {
  recordings: RecordingWithTranscripts[];
}

// whisper-1 verbose_json의 단어별 타임스탬프 (초 단위)
export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface Transcript {
  id: string;
  recording_id: string;
  raw_text: string | null;
  edited_text: string | null;
  words: TranscriptWord[] | null;
  stt_engine: string;
  created_at: string;
}
