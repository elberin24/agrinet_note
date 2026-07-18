// 취재수첩 — STT Edge Function (v2)
// 파이프라인: ① whisper-1 원문+단어타임스탬프 → ② gpt-4o-transcribe-diarize 화자분리
//           → ③ GPT 다듬기+한줄요약. ②③은 실패해도 ①원문은 저장된다.
import { createClient } from "npm:@supabase/supabase-js@2";

const RAW_MODEL = "whisper-1"; // 단어 타임스탬프(재생 동기화) 지원
const DIARIZE_MODEL = "gpt-4o-transcribe-diarize"; // 화자 분리
const REFINE_MODEL = "gpt-4o-mini"; // 다듬기·요약 (저렴, 충분)

// 농축수산 전문용어 사전 — 프롬프트로 주입해 오인식을 줄인다.
const GLOSSARY = [
  "농림축산식품부", "해양수산부", "농촌진흥청", "산림청", "농협", "수협", "축협",
  "한국농어민신문", "공익직불제", "농지연금", "수매비축", "의무자조금",
  "가축전염병예방법", "럼피스킨", "아프리카돼지열병", "ASF",
  "고병원성 조류인플루엔자", "구제역", "가축분뇨", "축산악취",
  "한우", "한돈", "육계", "산란계", "낙농", "원유가격", "사료값",
  "총허용어획량", "TAC", "수산자원관리법", "어촌계", "양식장", "김 양식",
  "굴 양식", "전복", "넙치", "수산물 이력제", "어획량", "위판장",
  "스마트팜", "시설원예", "노지채소", "밭작물", "논타작물", "쌀값",
  "공공비축미", "농산물 가격안정제", "채소가격안정제", "농작물재해보험",
].join(", ");

const PROMPT = `한국 농업·축산·수산 분야 취재 녹음입니다. 요약하거나 다듬지 말고 들리는 그대로 전부 받아 적으세요. 같은 문장이 반복되면 반복된 횟수만큼 모두 기록하세요. 등장 가능한 용어: ${GLOSSARY}`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const OPENAI_KEY = () => Deno.env.get("OPENAI_API_KEY");

