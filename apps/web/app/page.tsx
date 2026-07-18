"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import type {
  NoteWithRecordings,
  RecordingStatus,
  Transcript,
} from "@chwijae/core";
import { supabase } from "../lib/supabase";

const RECORDING_STATUS_LABEL: Record<RecordingStatus, string> = {
  uploading: "업로드 중",
  uploaded: "변환 대기",
  transcribing: "변환 중…",
  done: "변환 완료",
  failed: "변환 실패",
};

const RECORDING_STATUS_CLASS: Record<RecordingStatus, string> = {
  uploading: "busy",
  uploaded: "wait",
  transcribing: "busy",
  done: "done",
  failed: "failed",
};

function errorMessage(message: string): string {
  if (message.includes("Invalid login credentials"))
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (message.includes("already registered"))
    return "이미 가입된 이메일입니다.";
  if (message.includes("at least 6 characters"))
    return "비밀번호는 6자 이상이어야 합니다.";
  return message;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

// 재생 위치에 맞는 단어를 강조하고, 단어 클릭 시 해당 시점으로 이동
function SyncedTranscript({
  transcript,
  currentTime,
  onSeek,
}: {
  transcript: Transcript;
  currentTime: number;
  onSeek: (sec: number) => void;
}) {
  if (!transcript.words || transcript.words.length === 0) {
    return <p className="transcript">{transcript.raw_text}</p>;
  }
  return (
    <p className="transcript">
      {transcript.words.map((w, i) => {
        const active = currentTime >= w.start && currentTime < w.end;
        return (
          <span
            key={i}
            className={active ? "word active" : "word"}
            onClick={() => onSeek(w.start)}
            title={`${w.start.toFixed(1)}초`}
          >
            {w.word}{" "}
          </span>
        );
      })}
    </p>
  );
}

function LoginForm() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
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
    <main className="login-wrap">
      <form onSubmit={handleSubmit} className="login-card">
        <h1>
          취재수첩<span style={{ color: "var(--rec)" }}>.</span>
        </h1>
        <p className="login-sub">
          {mode === "login"
            ? "기자 계정으로 로그인하세요."
            : "새 계정을 만듭니다."}
        </p>
        <input
          className="field"
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="field"
          type="password"
          placeholder="비밀번호 (6자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        {notice && <p className="form-error">{notice}</p>}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setNotice("");
          }}
        >
          {mode === "login"
            ? "계정이 없나요? 회원가입"
            : "이미 계정이 있나요? 로그인"}
        </button>
      </form>
    </main>
  );
}

