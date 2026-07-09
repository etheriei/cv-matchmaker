import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 10;

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(`cvfoundry:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const LANGUAGES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  nl: "Dutch",
  pt: "Portuguese",
  it: "Italian",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      cvText, jobDescription, tone, locale, coverTone, coverLength,
      mustIncludeKeywords, hiringManagerName, companyName, language, feedback,
    } = await req.json();
    const MAX_CV = 30_000;
    const MAX_JD = 30_000;
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

    // ---- Rate limiting (per-IP, per-hour) --------------------------------
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (SUPABASE_URL && SERVICE_ROLE) {
      try {
        const ip = (req.headers.get("x-forwarded-for")?.split(",")[0].trim())
          || req.headers.get("cf-connecting-ip") || "unknown";
        const ipHash = await hashIp(ip);
        const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
        const { count } = await admin
          .from("rate_limits")
          .select("id", { count: "exact", head: true })
          .eq("ip_hash", ipHash)
          .eq("action", "tailor-cv")
          .gte("created_at", since);
        if ((count ?? 0) >= RATE_LIMIT_MAX) {
          return new Response(
            JSON.stringify({ error: `Rate limit reached: max ${RATE_LIMIT_MAX} tailoring runs per hour. Please try again later.` }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        await admin.from("rate_limits").insert({ ip_hash: ipHash, action: "tailor-cv" });
      } catch (e) {
        console.warn("rate-limit check failed (non-fatal):", e);
      }
    }
    // ----------------------------------------------------------------------

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const cvTone = (["concise", "standard", "detailed"].includes(tone) ? tone : "standard") as
      "concise" | "standard" | "detailed";
    const cvLocale = (["uk", "us"].includes(locale) ? locale : "uk") as "uk" | "us";
    const cTone = (["formal", "warm", "direct"].includes(coverTone) ? coverTone : "warm") as
      "formal" | "warm" | "direct";
    const cLen = ([200, 300, 400].includes(Number(coverLength)) ? Number(coverLength) : 300);
    const includeKw: string[] = Array.isArray(mustIncludeKeywords)
      ? mustIncludeKeywords
          .filter((k: unknown): k is string => typeof k === "string" && k.trim().length > 0)
          .map((k: string) => k.trim())
          .slice(0, 25)
      : [];
    const langCode = typeof language === "string" && LANGUAGES[language] ? language : "en";
    const langName = LANGUAGES[langCode];
    const hmName = typeof hiringManagerName === "string" ? hiringManagerName.trim().slice(0, 80) : "";
    const coName = typeof companyName === "string" ? companyName.trim().slice(0, 120) : "";
    const userFeedback = typeof feedback === "string" ? feedback.trim().slice(0, 500) : "";

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
OUTPUT LANGUAGE: Write EVERY output field (tailoredCv, improvements, ats.*, fit.*, keywordGap.*, positioningLine, coverLetter) in ${langName}. Keep proper nouns, technology names, and brand names in their original form.
TONE: ${toneGuide}
LOCALE: ${localeGuide}
COVER LETTER TONE: ${coverToneGuide}
COVER LETTER LENGTH: target approximately ${cLen} words (acceptable range ${cLen - 40}-${cLen + 40}).
COVER LETTER SALUTATION: ${
      hmName
        ? `Address the letter directly to "${hmName}" (e.g. "Dear ${hmName},").`
        : "Use a neutral greeting such as \"Dear Hiring Team,\" — do NOT invent a name."
    }${coName ? ` Reference the company by name ("${coName}") at least once in the opening paragraph.` : ""}${
      includeKw.length > 0
        ? `\nMUST-INCLUDE KEYWORDS: The user has confirmed these skills/keywords genuinely apply to them. Weave EVERY one of the following into the tailored CV naturally (in the summary, skills, or a relevant experience bullet), without fabricating employers, dates, or projects: ${includeKw.join(", ")}.`
        : ""
    }${
      userFeedback
        ? `\nUSER FEEDBACK ON A PREVIOUS ATTEMPT: The user asked for the following adjustments — apply them to this revision: "${userFeedback}".`
        : ""
    }`;

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

    // ---- Fabrication guardrail (lightweight second pass) -----------------
    args.fabrication = { flagged: [] as string[], note: "" };
    try {
      const fabRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content:
                "You are a strict fact-checker. You compare a TAILORED CV against the ORIGINAL CV and identify any specific factual claims (employers, job titles, dates, degrees, certifications, quantified results/metrics, tools/technologies) that appear in the tailored CV but are NOT clearly supported by the original CV. Ignore stylistic rewording and reasonable synonyms. Return concise flagged claims verbatim from the tailored CV.",
            },
            {
              role: "user",
              content: `ORIGINAL CV:\n${cvText}\n\nTAILORED CV:\n${args.tailoredCv}`,
            },
          ],
          tools: [{
            type: "function",
            function: {
              name: "report_fabrications",
              description: "Report any unsupported claims in the tailored CV.",
              parameters: {
                type: "object",
                properties: {
                  flagged: {
                    type: "array",
                    items: { type: "string" },
                    description: "Short verbatim excerpts (max ~15 words each) from the tailored CV that are not supported by the original. Empty array if all is grounded.",
                  },
                  note: {
                    type: "string",
                    description: "One-sentence summary of the check outcome.",
                  },
                },
                required: ["flagged", "note"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "report_fabrications" } },
        }),
      });
      if (fabRes.ok) {
        const fabData = await fabRes.json();
        const fabCall = fabData.choices?.[0]?.message?.tool_calls?.[0];
        if (fabCall) {
          const fabArgs = JSON.parse(fabCall.function.arguments);
          args.fabrication = {
            flagged: Array.isArray(fabArgs.flagged) ? fabArgs.flagged.map((s: string) => stripMd(String(s))).slice(0, 12) : [],
            note: stripMd(String(fabArgs.note ?? "")),
          };
        }
      }
    } catch (e) {
      console.warn("fabrication check failed (non-fatal):", e);
    }
    // ----------------------------------------------------------------------

    return new Response(JSON.stringify(args), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("tailor-cv error:", e);
    return new Response(JSON.stringify({ error: "An unexpected error occurred. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
