import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Upload, FileText, Sparkles, Copy, Check, AlertCircle, X,
  Download, ShieldCheck, ListChecks, Target, Quote, Link2, Mail, FileDown,
  History, Trash2, Save, User, ShieldAlert,
} from "lucide-react";
import { diffLines } from "diff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractTextFromFile } from "@/lib/extract-text";
import { generateCvPdf, type CvPdfTemplate } from "@/lib/cv-pdf";
import { generateCvDocx } from "@/lib/cv-docx";
import { supabase } from "@/integrations/supabase/client";
import {
  listHistory, addHistory, removeHistory, clearHistory,
  listProfiles, saveProfile, removeProfile,
  type HistoryEntry, type CvProfile, type TailorResult,
} from "@/lib/history";

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

type CvTone = "concise" | "standard" | "detailed";
type Locale = "uk" | "us";
type CoverTone = "formal" | "warm" | "direct";
type CoverLength = 200 | 300 | 400;
type CvView = "tailored" | "original" | "compare" | "diff";
type Language = "en" | "es" | "fr" | "de" | "nl" | "pt" | "it";

const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English", es: "Español", fr: "Français", de: "Deutsch",
  nl: "Nederlands", pt: "Português", it: "Italiano",
};

const MAX_JD_CHARS = 30_000;

const slug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const extractName = (cv: string): string => {
  const lines = cv.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const l of lines.slice(0, 5)) {
    // First plausible name line: 2-5 words, mostly letters
    if (/^[A-Za-zÀ-ÿ.'\- ]{4,60}$/.test(l) && l.split(/\s+/).length >= 2 && l.split(/\s+/).length <= 5) {
      return l;
    }
  }
  return "";
};

const extractCompany = (title: string, jd: string): string => {
  // Try patterns like "Role at Company" / "Role @ Company" / "Role | Company"
  const src = title || jd.split("\n").find((l) => l.trim().length > 0) || "";
  const m =
    src.match(/\b(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{1,40})/) ||
    src.match(/[|–\-]\s*([A-Z][A-Za-z0-9&.\- ]{1,40})\s*$/);
  return m ? m[1].trim() : "";
};

