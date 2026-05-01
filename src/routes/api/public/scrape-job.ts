import { createFileRoute } from "@tanstack/react-router";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/firecrawl";

export const Route = createFileRoute("/api/public/scrape-job")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { url } = (await request.json()) as { url?: string };
          if (!url || typeof url !== "string") {
            return Response.json({ error: "Missing url" }, { status: 400 });
          }
          try {
            const u = new URL(url);
            if (!/^https?:$/.test(u.protocol)) throw new Error("bad protocol");
          } catch {
            return Response.json({ error: "Invalid URL" }, { status: 400 });
          }

          const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
          const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
          if (!LOVABLE_API_KEY) {
            return Response.json({ error: "Server not configured (LOVABLE_API_KEY)" }, { status: 500 });
          }
          if (!FIRECRAWL_API_KEY) {
            return Response.json({ error: "Server not configured (FIRECRAWL_API_KEY)" }, { status: 500 });
          }

          const res = await fetch(`${GATEWAY_URL}/v2/scrape`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "X-Connection-Api-Key": FIRECRAWL_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              url,
              formats: ["markdown"],
              onlyMainContent: true,
            }),
          });

          const data = await res.json().catch(() => null) as
            | { success?: boolean; data?: { markdown?: string; metadata?: { title?: string } }; markdown?: string; metadata?: { title?: string }; error?: string }
            | null;

          if (!res.ok || !data) {
            return Response.json(
              { error: "Could not fetch that job page. Try pasting the description manually." },
              { status: 502 },
            );
          }

          const markdown = data.markdown ?? data.data?.markdown ?? "";
          const title = data.metadata?.title ?? data.data?.metadata?.title ?? "";

          if (!markdown || markdown.trim().length < 50) {
            return Response.json(
              { error: "Couldn't extract a job description from that URL." },
              { status: 422 },
            );
          }

          // Trim to avoid huge payloads downstream
          const text = markdown.length > 12000 ? markdown.slice(0, 12000) : markdown;
          return Response.json({ text, title });
        } catch (err) {
          console.error("scrape-job error", err);
          return Response.json({ error: "Unexpected error scraping job URL." }, { status: 500 });
        }
      },
    },
  },
});