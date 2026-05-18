import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { cvText, jobDescription, tone, locale, coverTone, coverLength } = await req.json();
    const MAX_CV = 15_000;
    const MAX_JD = 10_000;
    if (typeof cvText !== "string" || cvText.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Missing or invalid cvText" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (typeof jobDescription !== "string" || jobDescription.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Missing or invalid jobDescription" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (cvText.length > MAX_CV) {
      return new Response(JSON.stringify({ error: `CV text too large (max ${MAX_CV} characters)` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (jobDescription.length > MAX_JD) {
      return new Response(JSON.stringify({ error: `Job description too large (max ${MAX_JD} characters)` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const cvTone = (["concise", "standard", "detailed"].includes(tone) ? tone : "standard") as
      "concise" | "standard" | "detailed";
    const cvLocale = (["uk", "us"].includes(locale) ? locale : "uk") as "uk" | "us";
    const cTone = (["formal", "warm", "direct"].includes(coverTone) ? coverTone : "warm") as
      "formal" | "warm" | "direct";
    const cLen = ([200, 300, 400].includes(Number(coverLength)) ? Number(coverLength) : 300);

    const toneGuide = {
      concise: "Be highly concise: short bullets, no filler, prefer 1 line per bullet.",
      standard: "Use a balanced length: clear bullets, typically 1-2 lines each.",
      detailed: "Be thorough: longer bullets with quantified outcomes and context where useful.",
    }[cvTone];
    const localeGuide =
      cvLocale === "uk"
        ? "Use British English spelling (organisation, optimisation, programme, behaviour, colour)."
        : "Use American English spelling (organization, optimization, program, behavior, color).";
    const coverToneGuide = {
      formal: "Professional and respectful, third-person-friendly phrasing.",
      warm: "Warm and human, enthusiastic but professional.",
      direct: "Direct and confident, lead with impact, minimal pleasantries.",
    }[cTone];

    const systemPrompt = `You are a senior CV optimisation and ATS (Applicant Tracking System) expert.
Rewrite the CV to better match the job description WITHOUT fabricating experience.
Use plain text only. NEVER use markdown formatting: no asterisks (*), no underscores (_), no backticks, no hashes (#), no bold, no italics. Use plain UPPERCASE for section headings and hyphens (-) for bullets.
STRICT PUNCTUATION RULE: NEVER use em dashes (—) or en dashes (–) anywhere in any output field. Do not use them in the tailored CV, improvements, or ATS report. Replace any dash-style pause with a comma, a period, a colon, or simply rewrite the sentence. Only the regular hyphen-minus (-) is allowed, and only for bullet points or compound words.
TONE: ${toneGuide}
LOCALE: ${localeGuide}
COVER LETTER TONE: ${coverToneGuide}
COVER LETTER LENGTH: target approximately ${cLen} words (acceptable range ${cLen - 40}-${cLen + 40}).`;

    const userPrompt = `CV:
${cvText}

JOB DESCRIPTION:
${jobDescription}

Return a tailored CV, key improvements, a full ATS report, a fit score with reasoning, a focused keyword gap analysis (top 10 JD keywords split into present/missing), and a single role positioning line.`;

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
                fit: {
                  type: "object",
                  description: "Overall candidate-job fit assessment, separate from ATS keyword score.",
                  properties: {
                    matchPercent: { type: "number", description: "Overall fit 0-100 based on experience, skills, seniority, and domain alignment." },
                    strongestMatch: { type: "string", description: "One sentence: the candidate's strongest match to the role." },
                    weakestGap: { type: "string", description: "One sentence: the most significant gap or weakness vs the role." },
                    hiringLikelihood: { type: "string", description: "One sentence: overall likelihood of being hired and a recommendation on whether to apply." },
                  },
                  required: ["matchPercent", "strongestMatch", "weakestGap", "hiringLikelihood"],
                  additionalProperties: false,
                },
                keywordGap: {
                  type: "object",
                  description: "Top 10 JD keywords, split into present and missing.",
                  properties: {
                    topKeywords: {
                      type: "array",
                      items: { type: "string" },
                      description: "Exactly the top 10 most important keywords/skills from the job description, ordered by importance.",
                    },
                    present: { type: "array", items: { type: "string" }, description: "Subset of topKeywords already present in the tailored CV." },
                    missing: { type: "array", items: { type: "string" }, description: "Subset of topKeywords NOT present (or weak) in the tailored CV." },
                  },
                  required: ["topKeywords", "present", "missing"],
                  additionalProperties: false,
                },
                positioningLine: {
                  type: "string",
                  description: "A single sentence positioning statement, e.g. 'Positioning you as a mid-level Product Designer focused on UX systems and UI execution.' Plain text, no markdown, no dashes.",
                },
                coverLetter: {
                  type: "string",
                  description: `A tailored cover letter addressed to the hiring team. Target ~${cLen} words. Plain text only, no markdown, no em/en dashes. Use 3-4 short paragraphs separated by blank lines. Reference specific job requirements and matching candidate strengths. Open with the role and a strong hook, close with a clear call to action. Do NOT fabricate experience.`,
                },
              },
              required: ["tailoredCv", "improvements", "ats", "fit", "keywordGap", "positioningLine", "coverLetter"],
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
      s
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/^#+\s*/gm, "")
        .replace(/`/g, "")
        // Remove em/en dashes (and common variants) — replace with comma + space when used as a pause
        .replace(/\s*[—–−]\s*/g, ", ")
        .replace(/[—–−]/g, ",");
    args.tailoredCv = stripMd(String(args.tailoredCv ?? ""));
    args.improvements = (args.improvements ?? []).map((i: string) => stripMd(String(i)));
    if (args.ats && typeof args.ats === "object") {
      const arr = (a: any) => Array.isArray(a) ? a.map((x: string) => stripMd(String(x))) : a;
      args.ats.matchedKeywords = arr(args.ats.matchedKeywords);
      args.ats.missingKeywords = arr(args.ats.missingKeywords);
      args.ats.formattingIssues = arr(args.ats.formattingIssues);
      args.ats.suggestions = arr(args.ats.suggestions);
    }
    if (args.fit && typeof args.fit === "object") {
      args.fit.strongestMatch = stripMd(String(args.fit.strongestMatch ?? ""));
      args.fit.weakestGap = stripMd(String(args.fit.weakestGap ?? ""));
      args.fit.hiringLikelihood = stripMd(String(args.fit.hiringLikelihood ?? ""));
    }
    if (args.keywordGap && typeof args.keywordGap === "object") {
      const arr = (a: any) => Array.isArray(a) ? a.map((x: string) => stripMd(String(x))) : a;
      args.keywordGap.topKeywords = arr(args.keywordGap.topKeywords);
      args.keywordGap.present = arr(args.keywordGap.present);
      args.keywordGap.missing = arr(args.keywordGap.missing);
    }
    if (typeof args.positioningLine === "string") {
      args.positioningLine = stripMd(args.positioningLine);
    }
    if (typeof args.coverLetter === "string") {
      args.coverLetter = stripMd(args.coverLetter);
    }

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tailor-cv error:", e);
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