async function transcriptionRequest(form: FormData): Promise<Response> {
  return fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY()}` },
    body: form,
  });
}

interface Segment {
  speaker: string;
  text: string;
  start?: number;
  end?: number;
}

// 화자 라벨(A/B/spk_0 등)을 등장 순서대로 "1","2"…로 정규화
function normalizeSpeakers(segments: Segment[]): Segment[] {
  const map = new Map<string, string>();
  return segments.map((s) => {
    if (!map.has(s.speaker)) map.set(s.speaker, String(map.size + 1));
    return { ...s, speaker: map.get(s.speaker)! };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let recordingId: string | undefined;

  try {
    const { recording_id } = await req.json();
    recordingId = recording_id;
    if (!recording_id) return json({ error: "recording_id가 필요합니다." }, 400);

    // 호출한 사용자 확인 (본인 녹음만 변환 가능)
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다." }, 401);

    const { data: rec, error: recErr } = await admin
      .from("recordings")
      .select("*")
      .eq("id", recording_id)
      .single();
    if (recErr || !rec || rec.user_id !== user.id) {
      return json({ error: "녹음을 찾을 수 없습니다." }, 404);
    }
    if (!rec.storage_path) {
      return json({ error: "업로드가 완료되지 않은 녹음입니다." }, 409);
    }

    await admin.from("recordings").update({ status: "transcribing" }).eq("id", rec.id);

    const { data: file, error: dlErr } = await admin.storage
      .from("recordings")
      .download(rec.storage_path);
    if (dlErr || !file) throw new Error(`파일 다운로드 실패: ${dlErr?.message}`);

    // 확장자 유지 — OpenAI가 파일명으로 포맷(mp3/m4a)을 인식한다
    const fileName = rec.storage_path.split("/").pop() ?? "audio.m4a";

    // ① 원문 + 단어 타임스탬프 (필수 — 실패하면 전체 실패)
    const rawForm = new FormData();
    rawForm.append("file", file, fileName);
    rawForm.append("model", RAW_MODEL);
    rawForm.append("language", "ko");
    rawForm.append("prompt", PROMPT);
    rawForm.append("response_format", "verbose_json");
    rawForm.append("timestamp_granularities[]", "word");
    const rawRes = await transcriptionRequest(rawForm);
    if (!rawRes.ok) {
      throw new Error(`원문 변환 오류 ${rawRes.status}: ${await rawRes.text()}`);
    }
    const { text, words } = await rawRes.json();

    // ② 화자 분리 (실패해도 계속)
    let diarized: Segment[] | null = null;
    try {
      const dForm = new FormData();
      dForm.append("file", file, fileName);
      dForm.append("model", DIARIZE_MODEL);
      dForm.append("response_format", "diarized_json");
      dForm.append("chunking_strategy", "auto");
      const dRes = await transcriptionRequest(dForm);
      if (dRes.ok) {
        const dJson = await dRes.json();
        const segs = (dJson.segments ?? []) as Array<{
          speaker?: string; text?: string; start?: number; end?: number;
        }>;
        if (segs.length > 0) {
          diarized = normalizeSpeakers(
            segs.map((s) => ({
              speaker: String(s.speaker ?? "?"),
              text: s.text ?? "",
              start: s.start,
              end: s.end,
            })),
          );
        }
      } else {
        console.error("diarize 실패:", dRes.status, await dRes.text());
      }
    } catch (e) {
      console.error("diarize 예외:", e);
    }

    // ③ 다듬기 + 한줄요약 (실패해도 계속)
    let refined: Segment[] | null = null;
    let summary: string | null = null;
    try {
      const source = diarized
        ? JSON.stringify(diarized.map(({ speaker, text }) => ({ speaker, text })))
        : JSON.stringify([{ speaker: "1", text }]);
      const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_KEY()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: REFINE_MODEL,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                `한국 농업·축산·수산 전문지의 취재 녹취 정리 도우미다. 화자별 녹취 세그먼트를 받아 아래 규칙으로 다듬는다.\n` +
                `규칙: 1) 사실·수치·주장·발언 내용은 절대 바꾸지 않는다 2) 추임새(네, 아, 그, 어, 음 등)와 무의미한 반복만 제거한다 3) 문장을 자연스럽게 다듬는다 4) 오인식된 전문용어를 교정한다 (참고 용어: ${GLOSSARY}) 5) speaker 값은 그대로 유지한다 6) 인접한 같은 화자의 짧은 세그먼트는 합쳐도 된다.\n` +
                `출력(JSON): {"summary": "전체 내용 한두 문장 요약", "segments": [{"speaker": "1", "text": "다듬은 문장"}]}`,
            },
            { role: "user", content: source },
          ],
        }),
      });
      if (chatRes.ok) {
        const chat = await chatRes.json();
        const parsed = JSON.parse(chat.choices[0].message.content);
        if (Array.isArray(parsed.segments)) {
          refined = parsed.segments.map(
            (s: { speaker?: string; text?: string }) => ({
              speaker: String(s.speaker ?? "1"),
              text: String(s.text ?? ""),
            }),
          );
        }
        if (typeof parsed.summary === "string") summary = parsed.summary;
      } else {
        console.error("refine 실패:", chatRes.status, await chatRes.text());
      }
    } catch (e) {
      console.error("refine 예외:", e);
    }

    // 재변환 시 기존 결과를 대체 (중복 표시 방지)
    await admin.from("transcripts").delete().eq("recording_id", rec.id);

    const { error: insErr } = await admin.from("transcripts").insert({
      recording_id: rec.id,
      raw_text: text,
      words: words ?? null,
      diarized,
      refined,
      summary,
      speaker_names: {},
      stt_engine: RAW_MODEL,
    });
    if (insErr) throw insErr;

    await admin.from("recordings").update({ status: "done" }).eq("id", rec.id);
    return json({ ok: true, summary });
  } catch (e) {
    if (recordingId) {
      await admin.from("recordings").update({ status: "failed" }).eq("id", recordingId);
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
