import "dotenv/config";
import express from "express";
import cors from "cors";
import router from "./routes/download.js";
import seoRouter from "./routes/seo.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",").map(value => value.trim().replace(/\/+$/, "")).filter(Boolean);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});
app.use(cors({
  origin(origin, callback) {
    // Requests without Origin (health checks / command-line clients) are allowed.
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  methods: ["GET", "HEAD", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Range"],
  exposedHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "Content-Disposition"],
  maxAge: 86400
}));

// Lightweight per-instance limit for resolve requests.
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_RESOLVES = Number(process.env.MAX_RESOLVES_PER_MINUTE) || 30;
app.use(express.json({ limit: "16kb", strict: true }));

app.use(["/api/resolve", "/api/search"], (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  let record = hits.get(ip);
  if (!record || now - record.start >= WINDOW_MS) record = { start: now, count: 0 };
  record.count += 1;
  hits.set(ip, record);
  if (hits.size > 5000) {
    for (const [key, value] of hits) if (now - value.start >= WINDOW_MS) hits.delete(key);
  }
  if (record.count > MAX_RESOLVES) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ status: false, error: "Requests වැඩියි. විනාඩියකින් නැවත උත්සාහ කරන්න." });
  }
  next();
});

// Lightweight per-instance SEO AI request limit.
const seoHits = new Map();
app.use("/api/seo/ai", (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  let record = seoHits.get(ip);
  if (!record || now - record.start >= WINDOW_MS) record = { start: now, count: 0 };
  record.count += 1;
  seoHits.set(ip, record);
  if (seoHits.size > 5000) {
    for (const [key, value] of seoHits) if (now - value.start >= WINDOW_MS) seoHits.delete(key);
  }
  if (record.count > (Number(process.env.MAX_SEO_AI_PER_MINUTE) || 8)) {
    res.setHeader("Retry-After", "60");
    return res.status(429).json({ status: false, error: "SEO AI request limit reached. Please wait one minute." });
  }
  next();
});

app.get("/", (_req, res) => res.json({ name: "NURO MEDIA API", status: true, version: "2.1.0", modules: ["media", "seo"] }));
app.get("/health", (_req, res) => res.json({ ok: true, service: "nuro-media-api" }));
app.use("/api/seo", seoRouter);
app.use("/api", router);
app.use((_req, res) => res.status(404).json({ status: false, error: "API route not found" }));
app.use((error, _req, res, _next) => {
  console.error("[server error]", error);
  if (!res.headersSent) res.status(500).json({ status: false, error: "Internal server error" });
});

app.listen(PORT, () => console.log(`NURO Media API listening on ${PORT}`));
