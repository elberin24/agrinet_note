// 취재수첩 — 녹취 질문하기 Edge Function
// { recording_id, question }을 받아 변환 텍스트를 근거로 GPT가 답변한다.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "gpt-4o-mini";
const MAX_CONTEXT_CHARS = 24000; // 아주 긴 녹취는 앞부분 위주로 자른다

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

  try {
    const { recording_id, question } = await req.json();
    if (!recording_id || !question) {
      return json({ error: "recording_id와 question이 필요합니다." }, 400);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "로그인이 필요합니다." }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rec } = await admin
      .from("recordings")
      .select("id, user_id")
      .eq("id", recording_id)
      .single();
    if (!rec || rec.user_id !== user.id) {
      return json({ error: "녹음을 찾을 수 없습니다." }, 404);
    }

    const { data: t } = await admin
      .from("transcripts")
      .select("raw_text, refined, speaker_names")
      .eq("recording_id", recording_id)
      .single();
    if (!t || (!t.raw_text && !t.refined)) {
      return json({ error: "아직 변환된 텍스트가 없습니다. 먼저 텍스트 변환을 실행하세요." }, 409);
    }

    const names = (t.speaker_names ?? {}) as Record<string, string>;
    let context: string;
    if (Array.isArray(t.refined) && t.refined.length > 0) {
      context = (t.refined as Array<{ speaker: string; text: string }>)
        .map((s) => `${names[s.speaker] ?? `화자 ${s.speaker}`}: ${s.text}`)
        .join("\n");
    } else {
      context = t.raw_text ?? "";
    }
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS) + "\n…(이후 생략)";
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "기자의 취재 녹취록에 대한 질문에 답하는 도우미다. 반드시 아래 녹취록 내용만 근거로 답하고, 녹취록에 없는 내용은 '녹취록에서 확인되지 않습니다'라고 답한다. 답변은 간결한 한국어로.\n\n[녹취록]\n" +
              context,
          },
          { role: "user", content: String(question) },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`AI 응답 오류 ${res.status}: ${await res.text()}`);
    }
    const chat = await res.json();
    return json({ answer: chat.choices[0].message.content });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
