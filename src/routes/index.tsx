import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  Upload, FileText, Sparkles, Copy, Check, AlertCircle,
  Download, ShieldCheck, ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractTextFromFile } from "@/lib/extract-text";
import { generateCvPdf } from "@/lib/cv-pdf";
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
  const [jobDescription, setJobDescription] = useState("");
  const [parsing, setParsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tailoredCv, setTailoredCv] = useState("");
  const [improvements, setImprovements] = useState<string[]>([]);
  const [ats, setAts] = useState<AtsReport | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleGenerate = async () => {
    if (!cvText.trim()) {
      toast.error("Please upload your CV first");
      return;
    }
    if (!jobDescription.trim() || jobDescription.trim().length < 30) {
      toast.error("Please paste a job description (at least a few sentences)");
      return;
    }

    setLoading(true);
    setTailoredCv("");
    setImprovements([]);
    setAts(null);

    try {
      const { data, error } = await supabase.functions.invoke("tailor-cv", {
        body: { cvText, jobDescription },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setTailoredCv(data.tailoredCv ?? "");
      setImprovements(Array.isArray(data.improvements) ? data.improvements : []);
      setAts(data.ats ?? null);

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
      generateCvPdf(tailoredCv, "CVFoundry-tailored-cv.pdf");
    } catch (e) {
      console.error(e);
      toast.error("Could not generate PDF");
    }
  };

  const scoreColor = (score: number) =>
    score >= 80 ? "text-foreground" : score >= 60 ? "text-foreground" : "text-destructive";

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-semibold tracking-tight">CVFoundry</span>
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
                Job description
              </label>
              <Textarea
                id="jd"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
                placeholder="Paste the full job description here…"
                className="min-h-[180px] resize-y"
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={loading || parsing || !cvText || !jobDescription}
              size="lg"
              className="w-full"
            >
              <Sparkles className="h-4 w-4" />
              {loading ? "Forging your CV…" : "Forge Tailored CV"}
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
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCopy}>
                    {copied ? (
                      <><Check className="h-4 w-4" /> Copied</>
                    ) : (
                      <><Copy className="h-4 w-4" /> Copy</>
                    )}
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
