import mammoth from "mammoth";

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    return extractPdf(file);
  }
  if (name.endsWith(".docx") || name.endsWith(".doc")) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value.trim();
  }
  throw new Error("Unsupported file type. Please upload a PDF, DOC, or DOCX file.");
}

async function extractPdf(file: File): Promise<string> {
  // Dynamic import so pdfjs only loads in the browser
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (
    await import("pdfjs-dist/build/pdf.worker.min.mjs?url" as string)
  ).default as string;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      .map((item: unknown) => (item as { str?: string }).str ?? "")
      .filter(Boolean);
    fullText += strings.join(" ") + "\n\n";
  }
  return fullText.trim();
}