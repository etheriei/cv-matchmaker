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

          // LinkedIn (and a few other sites) require login and block scrapers.
          const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
          const blockedHosts = ["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com"];
          const isBlockedHost = blockedHosts.some((h) => host === h || host.endsWith(`.${h}`));

          if (!res.ok || !data) {
            console.error("Firecrawl error", res.status, JSON.stringify(data));
            if (isBlockedHost) {
              return Response.json(
                {
                  error:
                    `${host} requires login and blocks automated scraping. Open the job, copy the description, and paste the text into the field instead, or use the company's own careers page link.`,
                },
                { status: 422 },
              );
            }
            return Response.json(
              { error: data?.error || "Could not fetch that job page. Try pasting the description manually." },
              { status: 502 },
            );
          }

          const markdown = data.markdown ?? data.data?.markdown ?? "";
          const title = data.metadata?.title ?? data.data?.metadata?.title ?? "";

          if (!markdown || markdown.trim().length < 50) {
            if (isBlockedHost) {
              return Response.json(
                {
                  error:
                    `${host} requires login and blocks automated scraping. Paste the job description text directly, or use the company's careers page URL.`,
                },
                { status: 422 },
              );
            }
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