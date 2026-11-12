import { Router } from "express";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveMedia, UA } from "../services/provider.js";

const router = Router();
const SECRET = process.env.PROXY_SECRET || crypto.randomBytes(32).toString("hex");
const PROXY = String(process.env.PROXY_DOWNLOADS || "true").toLowerCase() !== "false";
if (!process.env.PROXY_SECRET) console.warn("[security] Set a persistent PROXY_SECRET in Railway to keep download links valid across restarts/instances.");

const HOSTS = {
  youtube: ["youtube.com", "youtu.be"],
  instagram: ["instagram.com"],
  tiktok: ["tiktok.com"],
  facebook: ["facebook.com", "fb.watch", "fb.com"]
};
const REFS = [
  [/tiktok|tikwm/i, "https://www.tiktok.com/"],
  [/fbcdn|facebook|fb\./i, "https://www.facebook.com/"],
  [/instagram/i, "https://www.instagram.com/"]
];
const refFor = value => {
  try {
    const host = new URL(value).hostname;
    return REFS.find(([re]) => re.test(host))?.[1];
  } catch { return undefined; }
};

const hostIn = (host, domains) => domains.some(domain => host === domain || host.endsWith("." + domain));
const platformOf = host => Object.keys(HOSTS).find(platform => hostIn(host, HOSTS[platform]));

function parseUrl(raw) {
  let url;
  try { url = new URL(String(raw || "").trim()); }
  catch { throw Object.assign(new Error("නිවැරදි video link එකක් ඇතුළත් කරන්න."), { statusCode: 400 }); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
    throw Object.assign(new Error("නිවැරදි HTTPS video link එකක් භාවිත කරන්න."), { statusCode: 400 });
  }
  if (url.port === "80") url.port = "";
  url.protocol = "https:";
  url.hash = "";
  const platform = platformOf(url.hostname.toLowerCase());
  if (!platform) throw Object.assign(new Error("YouTube, Instagram, TikTok හෝ Facebook link එකක් භාවිත කරන්න."), { statusCode: 400 });
  return { url, platform };
}

async function expand(url, platform) {
  const short = /^(vm|vt)\.tiktok\.com$/.test(url.hostname) ||
    url.hostname === "fb.watch" || /^\/share\//i.test(url.pathname);
  if ((platform === "tiktok" || platform === "facebook") && short) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8000)
      });
      const finalUrl = new URL(response.url);
      if (platformOf(finalUrl.hostname) === platform && !/login|checkpoint/i.test(finalUrl.pathname)) url = finalUrl;
    } catch { /* Provider may still understand the original share URL. */ }
  }
  if (platform === "tiktok") url.search = "";
  return url.href;
}

// Facebook often omits thumbnail in the downloader API. Try the public page's OG image.
async function pageThumbnail(pageUrl) {
  try {
    const response = await fetch(pageUrl, {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) return "";
    const html = (await response.text()).slice(0, 1_200_000);
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const property = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!["og:image", "og:image:url", "twitter:image"].includes(property)) continue;
      const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!content) continue;
      const imageUrl = content.replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
      const parsed = new URL(imageUrl, response.url);
      if (parsed.protocol === "https:") return parsed.href;
    }
  } catch (error) {
    console.warn("[page thumbnail]", error.message);
  }
  return "";
}

async function thumbData(url) {
  try {
    if (!/^https:\/\//i.test(url)) return null;
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        ...(refFor(url) && { Referer: refFor(url) })
      },
      signal: AbortSignal.timeout(6500)
    });
    const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (!response.ok || !type.startsWith("image/") || (declaredSize && declaredSize > 1_500_000)) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > 1_500_000) return null;
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn("[thumbnail proxy]", error.message);
    return null;
  }
}