function NoteList({ session }: { session: Session }) {
  const [notes, setNotes] = useState<NoteWithRecordings[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [transcribing, setTranscribing] = useState<string | null>(null);
  const [player, setPlayer] = useState<{
    recordingId: string;
    url: string;
  } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [editingTitle, setEditingTitle] = useState<{
    noteId: string;
    value: string;
  } | null>(null);
  const [editingTranscript, setEditingTranscript] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({});

  async function loadNotes() {
    const { data, error } = await supabase
      .from("notes")
      .select("*, recordings(*, transcripts(*))")
      .order("updated_at", { ascending: false });
    if (!error && data) setNotes(data as NoteWithRecordings[]);
    setLoading(false);
  }

  useEffect(() => {
    loadNotes();
  }, []);

  async function createNote() {
    const { error } = await supabase.from("notes").insert({
      user_id: session.user.id,
      title: `새 취재 메모 ${new Date().toLocaleString("ko-KR")}`,
    });
    if (!error) loadNotes();
  }

  // 통화녹음 등 외부 음성 파일 업로드 → 녹음과 동일한 STT 파이프라인
  async function uploadAudioFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const contentTypes: Record<string, string> = {
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
    };
    if (!contentTypes[ext]) {
      alert("mp3 또는 m4a 파일만 업로드할 수 있습니다.");
      return;
    }
    setUploading(true);
    try {
      const { data: note, error: noteErr } = await supabase
        .from("notes")
        .insert({ user_id: session.user.id, title: file.name, status: "active" })
        .select()
        .single();
      if (noteErr) throw noteErr;

      const { data: rec, error: recErr } = await supabase
        .from("recordings")
        .insert({
          note_id: note.id,
          user_id: session.user.id,
          storage_path: "",
          status: "uploading",
        })
        .select()
        .single();
      if (recErr) throw recErr;

      const path = `${session.user.id}/${rec.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("recordings")
        .upload(path, file, { contentType: contentTypes[ext] });
      if (upErr) throw upErr;

      await supabase
        .from("recordings")
        .update({ storage_path: path, status: "uploaded" })
        .eq("id", rec.id);
      supabase.functions.invoke("transcribe", {
        body: { recording_id: rec.id },
      });
      loadNotes();
    } catch (e) {
      alert(`업로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  async function saveTitle() {
    if (!editingTitle) return;
    const title = editingTitle.value.trim();
    if (title) {
      await supabase
        .from("notes")
        .update({ title })
        .eq("id", editingTitle.noteId);
    }
    setEditingTitle(null);
    loadNotes();
  }

  async function deleteNote(note: NoteWithRecordings) {
    if (
      !confirm(
        `"${note.title}" 노트를 삭제할까요?\n녹음 파일과 변환 텍스트도 함께 삭제되며 되돌릴 수 없습니다.`
      )
    )
      return;
    const paths = note.recordings
      .map((r) => r.storage_path)
      .filter((p) => p.length > 0);
    if (paths.length > 0) {
      await supabase.storage.from("recordings").remove(paths);
    }
    await supabase.from("notes").delete().eq("id", note.id);
    loadNotes();
  }

  async function saveTranscript() {
    if (!editingTranscript) return;
    await supabase
      .from("transcripts")
      .update({ edited_text: editingTranscript.value })
      .eq("id", editingTranscript.id);
    setEditingTranscript(null);
    loadNotes();
  }

  async function revertTranscript(t: Transcript) {
    if (!confirm("편집본을 지우고 변환 원문으로 되돌릴까요?")) return;
    await supabase
      .from("transcripts")
      .update({ edited_text: null })
      .eq("id", t.id);
    loadNotes();
  }

  // 비공개 버킷이므로 1시간짜리 서명 URL을 발급받아 재생한다.
  async function playRecording(recordingId: string, storagePath: string) {
    const { data, error } = await supabase.storage
      .from("recordings")
      .createSignedUrl(storagePath, 3600);
    if (error || !data) {
      alert(`재생 실패: ${error?.message}`);
      return;
    }
    setCurrentTime(0);
    setPlayer({ recordingId, url: data.signedUrl });
  }

  function seekTo(sec: number) {
    if (audioRef.current) {
      audioRef.current.currentTime = sec;
      audioRef.current.play();
    }
  }

  async function requestTranscribe(recordingId: string) {
    setTranscribing(recordingId);
    const { data, error } = await supabase.functions.invoke("transcribe", {
      body: { recording_id: recordingId },
    });
    if (error || data?.error) {
      alert(`변환 실패: ${error?.message ?? data?.error}`);
    }
    setTranscribing(null);
    loadNotes();
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? notes.filter((n) => {
        const inTitle = n.title.toLowerCase().includes(q);
        const inMemo = n.memo.toLowerCase().includes(q);
        const inTranscript = n.recordings.some((r) =>
          r.transcripts.some((t) =>
            (t.edited_text ?? t.raw_text ?? "").toLowerCase().includes(q)
          )
        );
        return inTitle || inMemo || inTranscript;
      })
    : notes;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            취재수첩<span className="dot">.</span>
          </div>
          <div className="topbar-user">
            <span>{session.user.email}</span>
            <button
              className="btn-ghost"
              onClick={() => supabase.auth.signOut()}
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>
      <main className="container">
        <div className="toolbar">
          <input
            className="search"
            placeholder="제목·내용 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" onClick={createNote}>
            + 새 노트
          </button>
          <label className="btn" style={{ cursor: "pointer" }}>
            {uploading ? "업로드 중…" : "🎧 파일 업로드"}
            <input
              type="file"
              accept=".mp3,.m4a,audio/mpeg,audio/mp4,audio/x-m4a"
              style={{ display: "none" }}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAudioFile(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        {loading ? (
          <p className="empty">불러오는 중…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">
            {q
              ? "검색 결과가 없습니다."
              : "아직 노트가 없습니다. 모바일 앱에서 녹음하거나 \"+ 새 노트\"로 시작하세요."}
          </p>
        ) : (
          filtered.map((n) => (
            <article key={n.id} className="note-card">
              <div className="note-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingTitle?.noteId === n.id ? (
                    <input
                      className="note-title-input"
                      value={editingTitle.value}
                      autoFocus
                      onChange={(e) =>
                        setEditingTitle({ noteId: n.id, value: e.target.value })
                      }
                      onBlur={saveTitle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveTitle();
                        if (e.key === "Escape") setEditingTitle(null);
                      }}
                    />
                  ) : (
                    <div
                      className="note-title"
                      title="클릭해서 제목 수정"
                      onClick={() =>
                        setEditingTitle({ noteId: n.id, value: n.title })
                      }
                    >
                      {n.title || "(제목 없음)"}
                    </div>
                  )}
                  <div className="note-meta">
                    {new Date(n.updated_at).toLocaleString("ko-KR")}
                  </div>
                  {n.memo && (
                    <div className="note-memo">✎ {n.memo}</div>
                  )}
                </div>
                <button
                  className="btn-ghost danger"
                  onClick={() => deleteNote(n)}
                >
                  삭제
                </button>
              </div>

              {n.recordings.map((r) => (
                <div key={r.id} className="recording-box">
                  <div className="recording-row">
                    <span>🎙️ {formatDuration(r.duration_sec)}</span>
                    <span className={`pill ${RECORDING_STATUS_CLASS[r.status]}`}>
                      {RECORDING_STATUS_LABEL[r.status]}
                    </span>
                    {r.storage_path && (
                      <button
                        className="btn-ghost"
                        onClick={() => playRecording(r.id, r.storage_path)}
                      >
                        ▶ 재생
                      </button>
                    )}
                    {(r.status === "uploaded" ||
                      r.status === "failed" ||
                      r.status === "done") && (
                      <button
                        className="btn-ghost"
                        disabled={transcribing === r.id}
                        onClick={() => requestTranscribe(r.id)}
                      >
                        {transcribing === r.id
                          ? "변환 중…"
                          : r.status === "done"
                            ? "다시 변환"
                            : "텍스트 변환"}
                      </button>
                    )}
                  </div>
                  {player?.recordingId === r.id && (
                    <audio
                      ref={audioRef}
                      controls
                      autoPlay
                      src={player.url}
                      onTimeUpdate={(e) =>
                        setCurrentTime(e.currentTarget.currentTime)
                      }
                    />
                  )}
                  {r.transcripts.map((t) => {
                    const isEditing = editingTranscript?.id === t.id;
                    const hasEdited = t.edited_text != null;
                    const showingRaw = !hasEdited || showRaw[t.id];

                    if (isEditing) {
                      return (
                        <div key={t.id}>
                          <textarea
                            className="transcript-editor"
                            value={editingTranscript.value}
                            autoFocus
                            onChange={(e) =>
                              setEditingTranscript({
                                id: t.id,
                                value: e.target.value,
                              })
                            }
                          />
                          <div className="transcript-tools">
                            <button className="btn-ghost" onClick={saveTranscript}>
                              저장
                            </button>
                            <button
                              className="btn-ghost danger"
                              onClick={() => setEditingTranscript(null)}
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={t.id}>
                        {showingRaw ? (
                          <SyncedTranscript
                            transcript={t}
                            currentTime={
                              player?.recordingId === r.id ? currentTime : -1
                            }
                            onSeek={(sec) => {
                              if (player?.recordingId === r.id) seekTo(sec);
                              else playRecording(r.id, r.storage_path);
                            }}
                          />
                        ) : (
                          <p className="transcript">{t.edited_text}</p>
                        )}
                        <div className="transcript-tools">
                          {hasEdited && (
                            <span className="badge-edited">
                              {showingRaw ? "원문(동기화) 보기 중" : "편집됨"}
                            </span>
                          )}
                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setEditingTranscript({
                                id: t.id,
                                value: t.edited_text ?? t.raw_text ?? "",
                              })
                            }
                          >
                            ✏️ 편집
                          </button>
                          {hasEdited && (
                            <>
                              <button
                                className="btn-ghost"
                                onClick={() =>
                                  setShowRaw({
                                    ...showRaw,
                                    [t.id]: !showRaw[t.id],
                                  })
                                }
                              >
                                {showingRaw ? "편집본 보기" : "원문 보기"}
                              </button>
                              <button
                                className="btn-ghost danger"
                                onClick={() => revertTranscript(t)}
                              >
                                원문으로 복원
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </article>
          ))
        )}
      </main>
    </>
  );
}

export default function HomePage() {
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

  if (!ready) return null;
  return session ? <NoteList session={session} /> : <LoginForm />;
}
