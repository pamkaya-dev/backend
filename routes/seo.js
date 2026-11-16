import { Router } from "express";

const router = Router();
const MAX_TEXT = 5000;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

function clean(value, max = MAX_TEXT) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function buildPrompt(action, input) {
  const topic = clean(input.topic, 240);
  const keyword = clean(input.keyword, 160);
  const site = clean(input.site, 240);
  const audience = clean(input.audience, 180);
  const language = clean(input.language, 40) || "English";
  const details = clean(input.details, MAX_TEXT);
  const common = `You are NURO SEO Assistant. Provide ethical, useful, search-friendly guidance. Never claim you created backlinks, verified search volume, checked rankings, or accessed live SEO databases. Do not recommend buying links, link farms, automated comment/forum spam, doorway pages, cloaking, or keyword stuffing. Prefer helpful content, technical quality, and genuine editorial outreach. Respond in ${language}.`;

  if (action === "writer") return `${common}\nCreate a high-quality SEO content brief and draft for this topic: ${topic || "(not supplied)"}. Primary keyword: ${keyword || "not supplied"}. Audience: ${audience || "general readers"}. Website: ${site || "not supplied"}. Additional context: ${details || "none"}. Include SEO title, meta description, suggested URL slug, H1, H2 outline, a useful article draft, FAQ ideas, and natural internal-link suggestions. Do not invent statistics or sources.`;
  if (action === "keywords") return `${common}\nGenerate keyword ideas for topic ${topic || "(not supplied)"}. Website: ${site || "not supplied"}. Audience: ${audience || "general readers"}. Additional context: ${details || "none"}. Group them into primary, long-tail, question, and supporting terms. For each, explain search intent and content angle. Do not invent search volume, CPC, difficulty scores, or ranking data; clearly label these as AI-generated ideas.`;
  if (action === "campaign") return `${common}\nCreate a 30-day ethical SEO campaign plan for website ${site || "(not supplied)"}, topic ${topic || "(not supplied)"}, primary keyword ${keyword || "not supplied"}. Audience: ${audience || "general readers"}. Context: ${details || "none"}. Include weekly tasks, content improvements, technical checks, and genuine outreach ideas. Provide measurable tasks, but do not promise rankings or fabricate backlinks. Explain that outreach targets must be reviewed and contacted manually.`;
  if (action === "audit") return `${common}\nReview this user-provided on-page SEO information for website ${site || "(not supplied)"}. Page/topic: ${topic || "not supplied"}. Primary keyword: ${keyword || "not supplied"}. Page title, meta description, headings, and page content supplied by the user: ${details || "No page details supplied"}. Identify issues and provide a prioritized checklist. State that this is a text-based review, not a live crawl or technical verification.`;
  throw Object.assign(new Error("Unsupported SEO action."), { statusCode: 400 });
}

router.get("/health", (_req, res) => {
  res.json({ status: true, service: "nuro-seo", aiConfigured: Boolean(process.env.GEMINI_API_KEY), model: MODEL });
});

router.post("/ai", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(503).json({ status: false, error: "AI is not configured yet. Add GEMINI_API_KEY to the backend environment variables." });

    const action = clean(req.body?.action, 24);
    const prompt = buildPrompt(action, req.body || {});
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.55, maxOutputTokens: 3500 }
      }),
      signal: AbortSignal.timeout(55000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.error?.message || `Gemini API returned HTTP ${response.status}`;
      const status = response.status === 429 ? 429 : response.status === 400 ? 400 : 502;
      return res.status(status).json({ status: false, error: status === 429 ? "AI request limit reached. Please wait and try again." : message });
    }
    const text = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("\n").trim();
    if (!text) return res.status(502).json({ status: false, error: "The AI provider returned an empty response. Please try again." });
    res.set("Cache-Control", "no-store");
    return res.json({ status: true, action, model: MODEL, text });
  } catch (error) {
    const status = error.statusCode || (error.name === "TimeoutError" ? 504 : 502);
    return res.status(status).json({ status: false, error: error.name === "TimeoutError" ? "AI request timed out. Please try again." : (error.message || "Unable to generate SEO content.") });
  }
});

export default router;