const sign = url => {
  const payload = Buffer.from(JSON.stringify({ u: url, e: Date.now() + 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
};

function verify(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) throw new Error("Invalid download token");
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error("Invalid download token");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!data?.u || !Number.isFinite(data.e) || Date.now() > data.e) throw new Error("Expired download token");
  const url = new URL(data.u);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid download URL");
  return url.href;
}

function youtubeThumbnail(url) {
  const id = url.searchParams.get("v") ||
    (url.hostname === "youtu.be" ? url.pathname.slice(1) : url.pathname.split("/").filter(Boolean).pop());
  return /^[\w-]{6,15}$/.test(id || "") ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : "";
}

router.get("/resolve", async (req, res) => {
  try {
    const { url, platform } = parseUrl(req.query.url);
    const format = req.query.format === "mp3" ? "mp3" : "mp4";
    const resolvedUrl = await expand(url, platform);
    const data = await resolveMedia(platform, resolvedUrl, format);
    let thumbnail = data.thumbnail || (platform === "youtube" ? youtubeThumbnail(url) : "");
    if (!thumbnail && platform === "facebook") thumbnail = await pageThumbnail(resolvedUrl);

    const safeBase = (data.title || platform).replace(/[^\p{L}\p{N}_\- ]+/gu, "").trim().slice(0, 55) || platform;
    const items = (Array.isArray(data.items) ? data.items : []).map((item, index) => {
      const ext = item.type === "audio" || item.format === "MP3" ? "mp3" : "mp4";
      const filename = encodeURIComponent(`${safeBase}-${index + 1}.${ext}`);
      return {
        id: index,
        type: item.type || "video",
        format: item.format || (ext === "mp3" ? "MP3" : "MP4"),
        quality: item.quality || "",
        label: item.label || item.format || "Download",
        url: item.url,
        proxy: PROXY ? `/api/file?t=${sign(item.url)}&name=${filename}` : null
      };
    }).filter(item => typeof item.url === "string" && item.url.startsWith("https://"));

    if (!items.length) throw Object.assign(new Error("මෙම link එකට download options හමු වුණේ නැහැ."), { statusCode: 502 });

    res.set("Cache-Control", "no-store");
    res.json({
      status: true,
      platform,
      title: data.title || `${platform} media`,
      duration: data.duration || null,
      thumbnail: thumbnail || null,
      thumbnail_data: thumbnail ? await thumbData(thumbnail) : null,
      thumbnail_proxy: PROXY && thumbnail?.startsWith("https://") ? `/api/file?inline=1&t=${sign(thumbnail)}&name=thumbnail.jpg` : null,
      items
    });
  } catch (error) {
    if (process.env.DEBUG && error.detail) console.warn("[resolve details]", error.detail);
    const status = error.statusCode || (error.name === "TimeoutError" ? 504 : 400);
    res.status(status).json({
      status: false,
      error: error.name === "TimeoutError"
        ? "Provider response එක ප්‍රමාදයි. ටික වෙලාවකින් නැවත උත්සාහ කරන්න."
        : (error.message || "Unable to resolve this link.")
    });
  }
});

router.get("/file", async (req, res) => {
  let upstream;
  try {
    const url = verify(req.query.t);
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    upstream = await fetch(url, {
      headers: {
        "User-Agent": UA,
        ...(refFor(url) && { Referer: refFor(url) }),
        ...(req.headers.range && { Range: req.headers.range })
      },
      signal: controller.signal,
      redirect: "follow"
    });
    if ((!upstream.ok && upstream.status !== 206) || !upstream.body) throw new Error(`upstream HTTP ${upstream.status}`);
    const finalUrl = new URL(upstream.url || url);
    if (finalUrl.protocol !== "https:") throw new Error("Unsafe upstream redirect");
    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    const filename = String(req.query.name || "nuro-download.mp4").replace(/[^\w.\- ]+/g, "").slice(0, 80) || "nuro-download.mp4";
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `${req.query.inline ? "inline" : "attachment"}; filename="${filename}"`);
    if (req.query.inline) res.setHeader("Cache-Control", "private, max-age=1800");
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch (error) {
    if (!res.headersSent) {
      const status = error.name === "TimeoutError" ? 504 : 502;
      res.status(status).json({ status: false, error: "Download link එක කල් ඉකුත් වී හෝ provider එකෙන් අවහිර වී ඇත. නැවත link එක resolve කරන්න." });
    } else {
      res.destroy(error);
    }
  }
});

export default router;