const buildFileName = (cv: string, title: string, jd: string, ext: string, suffix = "") => {
  const name = slug(extractName(cv)) || "tailored-cv";
  const company = slug(extractCompany(title, jd));
  const parts = ["CVFoundry", name, company, suffix].filter(Boolean);
  return `${parts.join("-")}.${ext}`;
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
  const [positioningCopied, setPositioningCopied] = useState(false);
  const [cvTone, setCvTone] = useState<CvTone>("standard");
  const [locale, setLocale] = useState<Locale>("uk");
  const [coverTone, setCoverTone] = useState<CoverTone>("warm");
  const [coverLength, setCoverLength] = useState<CoverLength>(300);
  const [cvView, setCvView] = useState<CvView>("tailored");
  const [selectedMissing, setSelectedMissing] = useState<Set<string>>(new Set());
  const [language, setLanguage] = useState<Language>("en");
  const [hiringManagerName, setHiringManagerName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [fabrication, setFabrication] = useState<{ flagged: string[]; note: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [profiles, setProfiles] = useState<CvProfile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const blockedHost = isBlockedJobHost(jobUrl);

  useEffect(() => {
    setHistory(listHistory());
    setProfiles(listProfiles());
  }, []);

  const diff = useMemo(() => {
    if (cvView !== "diff" || !tailoredCv || !cvText) return [];
    return diffLines(cvText, tailoredCv);
  }, [cvView, tailoredCv, cvText]);

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

  const handleSaveProfile = () => {
    if (!cvText.trim()) {
      toast.error("Upload or paste a CV first");
      return;
    }
    const name = window.prompt("Name this CV profile (e.g. Design, Engineering):", file?.name?.replace(/\.[^.]+$/, "") || "");
    if (name === null) return;
    saveProfile(name, cvText);
    setProfiles(listProfiles());
    toast.success(`Profile "${name || "Untitled"}" saved`);
  };

  const handleLoadProfile = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    if (!p) return;
    setCvText(p.cvText);
    setFile(null);
    toast.success(`Loaded "${p.name}"`);
  };

  const handleDeleteProfile = (id: string) => {
    removeProfile(id);
    setProfiles(listProfiles());
  };

  const persistRun = (jd: string, result: TailorResult) => {
    try {
      addHistory({ jobTitle, jobDescription: jd, cvText, result });
      setHistory(listHistory());
    } catch (e) { console.warn(e); }
  };

  const applyResult = (data: any) => {
    setTailoredCv(data.tailoredCv ?? "");
    setImprovements(Array.isArray(data.improvements) ? data.improvements : []);
    setAts(data.ats ?? null);
    setFit(data.fit ?? null);
    setKeywordGap(data.keywordGap ?? null);
    setPositioningLine(typeof data.positioningLine === "string" ? data.positioningLine : "");
    setCoverLetter(typeof data.coverLetter === "string" ? data.coverLetter : "");
    setFabrication(data.fabrication ?? null);
  };

  const restoreFromHistory = (h: HistoryEntry) => {
    setCvText(h.cvText);
    setFile(null);
    setJobDescription(h.jobDescription);
    setJobTitle(h.jobTitle);
    applyResult(h.result);
    setHistoryOpen(false);
    toast.success("Loaded from history");
    setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 100);
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
    setSelectedMissing(new Set());
    setFabrication(null);

    try {
      const { data, error } = await supabase.functions.invoke("tailor-cv", {
        body: {
          cvText,
          jobDescription: jd,
          tone: cvTone,
          locale,
          coverTone,
          coverLength,
          language,
          hiringManagerName,
          companyName,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      applyResult(data);
      persistRun(jd, data as TailorResult);

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

  const handleRegenerateWithKeywords = async () => {
    if (selectedMissing.size === 0) return;
    const jd = jobDescription;
    if (!cvText.trim() || !jd.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("tailor-cv", {
        body: {
          cvText,
          jobDescription: jd,
          tone: cvTone,
          locale,
          coverTone,
          coverLength,
          language,
          hiringManagerName,
          companyName,
          mustIncludeKeywords: Array.from(selectedMissing),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      applyResult(data);
      persistRun(jd, data as TailorResult);
      setSelectedMissing(new Set());
      toast.success("CV regenerated with your selected keywords");
      setTimeout(() => {
        document.getElementById("results")?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to regenerate CV");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateWithFeedback = async () => {
    if (!feedback.trim()) {
      toast.error("Add a short instruction first");
      return;
    }
    const jd = jobDescription;
    if (!cvText.trim() || !jd.trim()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("tailor-cv", {
        body: {
          cvText, jobDescription: jd, tone: cvTone, locale, coverTone, coverLength,
          language, hiringManagerName, companyName,
          feedback,
          mustIncludeKeywords: Array.from(selectedMissing),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      applyResult(data);
      persistRun(jd, data as TailorResult);
      setFeedback("");
      toast.success("CV regenerated with your feedback");
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 100);
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to regenerate CV");
    } finally {
      setLoading(false);
    }
  };

  const toggleMissingKeyword = (k: string) => {
    setSelectedMissing((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(tailoredCv);
    setCopied(true);
    toast.success("CV copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPositioning = async () => {
    await navigator.clipboard.writeText(positioningLine);
    setPositioningCopied(true);
    toast.success("Positioning line copied");
    setTimeout(() => setPositioningCopied(false), 2000);
  };

  const handleDownloadPdf = () => {
    try {
      const fname = buildFileName(tailoredCv || cvText, jobTitle, jobDescription, "pdf", pdfTemplate);
      generateCvPdf(tailoredCv, fname, pdfTemplate);
      toast.success(`Downloaded ${fname}`);
    } catch (e) {
      console.error(e);
      toast.error("Could not generate PDF");
    }
  };

  const handleDownloadDocx = async () => {
    try {
      const fname = buildFileName(tailoredCv || cvText, jobTitle, jobDescription, "docx");
      await generateCvDocx(tailoredCv, fname);
      toast.success(`Downloaded ${fname}`);
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
          <div className="ml-auto">
            <Button variant="ghost" size="sm" onClick={() => { setHistory(listHistory()); setHistoryOpen(true); }}>
              <History className="h-4 w-4" />
              History
              {history.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">({history.length})</span>
              )}
            </Button>
          </div>
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
              <div className="flex items-end justify-between mb-2 gap-2 flex-wrap">
                <label className="text-sm font-medium text-foreground block">Your CV</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {profiles.length > 0 && (
                    <select
                      className="text-xs rounded border border-border bg-background px-2 py-1 text-foreground"
                      onChange={(e) => { if (e.target.value) { handleLoadProfile(e.target.value); e.target.value = ""; } }}
                      defaultValue=""
                    >
                      <option value="" disabled>Load profile…</option>
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={handleSaveProfile} disabled={!cvText.trim()}>
                    <Save className="h-3.5 w-3.5" />
                    Save as profile
                  </Button>
                </div>
              </div>
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
                ) : cvText ? (
                  <>
                    <FileText className="h-6 w-6 text-foreground" />
                    <span className="text-sm font-medium text-foreground">CV loaded ({cvText.length.toLocaleString()} chars)</span>
                    <span className="text-xs text-muted-foreground">Click to upload a different file</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">Upload your CV</span>
                    <span className="text-xs text-muted-foreground">PDF, DOC or DOCX</span>
                  </>
                )}
              </button>
              {profiles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profiles.map((p) => (
                    <span key={p.id} className="text-xs px-2 py-1 rounded border border-border text-foreground inline-flex items-center gap-1">
                      <User className="h-3 w-3" /> {p.name}
                      <button
                        type="button"
                        onClick={() => handleDeleteProfile(p.id)}
                        className="ml-1 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete profile ${p.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
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
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none flex items-center justify-between gap-2">
          <span>Or paste the job description manually</span>
          {(jobDescription || jobUrl) && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                setJobDescription("");
                setJobTitle("");
                setJobUrl("");
                setPasteOpen(false);
              }}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
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
        <div className="mt-1 flex justify-end">
          <span className={`text-xs ${jobDescription.length > MAX_JD_CHARS ? "text-destructive" : "text-muted-foreground"}`}>
            {jobDescription.length.toLocaleString()} / {MAX_JD_CHARS.toLocaleString()} characters
          </span>
        </div>
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

            <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-border/60">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">CV tone</label>
                <div className="inline-flex w-full rounded-md border border-border overflow-hidden text-xs">
                  {(["concise", "standard", "detailed"] as CvTone[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCvTone(t)}
                      className={`flex-1 px-2 py-1.5 capitalize ${cvTone === t ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"} ${t !== "concise" ? "border-l border-border" : ""}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Spelling</label>
                <div className="inline-flex w-full rounded-md border border-border overflow-hidden text-xs">
                  {(["uk", "us"] as Locale[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setLocale(l)}
                      className={`flex-1 px-2 py-1.5 uppercase ${locale === l ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"} ${l !== "uk" ? "border-l border-border" : ""}`}
                    >
                      {l === "uk" ? "UK English" : "US English"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Cover letter tone</label>
                <div className="inline-flex w-full rounded-md border border-border overflow-hidden text-xs">
                  {(["formal", "warm", "direct"] as CoverTone[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setCoverTone(t)}
                      className={`flex-1 px-2 py-1.5 capitalize ${coverTone === t ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"} ${t !== "formal" ? "border-l border-border" : ""}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Cover letter length</label>
                <div className="inline-flex w-full rounded-md border border-border overflow-hidden text-xs">
                  {([200, 300, 400] as CoverLength[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setCoverLength(l)}
                      className={`flex-1 px-2 py-1.5 ${coverLength === l ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"} ${l !== 200 ? "border-l border-border" : ""}`}
                    >
                      ~{l}w
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Output language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as Language)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                >
                  {(Object.keys(LANGUAGE_LABELS) as Language[]).map((l) => (
                    <option key={l} value={l}>{LANGUAGE_LABELS[l]}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Hiring manager (optional)</label>
                  <Input
                    value={hiringManagerName}
                    onChange={(e) => setHiringManagerName(e.target.value)}
                    placeholder="e.g. Jane Smith"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Company (optional)</label>
                  <Input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g. Acme Corp"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {loading && (
          <section className="mt-10 space-y-6" aria-label="Loading results">
            <Card className="p-6 md:p-8 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-8 w-16" />
              </div>
              <Skeleton className="h-2 w-full mb-6" />
              <div className="grid gap-4 sm:grid-cols-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            </Card>
            <Card className="p-6 md:p-8 shadow-sm space-y-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
              <Skeleton className="h-4 w-9/12" />
              <Skeleton className="h-4 w-11/12" />
            </Card>
            <p className="text-center text-muted-foreground text-sm">
              Forging your CV and running ATS analysis…
            </p>
          </section>
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
                <div className="flex items-center justify-between mb-2 gap-2">
                  <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Quote className="h-4 w-4" /> Role positioning
                  </h2>
                  <Button variant="ghost" size="sm" onClick={handleCopyPositioning}>
                    {positioningCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-base md:text-lg text-foreground leading-snug">
                  {positioningLine}
                </p>
              </Card>
            )}

            {fabrication && (
              <Card className={`p-6 md:p-8 shadow-sm ${fabrication.flagged.length > 0 ? "border-destructive/50" : ""}`}>
                <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
                  {fabrication.flagged.length > 0
                    ? <ShieldAlert className="h-5 w-5 text-destructive" />
                    : <ShieldCheck className="h-5 w-5 text-foreground" />}
                  Fabrication check
                </h2>
                {fabrication.note && (
                  <p className="text-sm text-muted-foreground mb-3">{fabrication.note}</p>
                )}
                {fabrication.flagged.length === 0 ? (
                  <p className="text-sm text-foreground">No unsupported claims detected. Always double-check before submitting.</p>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">
                      These claims appear in the tailored CV but aren't clearly supported by your original. Review each one and remove or edit any that don't apply to you.
                    </p>
                    <ul className="space-y-1.5">
                      {fabrication.flagged.map((f, i) => (
                        <li key={i} className="text-sm text-foreground flex gap-2">
                          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                          <span>“{f}”</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
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
                    {keywordGap.missing.length > 0 && (
                      <p className="text-xs text-muted-foreground mb-2">
                        Click any keyword that genuinely applies to you to include it in a regenerated CV.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {keywordGap.missing.length === 0 && (
                        <span className="text-xs text-muted-foreground">All top keywords covered</span>
                      )}
                      {keywordGap.missing.map((k) => {
                        const active = selectedMissing.has(k);
                        return (
                          <button
                            key={k}
                            type="button"
                            onClick={() => toggleMissingKeyword(k)}
                            className={`text-xs px-2 py-1 rounded inline-flex items-center gap-1 transition-colors ${
                              active
                                ? "bg-foreground text-background border border-foreground"
                                : "border border-destructive/40 text-foreground hover:bg-muted"
                            }`}
                            aria-pressed={active}
                          >
                            {active ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3 text-destructive" />}
                            {k}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                {selectedMissing.size > 0 && (
                  <div className="mt-5 flex items-center justify-between gap-3 flex-wrap border-t border-border/60 pt-4">
                    <p className="text-xs text-muted-foreground">
                      {selectedMissing.size} keyword{selectedMissing.size === 1 ? "" : "s"} selected. Only tick ones that truly apply to you — nothing will be fabricated.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedMissing(new Set())}
                        disabled={loading}
                      >
                        Clear
                      </Button>
                      <Button size="sm" onClick={handleRegenerateWithKeywords} disabled={loading}>
                        <Sparkles className="h-4 w-4" />
                        {loading ? "Regenerating…" : "Regenerate with selected"}
                      </Button>
                    </div>
                  </div>
                )}
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
                    {(["tailored", "original", "compare", "diff"] as CvView[]).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setCvView(v)}
                        className={`px-2.5 py-1.5 capitalize ${cvView === v ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"} ${v !== "tailored" ? "border-l border-border" : ""}`}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline">PDF style:</span>
                    <div className="inline-flex rounded-md border border-border overflow-hidden text-xs" role="group" aria-label="PDF template">
                      <button
                        type="button"
                        onClick={() => setPdfTemplate("ats")}
                        title="Plain, single-column, maximum ATS compatibility"
                        aria-pressed={pdfTemplate === "ats"}
                        className={`px-2.5 py-1.5 ${pdfTemplate === "ats" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"}`}
                      >
                        ATS
                      </button>
                      <button
                        type="button"
                        onClick={() => setPdfTemplate("modern")}
                        title="Dark header band with your name, subtle accents"
                        aria-pressed={pdfTemplate === "modern"}
                        className={`px-2.5 py-1.5 border-l border-border ${pdfTemplate === "modern" ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted"}`}
                      >
                        Modern
                      </button>
                    </div>
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
              {cvView === "tailored" && (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                  {tailoredCv}
                </pre>
              )}
              {cvView === "original" && (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
                  {cvText}
                </pre>
              )}
              {cvView === "compare" && (
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Original</div>
                    <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground max-h-[600px] overflow-auto rounded border border-border p-3 bg-muted/30">
                      {cvText}
                    </pre>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Tailored</div>
                    <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground max-h-[600px] overflow-auto rounded border border-border p-3">
                      {tailoredCv}
                    </pre>
                  </div>
                </div>
              )}
              {cvView === "diff" && (
                <div className="rounded border border-border p-3 max-h-[600px] overflow-auto font-mono text-xs leading-relaxed">
                  {diff.length === 0 && (
                    <p className="text-muted-foreground">No differences to show.</p>
                  )}
                  {diff.map((part, i) => (
                    <pre
                      key={i}
                      className={`whitespace-pre-wrap ${
                        part.added ? "bg-green-500/10 text-green-700 dark:text-green-400"
                        : part.removed ? "bg-red-500/10 text-red-700 dark:text-red-400 line-through opacity-70"
                        : "text-muted-foreground"
                      }`}
                    >
                      {part.value}
                    </pre>
                  ))}
                </div>
              )}
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

            <Card className="p-6 md:p-8 shadow-sm">
              <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Refine with feedback
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Not quite right? Tell the AI how to adjust and regenerate.
                e.g. “more concise”, “stronger on leadership”, “less technical, more strategy”.
              </p>
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="What should be different this time?"
                className="min-h-[80px] text-sm mb-3"
                maxLength={500}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleRegenerateWithFeedback} disabled={loading || !feedback.trim()}>
                  <Sparkles className="h-4 w-4" />
                  {loading ? "Regenerating…" : "Regenerate with feedback"}
                </Button>
              </div>
            </Card>
          </section>
        )}

        {!tailoredCv && !loading && (
          <section className="mt-10 text-center text-sm text-muted-foreground">
            <p>Ready when you are. Your tailored CV, cover letter, ATS report and fabrication check will appear here.</p>
          </section>
        )}
      </main>

      {historyOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          onClick={() => setHistoryOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="History"
        >
          <div
            className="w-full max-w-md h-full bg-background border-l border-border shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 flex items-center justify-between px-5 py-3 border-b border-border bg-background">
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <History className="h-4 w-4" /> History
              </h2>
              <div className="flex items-center gap-1">
                {history.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (window.confirm("Clear all history?")) {
                        clearHistory();
                        setHistory([]);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="p-4 space-y-2">
              {history.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No runs yet. Tailored CVs will show up here.
                </p>
              )}
              {history.map((h) => (
                <div key={h.id} className="rounded border border-border p-3 hover:bg-muted/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => restoreFromHistory(h)}
                      className="text-left flex-1"
                    >
                      <div className="text-sm font-medium text-foreground">
                        {h.jobTitle || "Untitled role"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {new Date(h.createdAt).toLocaleString()}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {h.jobDescription.slice(0, 120)}…
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => { removeHistory(h.id); setHistory(listHistory()); }}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className="border-t border-border/60 mt-16 py-6 text-center text-xs text-muted-foreground">
        CVFoundry · Built with Lovable
      </footer>
    </div>
  );
}
