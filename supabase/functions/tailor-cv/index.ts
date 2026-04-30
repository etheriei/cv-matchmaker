import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { cvText, jobDescription } = await req.json();
    if (!cvText || !jobDescription) {
      return new Response(JSON.stringify({ error: "Missing cvText or jobDescription" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const systemPrompt = `You are a senior CV optimisation and ATS (Applicant Tracking System) expert.
Rewrite the CV to better match the job description WITHOUT fabricating experience.
Use plain text only. NEVER use markdown formatting: no asterisks (*), no underscores (_), no backticks, no hashes (#), no bold, no italics. Use plain UPPERCASE for section headings and hyphens (-) for bullets.`;

    const userPrompt = `CV:
${cvText}

JOB DESCRIPTION:
${jobDescription}

Return a tailored CV, key improvements, and a full ATS report.`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "return_tailored_cv",
            description: "Return tailored CV, improvements and ATS analysis.",
            parameters: {
              type: "object",
              properties: {
                tailoredCv: {
                  type: "string",
                  description: "The full rewritten CV as PLAIN TEXT. No markdown, no asterisks, no underscores, no hashes. Use UPPERCASE for section headings and hyphens for bullets.",
                },
                improvements: {
                  type: "array",
                  items: { type: "string" },
                  description: "3-6 short bullet points describing the key improvements made.",
                },
                ats: {
                  type: "object",
                  properties: {
                    score: { type: "number", description: "ATS match score 0-100." },
                    matchedKeywords: { type: "array", items: { type: "string" }, description: "JD keywords/skills present in the tailored CV." },
                    missingKeywords: { type: "array", items: { type: "string" }, description: "Important JD keywords still missing or weak in the CV." },
                    formattingIssues: { type: "array", items: { type: "string" }, description: "ATS-unfriendly formatting risks found (tables, columns, images, headers/footers, special chars, etc.). Empty array if none." },
                    sectionCheck: {
                      type: "object",
                      properties: {
                        hasContactInfo: { type: "boolean" },
                        hasSummary: { type: "boolean" },
                        hasExperience: { type: "boolean" },
                        hasSkills: { type: "boolean" },
                        hasEducation: { type: "boolean" },
                      },
                      required: ["hasContactInfo", "hasSummary", "hasExperience", "hasSkills", "hasEducation"],
                      additionalProperties: false,
                    },
                    suggestions: { type: "array", items: { type: "string" }, description: "Concrete suggestions to further improve ATS performance." },
                  },
                  required: ["score", "matchedKeywords", "missingKeywords", "formattingIssues", "sectionCheck", "suggestions"],
                  additionalProperties: false,
                },
              },
              required: ["tailoredCv", "improvements", "ats"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "return_tailored_cv" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits to your workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      return new Response(JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("No structured response from model");

    const args = JSON.parse(toolCall.function.arguments);

    // Defensive: strip any stray markdown the model might still add
    const stripMd = (s: string) =>
      s.replace(/\*\*/g, "").replace(/\*/g, "").replace(/^#+\s*/gm, "").replace(/`/g, "");
    args.tailoredCv = stripMd(String(args.tailoredCv ?? ""));
    args.improvements = (args.improvements ?? []).map((i: string) => stripMd(String(i)));

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tailor-cv error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
