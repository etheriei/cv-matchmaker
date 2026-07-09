## Scope

Implement the improvement list across three files: `src/routes/index.tsx`, `supabase/functions/tailor-cv/index.ts`, plus a new migration for history and CV profiles.

## Quick wins
1. **Save history** — new `tailor_runs` table (user_id, job_title, job_description, cv_text, result jsonb, created_at). Save after each successful run. Add a "History" drawer/sheet listing past runs; click to reload inputs + results.
2. **Copy-to-clipboard buttons** on tailored CV, cover letter, and positioning line (small icon button, toast on copy).
3. **Diff view** — toggle on tailored CV card to show a line-level diff vs the original (using `diff` npm package, added/removed lines highlighted).
4. **Character counter** under the JD textarea, showing `X / 30000`.

## Medium effort
5. **Multiple CV profiles** — new `cv_profiles` table (user_id, name, cv_text). Small profile picker above the CV textarea with "Save as profile" / "Load profile" / "Delete".
6. **Cover letter recipient fields** — optional `hiringManagerName` and `companyName` inputs, passed to edge fn and woven into salutation.
7. **Language output** — dropdown (English/Spanish/French/German/Dutch/Portuguese) passed to edge fn; system prompt instructs output language.
8. **Retry with feedback** — free-text "nudge" input on results view + "Regenerate with feedback" button that re-invokes with an extra instruction.

## Polish
9. **Loading skeletons** — replace spinner with skeleton cards for CV/cover/ATS while loading.
10. **Toast on PDF/DOCX download** confirming file name.
11. **Empty-state illustration** — simple SVG + friendly copy shown on first load when no results.

## Trust & safety
12. **Rate limiting** — per-user throttle in the edge function: new `tailor_rate_limits` table tracking count per hour; block >10 runs/hour with a friendly error.
13. **Fabrication guardrail** — second lightweight AI pass that compares tailored CV against original, flags claims not grounded in the source. Shown as a new "Fabrication check" card with any flagged items.

## Technical notes
- Auth already works via `requireSupabaseAuth` middleware pattern — new tables use RLS scoped to `auth.uid()`.
- Edge function stays the primary AI entry; guardrail runs as a second `fetch` inside the same handler.
- History/profiles UI uses shadcn `Sheet` + `Select` components (already present).
- `diff` package (~10kb) added via `bun add diff`.
- No changes to auth, routing, or existing PDF/DOCX generation logic.

## Out of scope
- Changing the AI model or prompt structure beyond additions above.
- Redesigning the main layout.
