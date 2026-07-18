"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import type {
  Memo,
  Note,
  Recording,
  RecordingStatus,
  SpeakerSegment,
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

function speakerLabel(names: Record<string, string>, sp: string): string {
  return names[sp] ?? `화자 ${sp}`;
}

/* ================= 로그인 ================= */

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

/* ================= 목록 ================= */

type ListNote = Note & {
  memos: { id: string; body: string }[];
  recordings: {
    id: string;
    status: RecordingStatus;
    duration_sec: number | null;
    transcripts: { summary: string | null; raw_text: string | null }[];
  }[];
};

function notePreview(n: ListNote): string | null {
  for (const r of n.recordings) {
    const t = r.transcripts?.[0];
    if (t?.summary) return t.summary;
    if (t?.raw_text) {
      const snip = t.raw_text.slice(0, 120);
      return t.raw_text.length > 120 ? `${snip}…` : snip;
    }
  }
  return null;
}

function NoteListView({
  session,
  onOpen,
}: {
  session: Session;
  onOpen: (id: string) => void;
}) {
  const [notes, setNotes] = useState<ListNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  const loadNotes = useCallback(async () => {
    const { data, error } = await supabase
      .from("notes")
      .select(
        "*, memos(id, body), recordings(id, status, duration_sec, transcripts(summary, raw_text))"
      )
      .order("updated_at", { ascending: false });
    if (!error && data) setNotes(data as ListNote[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

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

  async function deleteNote(note: ListNote) {
    if (
      !confirm(
        `"${note.title}" 노트를 삭제할까요?\n녹음 파일과 변환 텍스트도 함께 삭제되며 되돌릴 수 없습니다.`
      )
    )
      return;
    const { data: recs } = await supabase
      .from("recordings")
      .select("storage_path")
      .eq("note_id", note.id);
    const paths = (recs ?? [])
      .map((r) => r.storage_path)
      .filter((p) => p && p.length > 0);
    if (paths.length > 0) {
      await supabase.storage.from("recordings").remove(paths);
    }
    await supabase.from("notes").delete().eq("id", note.id);
    loadNotes();
  }

  const q = search.trim().toLowerCase();
  const filtered = q
    ? notes.filter((n) => {
        const inTitle = n.title.toLowerCase().includes(q);
        const inMemos = n.memos.some((m) => m.body.toLowerCase().includes(q));
        const inText = n.recordings.some((r) =>
          r.transcripts.some(
            (t) =>
              (t.summary ?? "").toLowerCase().includes(q) ||
              (t.raw_text ?? "").toLowerCase().includes(q)
          )
        );
        return inTitle || inMemos || inText;
      })
    : notes;

  return (
    <main className="container">
      <div className="toolbar">
        <input
          className="search"
          placeholder="제목·메모·내용 검색"
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
          {q ? "검색 결과가 없습니다." : "아직 노트가 없습니다."}
        </p>
      ) : (
        filtered.map((n) => {
          const rec = n.recordings[0];
          const preview = notePreview(n);
          return (
            <article
              key={n.id}
              className="note-card clickable"
              onClick={() => onOpen(n.id)}
            >
              <div className="note-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="note-title">{n.title || "(제목 없음)"}</div>
                  <div className="note-meta">
                    {new Date(n.updated_at).toLocaleString("ko-KR")}
                    {rec?.duration_sec != null
                      ? ` · ${formatDuration(rec.duration_sec)}`
                      : ""}
                  </div>
                </div>
                {rec && (
                  <span className={`pill ${RECORDING_STATUS_CLASS[rec.status]}`}>
                    {RECORDING_STATUS_LABEL[rec.status]}
                  </span>
                )}
                <button
                  className="btn-ghost danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNote(n);
                  }}
                >
                  삭제
                </button>
              </div>
              {preview && <p className="note-preview">{preview}</p>}
              {n.memos[0] && (
                <div className="note-memo">✎ {n.memos[0].body}</div>
              )}
            </article>
          );
        })
      )}
    </main>
  );
}

/* ================= 상세 ================= */

type FullNote = Note & {
  memos: Memo[];
  recordings: (Recording & { transcripts: Transcript[] })[];
};

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

