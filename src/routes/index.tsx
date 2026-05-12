import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  Upload, FileText, Sparkles, Copy, Check, AlertCircle,
  Download, ShieldCheck, ListChecks, Target, Quote, Link2, Mail, FileDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractTextFromFile } from "@/lib/extract-text";
import { generateCvPdf, type CvPdfTemplate } from "@/lib/cv-pdf";
import { generateCvDocx } from "@/lib/cv-docx";
import { supabase } from "@/integrations/supabase/client";

type SectionCheck = {
  hasContactInfo: boolean;
  hasSummary: boolean;
  hasExperience: boolean;
  hasSkills: boolean;
  hasEducation: boolean;
};

type AtsReport = {
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  formattingIssues: string[];
  sectionCheck: SectionCheck;
  suggestions: string[];
};

type FitReport = {
  matchPercent: number;
  strongestMatch: string;
  weakestGap: string;
  hiringLikelihood: string;
};

type KeywordGap = {
  topKeywords: string[];
  present: string[];
  missing: string[];
};

const BLOCKED_HOSTS = ["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com"];
const isBlockedJobHost = (raw: string): string | null => {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, "");
    const match = BLOCKED_HOSTS.find((h) => host === h || host.endsWith(`.${h}`));
    return match ?? null;
  } catch {
    return null;
  }
};

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "CVFoundry — Forge an ATS-ready CV for any job" },
      {
        name: "description",
        content:
          "Upload your CV, paste a job description, and get an ATS-optimised, recruiter-ready CV with a full match report and PDF download.",
      },
      { property: "og:title", content: "CVFoundry — AI CV optimisation" },
      {
        property: "og:description",
        content: "Forge an ATS-ready CV in seconds. Match score, keywords, and a clean PDF.",
      },
    ],
  }),
});

