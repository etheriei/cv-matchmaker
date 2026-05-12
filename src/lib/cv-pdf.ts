import { jsPDF } from "jspdf";

export type CvPdfTemplate = "ats" | "modern";

// Generates a clean, ATS-friendly single-column PDF using standard fonts.
export function generateCvPdf(
  cvText: string,
  fileName = "tailored-cv.pdf",
  template: CvPdfTemplate = "ats",
) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 56;
  let marginTop = 56;
  const marginBottom = 56;
  const maxWidth = pageWidth - marginX * 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);

  const lineHeight = 14;

  // Strip residual markdown defensively
  const clean = cvText
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/^#+\s*/gm, "");

  const lines = clean.split("\n");

  // Modern template: top accent band with the candidate's name (first non-empty,
  // non-heading line) rendered large.
  if (template === "modern") {
    const firstLine = lines.find((l) => l.trim().length > 0)?.trim() ?? "";
    const bandHeight = 64;
    doc.setFillColor(31, 41, 55); // slate-800
    doc.rect(0, 0, pageWidth, bandHeight, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(firstLine || "Curriculum Vitae", marginX, 40);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    marginTop = bandHeight + 24;
    // Skip the consumed name line
    if (firstLine) {
      const idx = lines.findIndex((l) => l.trim() === firstLine);
      if (idx !== -1) lines.splice(idx, 1);
    }
  }

  let y = marginTop;

  const isHeading = (line: string) => {
    const t = line.trim();
    if (!t) return false;
    if (t.length > 60) return false;
    const letters = t.replace(/[^A-Za-z]/g, "");
    if (letters.length < 2) return false;
    return letters === letters.toUpperCase();
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
    }
  };

  // Match URLs and bare emails. We'll also normalize emails to mailto: links.
  const URL_REGEX = /\b((?:https?:\/\/|www\.)[^\s,;)<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

  const drawLineWithLinks = (text: string, x: number, baselineY: number) => {
    doc.text(text, x, baselineY);
    URL_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    const fontSize = doc.getFontSize();
    while ((m = URL_REGEX.exec(text)) !== null) {
      const raw = m[0].replace(/[.,;:)\]]+$/, "");
      const start = m.index;
      const before = text.slice(0, start);
      const beforeWidth = doc.getTextWidth(before);
      const linkWidth = doc.getTextWidth(raw);
      let url = raw;
      if (/^www\./i.test(url)) url = "https://" + url;
      else if (/^[^\s@]+@[^\s@]+$/.test(url)) url = "mailto:" + url;
      // Underline the link
      const underlineY = baselineY + 1.5;
      doc.setDrawColor(0, 0, 238);
      doc.line(x + beforeWidth, underlineY, x + beforeWidth + linkWidth, underlineY);
      // Clickable area
      doc.link(x + beforeWidth, baselineY - fontSize, linkWidth, fontSize + 2, { url });
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    if (line.trim() === "") {
      y += lineHeight * 0.5;
      continue;
    }

    if (isHeading(line)) {
      ensureSpace(lineHeight * 1.8);
      y += lineHeight * 0.4;
      if (template === "modern") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(31, 41, 55);
        doc.text(line.trim().toUpperCase(), marginX, y);
        y += lineHeight;
        doc.setDrawColor(31, 41, 55);
        doc.setLineWidth(1.2);
        doc.line(marginX, y - 8, marginX + 36, y - 8);
        doc.setLineWidth(0.2);
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        y += 6;
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.text(line.trim(), marginX, y);
        y += lineHeight;
        doc.setDrawColor(180);
        doc.line(marginX, y - 8, pageWidth - marginX, y - 8);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        y += 4;
      }
      continue;
    }

    const wrapped = doc.splitTextToSize(line, maxWidth) as string[];
    for (const w of wrapped) {
      ensureSpace(lineHeight);
      drawLineWithLinks(w, marginX, y);
      y += lineHeight;
    }
  }

  doc.save(fileName);
}
