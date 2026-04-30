import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT = `You are a senior recruitment and CV optimisation assistant.

Your job is to rewrite a CV so it matches a job description.

Rules:
- Do not fabricate experience
- Do not exaggerate skills
- Improve clarity, structure, and relevance
- Prioritise keywords from job description
- Keep CV concise and readable

OUTPUT FORMAT (STRICT — return EXACTLY this format, nothing else):
TAILORED CV:
[rewritten CV text]

KEY IMPROVEMENTS:
- bullet 1
- bullet 2
- bullet 3
(3 to 6 bullets max)`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { cvText, jobDescription } = await req.json();

    if (!cvText || !jobDescription) {
      return new Response(
        JSON.stringify({ error: "Missing cvText or jobDescription" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const userPrompt = `INPUT:
CV TEXT:
${cvText}

JOB DESCRIPTION:
${jobDescription}

OUTPUT FORMAT:
TAILORED CV:
...

KEY IMPROVEMENTS:
...`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";

    // Parse output
    const cvMatch = content.match(/TAILORED CV:\s*([\s\S]*?)\s*KEY IMPROVEMENTS:/i);
    const improvementsMatch = content.match(/KEY IMPROVEMENTS:\s*([\s\S]*)/i);

    const tailoredCv = cvMatch ? cvMatch[1].trim() : content.trim();
    const improvementsBlock = improvementsMatch ? improvementsMatch[1].trim() : "";
    const improvements = improvementsBlock
      .split("\n")
      .map((l) => l.replace(/^[-•*\d.\s]+/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 6);

    return new Response(
      JSON.stringify({ tailoredCv, improvements, raw: content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("tailor-cv error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});