const SECTION_LABELS: Record<keyof SectionCheck, string> = {
  hasContactInfo: "Contact info",
  hasSummary: "Summary",
  hasExperience: "Experience",
  hasSkills: "Skills",
  hasEducation: "Education",
};

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [cvText, setCvText] = useState("");
  const [jobUrl, setJobUrl] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [scraping, setScraping] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tailoredCv, setTailoredCv] = useState("");
  const [improvements, setImprovements] = useState<string[]>([]);
  const [ats, setAts] = useState<AtsReport | null>(null);
  const [fit, setFit] = useState<FitReport | null>(null);
  const [keywordGap, setKeywordGap] = useState<KeywordGap | null>(null);
  const [positioningLine, setPositioningLine] = useState<string>("");
  const [coverLetter, setCoverLetter] = useState<string>("");
  const [coverCopied, setCoverCopied] = useState(false);
  const [pdfTemplate, setPdfTemplate] = useState<CvPdfTemplate>("ats");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const blockedHost = isBlockedJobHost(jobUrl);

  const handleFile = async (f: File) => {
    setFile(f);
    setParsing(true);
    try {
      const text = await extractTextFromFile(f);
      if (!text || text.length < 30) {
        toast.error("Couldn't read enough text from this file. Try another format.");
        setCvText("");
        setFile(null);
      } else {
        setCvText(text);
        toast.success(`Loaded ${f.name}`);
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to read file");
      setFile(null);
    } finally {
      setParsing(false);
    }
  };

  const fetchJobFromUrl = async (): Promise<string | null> => {
    const url = jobUrl.trim();
    if (!url) {
      toast.error("Please paste a job link first");
      return null;
    }
    try {
      new URL(url);
    } catch {
      toast.error("That doesn't look like a valid URL");
      return null;
    }
    const blocked = isBlockedJobHost(url);
    if (blocked) {
      setPasteOpen(true);
      toast.error(`${blocked} blocks scrapers — paste the description below instead.`);
      return null;
    }
    setScraping(true);
    try {
      const res = await fetch("/api/public/scrape-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { text?: string; title?: string; error?: string };
      if (!res.ok || !data.text) {
        throw new Error(data.error || "Failed to read job page");
      }
      setJobDescription(data.text);
      setJobTitle(data.title || "");
      toast.success(data.title ? `Loaded: ${data.title}` : "Job description loaded");
      return data.text;
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to read job page");
      return null;
    } finally {
      setScraping(false);
    }
  };

  const handleGenerate = async () => {
    if (!cvText.trim()) {
      toast.error("Please upload your CV first");
      return;
    }
    let jd = jobDescription;
    if (!jd.trim() || jd.trim().length < 30) {
      const fetched = await fetchJobFromUrl();
      if (!fetched) return;
      jd = fetched;
    }

    setLoading(true);
    setTailoredCv("");
    setImprovements([]);
    setAts(null);
    setFit(null);
    setKeywordGap(null);
    setPositioningLine("");

    try {
      const { data, error } = await supabase.functions.invoke("tailor-cv", {
        body: { cvText, jobDescription: jd },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setTailoredCv(data.tailoredCv ?? "");
      setImprovements(Array.isArray(data.improvements) ? data.improvements : []);
      setAts(data.ats ?? null);
      setFit(data.fit ?? null);
      setKeywordGap(data.keywordGap ?? null);
      setPositioningLine(typeof data.positioningLine === "string" ? data.positioningLine : "");
      setCoverLetter(typeof data.coverLetter === "string" ? data.coverLetter : "");

      setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to generate tailored CV");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tailoredCv);
    setCopied(true);
    toast.success("CV copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadPdf = () => {
    try {
      generateCvPdf(
        tailoredCv,
        `CVFoundry-tailored-cv-${pdfTemplate}.pdf`,
        pdfTemplate,
      );
    } catch (e) {
      console.error(e);
      toast.error("Could not generate PDF");
    }
  };

  const handleDownloadDocx = async () => {
    try {
      await generateCvDocx(tailoredCv, "CVFoundry-tailored-cv.docx");
    } catch (e) {
      console.error(e);
      toast.error("Could not generate DOCX");
    }
  };

  const handleCopyCover = async () => {
    await navigator.clipboard.writeText(coverLetter);
    setCoverCopied(true);
    toast.success("Cover letter copied");
    setTimeout(() => setCoverCopied(false), 2000);
  };

  const scoreColor = (score: number) =>
    score >= 80 ? "text-foreground" : score >= 60 ? "text-foreground" : "text-destructive";

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted ring-1 ring-border text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="square"
              strokeLinejoin="miter"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path d="M4 7h10l4 4h2" />
              <path d="M8 7v6" />
              <path d="M4 17h12" />
            </svg>
          </div>
          <span className="font-semibold tracking-tight text-foreground/90">
            CV<span className="text-muted-foreground">Foundry</span>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <section className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Forge an ATS-ready CV
          </h1>
          <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
            Upload your CV, paste a job description, and get a tailored,
            recruiter-ready version with a full ATS match report — in seconds.
          </p>
        </section>

        <Card className="p-6 md:p-8 shadow-sm">
          <div className="space-y-6">
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">Your CV</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={parsing}
                className="w-full border-2 border-dashed border-border hover:border-foreground/30 hover:bg-muted/40 transition-colors rounded-lg px-6 py-8 flex flex-col items-center justify-center gap-2 disabled:opacity-60"
              >
                {file ? (
                  <>
                    <FileText className="h-6 w-6 text-foreground" />
                    <span className="text-sm font-medium text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {parsing ? "Reading file…" : "Click to replace"}
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Upload your CV</span>
                    <span className="text-xs text-muted-foreground">PDF, DOC or DOCX</span>
                  </>
                )}
              </button>
            </div>

            <div>
              <label htmlFor="jd" className="text-sm font-medium text-foreground mb-2 block">
        Job link
              </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="jd"
            type="url"
            value={jobUrl}
            onChange={(e) => {
              setJobUrl(e.target.value);
              if (jobDescription) {
                setJobDescription("");
                setJobTitle("");
              }
            }}
            placeholder="https://company.com/careers/role"
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={fetchJobFromUrl}
          disabled={scraping || !jobUrl.trim()}
        >
          {scraping ? "Fetching…" : jobDescription ? "Re-fetch" : "Fetch"}
        </Button>
      </div>
      {jobDescription && (
        <p className="mt-2 text-xs text-muted-foreground">
          ✓ Loaded {jobTitle ? `“${jobTitle}”` : "job description"} ({jobDescription.length.toLocaleString()} chars)
        </p>
      )}
      {blockedHost ? (
        <p className="mt-2 text-xs text-destructive">
          {blockedHost} blocks automated scraping. Paste the job description below instead.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Works best with public company careers pages. LinkedIn, Indeed and Glassdoor block scrapers, paste the description below instead.
        </p>
      )}

      <details
        className="mt-3 group"
        open={pasteOpen || !!blockedHost}
        onToggle={(e) => setPasteOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none">
          Or paste the job description manually
        </summary>
        <Textarea
          value={jobDescription}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setJobDescription(e.target.value);
            if (e.target.value && jobTitle) setJobTitle("");
          }}
          placeholder="Paste the full job description here…"
          className="mt-2 min-h-[160px] text-sm"
        />
      </details>
            </div>

            <Button
              onClick={handleGenerate}
      disabled={loading || parsing || scraping || !cvText || (!jobUrl.trim() && jobDescription.trim().length < 30)}
              size="lg"
              className="w-full"
            >
              <Sparkles className="h-4 w-4" />
      {loading ? "Forging your CV…" : scraping ? "Reading job…" : "Forge Tailored CV"}
            </Button>
          </div>
        </Card>

        {loading && (
          <div className="mt-8 text-center text-muted-foreground text-sm">
            Forging your CV and running ATS analysis…
          </div>
        )}

        {tailoredCv && !loading && (
          <section id="results" className="mt-10 space-y-6">
            {fit && (
              <Card className="p-6 md:p-8 shadow-sm">
                <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Target className="h-5 w-5" />
                    Fit Score
                  </h2>
                  <div className="text-right">
                    <div className={`text-3xl font-semibold ${scoreColor(fit.matchPercent)}`}>
                      {fit.matchPercent}
                      <span className="text-base text-muted-foreground">%</span>
                    </div>
                    <div className="text-xs text-muted-foreground">overall match</div>
                  </div>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-6">
                  <div
                    className="h-full bg-foreground/80 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, fit.matchPercent))}%` }}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-md border border-border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Strongest match</div>
                    <div className="text-sm text-foreground">{fit.strongestMatch}</div>
                  </div>
                  <div className="rounded-md border border-border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Weakest gap</div>
                    <div className="text-sm text-foreground">{fit.weakestGap}</div>
                  </div>
                  <div className="rounded-md border border-border p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Hiring likelihood</div>
                    <div className="text-sm text-foreground">{fit.hiringLikelihood}</div>
                  </div>
                </div>
              </Card>
            )}

            {positioningLine && (
              <Card className="p-6 md:p-8 shadow-sm bg-muted/40">
                <h2 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                  <Quote className="h-4 w-4" /> Role positioning
                </h2>
                <p className="text-base md:text-lg text-foreground leading-snug">
                  {positioningLine}
                </p>
              </Card>
            )}

            {keywordGap && keywordGap.topKeywords?.length > 0 && (
              <Card className="p-6 md:p-8 shadow-sm">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <ListChecks className="h-5 w-5" />
                  Keyword Gap (Top 10)
                </h2>
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-2">
                      In your CV ({keywordGap.present.length})
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {keywordGap.present.length === 0 && (
                        <span className="text-xs text-muted-foreground">None of the top keywords detected</span>
                      )}
                      {keywordGap.present.map((k) => (
                        <span key={k} className="text-xs px-2 py-1 rounded bg-muted text-foreground inline-flex items-center gap-1">
                          <Check className="h-3 w-3" /> {k}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-2">
                      Missing ({keywordGap.missing.length})
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {keywordGap.missing.length === 0 && (
                        <span className="text-xs text-muted-foreground">All top keywords covered</span>
                      )}
                      {keywordGap.missing.map((k) => (
                        <span key={k} className="text-xs px-2 py-1 rounded border border-destructive/40 text-foreground inline-flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 text-destructive" /> {k}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {ats && (
              <Card className="p-6 md:p-8 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5" />
                    ATS Report
                  </h2>
                  <div className="text-right">
                    <div className={`text-3xl font-semibold ${scoreColor(ats.score)}`}>
                      {ats.score}
                      <span className="text-base text-muted-foreground">/100</span>
                    </div>
                    <div className="text-xs text-muted-foreground">match score</div>
                  </div>
                </div>

                <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-6">
                  <div
                    className="h-full bg-foreground/80 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, ats.score))}%` }}
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-2">Matched keywords</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {ats.matchedKeywords.length === 0 && (
                        <span className="text-xs text-muted-foreground">None detected</span>
                      )}
                      {ats.matchedKeywords.map((k) => (
                        <span key={k} className="text-xs px-2 py-1 rounded bg-muted text-foreground">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-foreground mb-2">Missing keywords</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {ats.missingKeywords.length === 0 && (
                        <span className="text-xs text-muted-foreground">None — great coverage</span>
                      )}
                      {ats.missingKeywords.map((k) => (
                        <span
                          key={k}
                          className="text-xs px-2 py-1 rounded border border-border text-foreground"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6">
                  <h3 className="text-sm font-medium text-foreground mb-2">Section check</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {(Object.keys(SECTION_LABELS) as Array<keyof SectionCheck>).map((key) => {
                      const ok = ats.sectionCheck[key];
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-border"
                        >
                          {ok ? (
                            <Check className="h-3.5 w-3.5 text-foreground" />
                          ) : (
                            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                          )}
                          <span className="text-foreground">{SECTION_LABELS[key]}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {ats.formattingIssues.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-medium text-foreground mb-2">Formatting risks</h3>
                    <ul className="space-y-1">
                      {ats.formattingIssues.map((f, i) => (
                        <li key={i} className="text-sm text-foreground flex gap-2">
                          <span className="text-muted-foreground mt-1">•</span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {ats.suggestions.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
                      <ListChecks className="h-4 w-4" /> Suggestions
                    </h3>
                    <ul className="space-y-1">
                      {ats.suggestions.map((s, i) => (
                        <li key={i} className="text-sm text-foreground flex gap-2">
                          <span className="text-muted-foreground mt-1">•</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            )}

            <Card className="p-6 md:p-8 shadow-sm">
              <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-foreground">Tailored CV</h2>
                <div className="flex gap-2 flex-wrap items-center">
                  <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => setPdfTemplate("ats")}
                      className={`px-2.5 py-1.5 ${pdfTemplate === "ats" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"}`}
                    >
                      ATS
                    </button>
                    <button
                      type="button"
                      onClick={() => setPdfTemplate("modern")}
                      className={`px-2.5 py-1.5 border-l border-border ${pdfTemplate === "modern" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"}`}
                    >
                      Modern
                    </button>
                  </div>
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? (
                      <><Check className="h-4 w-4" /> Copied</>
                    ) : (
                      <><Copy className="h-4 w-4" /> Copy</>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDownloadDocx}>
                    <FileDown className="h-4 w-4" /> DOCX
                  </Button>
                  <Button size="sm" onClick={handleDownloadPdf}>
                    <Download className="h-4 w-4" /> Download PDF
                  </Button>
                </div>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                {tailoredCv}
              </pre>
            </Card>

            {coverLetter && (
              <Card className="p-6 md:p-8 shadow-sm">
                <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    Cover Letter
                  </h2>
                  <Button variant="outline" size="sm" onClick={handleCopyCover}>
                    {coverCopied ? (
                      <><Check className="h-4 w-4" /> Copied</>
                    ) : (
                      <><Copy className="h-4 w-4" /> Copy</>
                    )}
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                  {coverLetter}
                </pre>
              </Card>
            )}

            {improvements.length > 0 && (
              <Card className="p-6 md:p-8 shadow-sm bg-muted/40">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Key Improvements
                </h2>
                <ul className="space-y-2">
                  {improvements.map((item, i) => (
                    <li key={i} className="flex gap-3 text-sm text-foreground">
                      <span className="text-muted-foreground mt-1">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        )}
      </main>

      <footer className="border-t border-border/60 mt-16 py-6 text-center text-xs text-muted-foreground">
        CVFoundry · Built with Lovable
      </footer>
    </div>
  );
}
