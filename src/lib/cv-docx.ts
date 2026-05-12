import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  ExternalHyperlink, BorderStyle,
} from "docx";

const URL_REGEX = /\b((?:https?:\/\/|www\.)[^\s,;)<>"']+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

const isHeading = (line: string) => {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase();
};

const stripMd = (s: string) =>
  s.replace(/\*\*/g, "").replace(/\*/g, "").replace(/`/g, "").replace(/^#+\s*/gm, "");

function buildRuns(text: string): (TextRun | ExternalHyperlink)[] {
  const out: (TextRun | ExternalHyperlink)[] = [];
  URL_REGEX.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index) }));
    const raw = m[0].replace(/[.,;:)\]]+$/, "");
    let url = raw;
    if (/^www\./i.test(url)) url = "https://" + url;
    else if (/^[^\s@]+@[^\s@]+$/.test(url)) url = "mailto:" + url;
    out.push(
      new ExternalHyperlink({
        link: url,
        children: [new TextRun({ text: raw, style: "Hyperlink", color: "0000EE", underline: {} })],
      }),
    );
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last) }));
  if (out.length === 0) out.push(new TextRun({ text }));
  return out;
}

export async function generateCvDocx(cvText: string, fileName = "tailored-cv.docx") {
  const clean = stripMd(cvText);
  const lines = clean.split("\n");
  const paragraphs: Paragraph[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    if (line.trim() === "") {
      paragraphs.push(new Paragraph({ text: "" }));
      continue;
    }
    if (isHeading(line)) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
          border: {
            bottom: { color: "B0B0B0", size: 6, style: BorderStyle.SINGLE, space: 1 },
          },
          children: [new TextRun({ text: line.trim(), bold: true, size: 24 })],
        }),
      );
      continue;
    }
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        children: buildRuns(line),
      }),
    );
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
    sections: [{ properties: {}, children: paragraphs }],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
