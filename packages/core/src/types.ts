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

// 노트에 붙는 자유 태그 (예: {name:"분야", value:"축산"}, {name:"취재원", value:"김과장"})
export interface NoteTag {
  name: string;
  value: string;
}

export interface Note {
  id: string;
  user_id: string;
  title: string;
  memo: string;
  status: NoteStatus;
  tags: NoteTag[] | null;
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

// 화자 분리 세그먼트 (speaker는 "1","2"… 정규화된 라벨)
export interface SpeakerSegment {
  speaker: string;
  text: string;
  start?: number;
  end?: number;
}

export interface Transcript {
  id: string;
  recording_id: string;
  raw_text: string | null;
  edited_text: string | null;
  words: TranscriptWord[] | null;
  diarized: SpeakerSegment[] | null;
  refined: SpeakerSegment[] | null;
  summary: string | null;
  speaker_names: Record<string, string> | null;
  stt_engine: string;
  created_at: string;
}

export interface Memo {
  id: string;
  user_id: string;
  body: string;
  note_id: string | null;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
}
