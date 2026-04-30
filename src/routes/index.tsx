import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Upload, FileText, Sparkles, Copy, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { extractTextFromFile } from "@/lib/extract-text";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "CV Tailor — Match your CV to any job in seconds" },
      {
        name: "description",
        content:
          "Upload your CV, paste a job description, and instantly get a tailored, recruiter-friendly CV with key improvements.",
      },
      { property: "og:title", content: "CV Tailor — AI CV optimisation" },
      {
        property: "og:description",
        content: "Tailor your CV to any job description in seconds.",
      },
    ],
  }),
});

function Index() {
  const [file, setFile] = useState<File | null>(null);
  const [cvText, setCvText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [parsing, setParsing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tailoredCv, setTailoredCv] = useState("");
  const [improvements, setImprovements] = useState<string[]>([]);
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

    try {
      const { data, error } = await supabase.functions.invoke("tailor-cv", {
        body: { cvText, jobDescription },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setTailoredCv(data.tailoredCv ?? "");
      setImprovements(Array.isArray(data.improvements) ? data.improvements : []);

      // Smooth scroll to results
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

  return (
    <div className="min-h-screen bg-background">
      <Toaster richColors position="top-center" />

      {/* Header */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="font-semibold tracking-tight">CV Tailor</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        {/* Hero */}
        <section className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Tailor your CV to any job
          </h1>
          <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-xl mx-auto">
            Upload your CV, paste a job description, and get a recruiter-ready,
            tailored version in seconds.
          </p>
        </section>

        {/* Input */}
        <Card className="p-6 md:p-8 shadow-sm">
          <div className="space-y-6">
            {/* Upload */}
            <div>
              <label className="text-sm font-medium text-foreground mb-2 block">
                Your CV
              </label>
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
                className="w-full border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/30 transition-colors rounded-lg px-6 py-8 flex flex-col items-center justify-center gap-2 disabled:opacity-60"
              >
                {file ? (
                  <>
                    <FileText className="h-6 w-6 text-primary" />
                    <span className="text-sm font-medium text-foreground">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {parsing ? "Reading file…" : "Click to replace"}
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="h-6 w-6 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      Upload your CV
                    </span>
                    <span className="text-xs text-muted-foreground">PDF, DOC or DOCX</span>
                  </>
                )}
              </button>
            </div>

            {/* Job description */}
            <div>
              <label
                htmlFor="jd"
                className="text-sm font-medium text-foreground mb-2 block"
              >
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
              {loading ? "Optimising your CV…" : "Generate Tailored CV"}
            </Button>
          </div>
        </Card>

        {/* Loading */}
        {loading && (
          <div className="mt-8 text-center text-muted-foreground text-sm">
            Optimising your CV…
          </div>
        )}

        {/* Results */}
        {tailoredCv && !loading && (
          <section id="results" className="mt-10 space-y-6">
            <Card className="p-6 md:p-8 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">Tailored CV</h2>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> Copy CV
                    </>
                  )}
                </Button>
              </div>
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                {tailoredCv}
              </pre>
            </Card>

            {improvements.length > 0 && (
              <Card className="p-6 md:p-8 shadow-sm bg-accent/30 border-accent">
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-primary" />
                  Key Improvements
                </h2>
                <ul className="space-y-2">
                  {improvements.map((item, i) => (
                    <li key={i} className="flex gap-3 text-sm text-foreground">
                      <span className="text-primary mt-1">•</span>
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
        Built with Lovable
      </footer>
    </div>
  );
}
