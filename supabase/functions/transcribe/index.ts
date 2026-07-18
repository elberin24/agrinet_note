// 취재수첩 — STT Edge Function
// 클라이언트가 { recording_id }로 호출하면:
// 녹음 파일 다운로드 → OpenAI 음성인식(농축수산 용어 프롬프트) → transcripts 저장
import { createClient } from "npm:@supabase/supabase-js@2";

// whisper-1: 단어별 타임스탬프(재생-텍스트 동기화)를 지원하고,
// gpt-4o-transcribe보다 반복 발화를 덜 잘라내 취재 녹취 원문 보존에 유리하다.
const STT_MODEL = "whisper-1";

// 농축수산 전문용어 사전 — 프롬프트로 주입해 오인식을 줄인다.
// 실제 기사에서 자주 쓰는 용어를 계속 추가할 것.
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

// 주의: LLM 기반 STT는 반복 발화를 중복으로 오판해 한 번만 적는 경향이 있다.
// 취재 녹취는 발언 원문 보존이 중요하므로 요약·생략 금지를 명시한다.
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

    const form = new FormData();
    form.append("file", file, "audio.m4a");
    form.append("model", STT_MODEL);
    form.append("language", "ko");
    form.append("prompt", PROMPT);
    // 단어별 타임스탬프 요청 — 웹의 재생-텍스트 동기화(하이라이트)에 사용
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}` },
      body: form,
    });
    if (!res.ok) {
      throw new Error(`OpenAI API 오류 ${res.status}: ${await res.text()}`);
    }
    const { text, words } = await res.json();

    // 재변환 시 기존 결과를 대체 (중복 표시 방지)
    await admin.from("transcripts").delete().eq("recording_id", rec.id);

    const { error: insErr } = await admin.from("transcripts").insert({
      recording_id: rec.id,
      raw_text: text,
      words: words ?? null,
      stt_engine: STT_MODEL,
    });
    if (insErr) throw insErr;

    await admin.from("recordings").update({ status: "done" }).eq("id", rec.id);
    return json({ ok: true, text });
  } catch (e) {
    if (recordingId) {
      await admin.from("recordings").update({ status: "failed" }).eq("id", recordingId);
    }
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