function download(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function NoteDetail({
  noteId,
  onBack,
}: {
  noteId: string;
  onBack: () => void;
}) {
  const [note, setNote] = useState<FullNote | null>(null);
  const [tab, setTab] = useState<"refined" | "raw">("refined");
  const [player, setPlayer] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [qa, setQa] = useState<{ q: string; a: string }[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("notes")
      .select("*, memos(*), recordings(*, transcripts(*))")
      .eq("id", noteId)
      .single();
    if (data) setNote(data as FullNote);
  }, [noteId]);

  useEffect(() => {
    load();
  }, [load]);

  const rec = note?.recordings?.[0];
  const t = rec?.transcripts?.[0];
  const names = (t?.speaker_names ?? {}) as Record<string, string>;
  const refined = t?.refined ?? null;
  const hasRefined = Array.isArray(refined) && refined.length > 0;
  const activeTab = hasRefined ? tab : "raw";

  async function saveTitle() {
    if (editingTitle == null || !note) return;
    const title = editingTitle.trim();
    if (title) {
      await supabase.from("notes").update({ title }).eq("id", note.id);
    }
    setEditingTitle(null);
    load();
  }

  async function playRecording() {
    if (!rec?.storage_path) return;
    const { data, error } = await supabase.storage
      .from("recordings")
      .createSignedUrl(rec.storage_path, 3600);
    if (error || !data) {
      alert(`재생 실패: ${error?.message}`);
      return;
    }
    setCurrentTime(0);
    setPlayer(data.signedUrl);
  }

  function seekTo(sec: number) {
    if (audioRef.current) {
      audioRef.current.currentTime = sec;
      audioRef.current.play();
    }
  }

  async function requestTranscribe() {
    if (!rec) return;
    setTranscribing(true);
    const { data, error } = await supabase.functions.invoke("transcribe", {
      body: { recording_id: rec.id },
    });
    if (error || data?.error) {
      alert(`변환 실패: ${error?.message ?? data?.error}`);
    }
    setTranscribing(false);
    load();
  }

  async function renameSpeaker(sp: string) {
    if (!t) return;
    const current = names[sp] ?? "";
    const next = prompt(`화자 ${sp}의 이름 (비우면 "화자 ${sp}")`, current);
    if (next === null) return;
    const updated = { ...names };
    if (next.trim()) updated[sp] = next.trim();
    else delete updated[sp];
    await supabase
      .from("transcripts")
      .update({ speaker_names: updated })
      .eq("id", t.id);
    load();
  }

  async function saveEditedText() {
    if (editingText == null || !t) return;
    await supabase
      .from("transcripts")
      .update({ edited_text: editingText })
      .eq("id", t.id);
    setEditingText(null);
    load();
  }

  function buildExport(markdown: boolean): string {
    if (!note) return "";
    const head = markdown ? `# ${note.title}\n\n` : `${note.title}\n`;
    const date = `${new Date(note.updated_at).toLocaleString("ko-KR")}\n\n`;
    let body = "";
    if (activeTab === "refined" && hasRefined) {
      body = (refined as SpeakerSegment[])
        .map((seg) =>
          markdown
            ? `**${speakerLabel(names, seg.speaker)}:** ${seg.text}`
            : `${speakerLabel(names, seg.speaker)}: ${seg.text}`
        )
        .join("\n\n");
    } else {
      body = t?.edited_text ?? t?.raw_text ?? "(변환된 텍스트 없음)";
    }
    return head + date + body + "\n";
  }

  function exportAs(format: "txt" | "md" | "pdf") {
    setFabOpen(false);
    if (!note) return;
    const safe = note.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    if (format === "pdf") {
      // 인쇄 다이얼로그에서 "PDF로 저장" 선택
      const w = window.open("", "_blank");
      if (!w) return;
      const body =
        activeTab === "refined" && hasRefined
          ? (refined as SpeakerSegment[])
              .map(
                (seg) =>
                  `<p><b style="color:#5F7749">${speakerLabel(names, seg.speaker)}:</b> ${seg.text}</p>`
              )
              .join("")
          : `<p>${(t?.edited_text ?? t?.raw_text ?? "").replace(/\n/g, "<br>")}</p>`;
      w.document.write(
        `<html><head><meta charset="utf-8"><title>${note.title}</title>
        <style>body{font-family:sans-serif;line-height:1.8;padding:32px;color:#2B2F28;max-width:720px;margin:0 auto}
        h1{font-size:20px}.meta{color:#757A6B;font-size:12px;margin-bottom:24px}</style></head>
        <body><h1>${note.title}</h1>
        <div class="meta">${new Date(note.updated_at).toLocaleString("ko-KR")} · 취재수첩</div>
        ${body}</body></html>`
      );
      w.document.close();
      w.focus();
      w.print();
    } else {
      download(
        `${safe}.${format}`,
        buildExport(format === "md"),
        format === "md" ? "text/markdown" : "text/plain"
      );
    }
  }

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || !rec || asking) return;
    setAsking(true);
    setQuestion("");
    try {
      const { data, error } = await supabase.functions.invoke("ask", {
        body: { recording_id: rec.id, question: q },
      });
      if (error || data?.error) throw new Error(error?.message ?? data?.error);
      setQa((prev) => [...prev, { q, a: data.answer }]);
    } catch (err) {
      setQa((prev) => [
        ...prev,
        { q, a: `오류: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setAsking(false);
    }
  }

  if (!note) return <main className="container">불러오는 중…</main>;

  return (
    <main className="container detail">
      <button className="btn-ghost" onClick={onBack} style={{ marginBottom: 8 }}>
        ‹ 목록으로
      </button>

      {editingTitle != null ? (
        <input
          className="note-title-input"
          value={editingTitle}
          autoFocus
          onChange={(e) => setEditingTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveTitle();
            if (e.key === "Escape") setEditingTitle(null);
          }}
        />
      ) : (
        <h1
          className="detail-title"
          title="클릭해서 제목 수정"
          onClick={() => setEditingTitle(note.title)}
        >
          {note.title}
        </h1>
      )}
      <div className="note-meta" style={{ marginBottom: 16 }}>
        {new Date(note.updated_at).toLocaleString("ko-KR")}
        {rec?.duration_sec != null ? ` · ${formatDuration(rec.duration_sec)}` : ""}
        {rec && (
          <>
            {" · "}
            <span className={`pill ${RECORDING_STATUS_CLASS[rec.status]}`}>
              {RECORDING_STATUS_LABEL[rec.status]}
            </span>
          </>
        )}
      </div>

      {note.memos.length > 0 && (
        <div className="memo-block">
          <div className="memo-block-label">✎ 메모</div>
          {note.memos.map((m) => (
            <p key={m.id}>{m.body}</p>
          ))}
        </div>
      )}

      {rec?.storage_path && (
        <div style={{ marginBottom: 14 }}>
          {player ? (
            <audio
              ref={audioRef}
              controls
              autoPlay
              src={player}
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            />
          ) : (
            <button className="btn" onClick={playRecording}>
              ▶ 녹음 재생
            </button>
          )}
          {(rec.status === "uploaded" ||
            rec.status === "failed" ||
            rec.status === "done") && (
            <button
              className="btn-ghost"
              disabled={transcribing}
              onClick={requestTranscribe}
              style={{ marginLeft: 8 }}
            >
              {transcribing
                ? "변환 중…"
                : rec.status === "done"
                  ? "다시 변환"
                  : "텍스트 변환"}
            </button>
          )}
        </div>
      )}

      {hasRefined && (
        <div className="tabs">
          <button
            className={activeTab === "refined" ? "tab on" : "tab"}
            onClick={() => setTab("refined")}
          >
            다듬은 버전
          </button>
          <button
            className={activeTab === "raw" ? "tab on" : "tab"}
            onClick={() => setTab("raw")}
          >
            원문 (재생 동기화)
          </button>
        </div>
      )}

      {activeTab === "refined" && hasRefined ? (
        <div className="segments">
          {(refined as SpeakerSegment[]).map((seg, i) => (
            <div key={i} className="segment">
              <button
                className="speaker-chip"
                title="클릭해서 화자 이름 수정"
                onClick={() => renameSpeaker(seg.speaker)}
              >
                {speakerLabel(names, seg.speaker)}
              </button>
              <p>{seg.text}</p>
            </div>
          ))}
          <p className="hint-text">화자 이름을 클릭하면 수정할 수 있습니다</p>
        </div>
      ) : t ? (
        editingText != null ? (
          <div>
            <textarea
              className="transcript-editor"
              value={editingText}
              autoFocus
              onChange={(e) => setEditingText(e.target.value)}
            />
            <div className="transcript-tools">
              <button className="btn-ghost" onClick={saveEditedText}>
                저장
              </button>
              <button
                className="btn-ghost danger"
                onClick={() => setEditingText(null)}
              >
                취소
              </button>
            </div>
          </div>
        ) : (
          <div>
            {t.edited_text != null ? (
              <p className="transcript">{t.edited_text}</p>
            ) : (
              <SyncedTranscript
                transcript={t}
                currentTime={player ? currentTime : -1}
                onSeek={(sec) => {
                  if (player) seekTo(sec);
                  else playRecording();
                }}
              />
            )}
            <div className="transcript-tools">
              {t.edited_text != null && (
                <span className="badge-edited">편집됨</span>
              )}
              <button
                className="btn-ghost"
                onClick={() =>
                  setEditingText(t.edited_text ?? t.raw_text ?? "")
                }
              >
                ✏️ 편집
              </button>
              {t.edited_text != null && (
                <button
                  className="btn-ghost danger"
                  onClick={async () => {
                    if (!confirm("편집본을 지우고 변환 원문으로 되돌릴까요?"))
                      return;
                    await supabase
                      .from("transcripts")
                      .update({ edited_text: null })
                      .eq("id", t.id);
                    load();
                  }}
                >
                  원문으로 복원
                </button>
              )}
            </div>
          </div>
        )
      ) : (
        <p className="empty">아직 변환된 텍스트가 없습니다.</p>
      )}

      {qa.length > 0 && (
        <div className="qa-list">
          {qa.map((item, i) => (
            <div key={i} className="qa-card">
              <div className="qa-q">Q. {item.q}</div>
              <div className="qa-a">{item.a}</div>
            </div>
          ))}
        </div>
      )}

      {/* 플로팅 메뉴 */}
      {fabOpen && (
        <div className="fab-menu">
          <button
            className="fab-item"
            onClick={() => {
              setFabOpen(false);
              setAskOpen(true);
            }}
          >
            💬 질문하기
          </button>
          <button className="fab-item" onClick={() => exportAs("pdf")}>
            📄 PDF로 내보내기
          </button>
          <button className="fab-item" onClick={() => exportAs("txt")}>
            📃 TXT로 내보내기
          </button>
          <button className="fab-item" onClick={() => exportAs("md")}>
            Ⓜ️ MD로 내보내기
          </button>
        </div>
      )}
      <button className="fab" onClick={() => setFabOpen((v) => !v)}>
        {fabOpen ? "×" : "⋯"}
      </button>

      {askOpen && (
        <form className="ask-bar" onSubmit={ask}>
          <input
            className="ask-input"
            placeholder="이 녹음에 대해 질문하세요"
            value={question}
            autoFocus
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button className="ask-send" type="submit" disabled={asking}>
            {asking ? "…" : "↑"}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setAskOpen(false)}
          >
            ×
          </button>
        </form>
      )}
    </main>
  );
}

/* ================= 루트 ================= */

function Workspace({ session }: { session: Session }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand" style={{ cursor: "pointer" }} onClick={() => setSelectedId(null)}>
            취재수첩<span className="dot">.</span>
          </div>
          <div className="topbar-user">
            <span>{session.user.email}</span>
            <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>
              로그아웃
            </button>
          </div>
        </div>
      </header>
      {selectedId ? (
        <NoteDetail noteId={selectedId} onBack={() => setSelectedId(null)} />
      ) : (
        <NoteListView session={session} onOpen={setSelectedId} />
      )}
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
  return session ? <Workspace session={session} /> : <LoginForm />;
}
