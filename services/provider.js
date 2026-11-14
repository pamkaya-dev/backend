// Provider adapters normalize TikTok, Facebook, Instagram and YouTube responses.
const DTZ = (process.env.DTZ_API_BASE_URL || "https://dtz-movie-script.vercel.app").replace(/\/+$/, "");
export const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

async function getJSON(url, ms = 22000) {
  const r = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": UA },
    signal: AbortSignal.timeout(ms)
  });
  const t = await r.text();
  if (t.length > 4_000_000) throw new Error("Provider response is too large");
  let d;
  try { d = JSON.parse(t); }
  catch { throw new Error(`Provider returned invalid JSON (HTTP ${r.status})`); }
  if (!r.ok) throw new Error(d?.message || d?.error || `Provider HTTP ${r.status}`);
  return d;
}

function findThumb(node) {
  let best = "";
  const walk = (n, k = "") => {
    if (best) return;
    if (typeof n === "string") {
      if (/^https:\/\//i.test(n) && (/thumb|cover|image|poster|preview|photo|pic/i.test(k) || /\.(jpe?g|png|webp)(\?|$)/i.test(n))) best = n;
    } else if (Array.isArray(n)) n.forEach(x => walk(x, k));
    else if (n && typeof n === "object") Object.entries(n).forEach(([kk, v]) => walk(v, kk));
  };
  walk(node);
  return best;
}

const mk = (rawUrl, options = {}, base) => {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return null;
  try {
    const u = new URL(rawUrl.trim(), base);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return { type: "video", format: "MP4", quality: "", label: "", ...options, url: u.href };
  } catch { return null; }
};

function scan(node, key = "", out = []) {
  if (typeof node === "string") {
    if (/^https:\/\//i.test(node) && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(node) && /mp4|mp3|m4a|video|audio|download|play|googlevideo|fbcdn/i.test(node)) out.push({ url: node, key });
  } else if (Array.isArray(node)) node.forEach(n => scan(n, key, out));
  else if (node && typeof node === "object") Object.entries(node).forEach(([k, v]) => scan(v, k, out));
  return out;
}
const meta = d => {
  const r = d?.result || d?.results || d?.data || d || {};
  return {
    title: r.title || r.caption || "",
    thumbnail: r.thumbnail || r.thumb || r.cover || r.image || findThumb(d) || ""
  };
};
const fromScan = d => ({
  ...meta(d),
  items: scan(d).map(({ url, key }, i) => {
    const audio = /mp3|audio|music|m4a/i.test(key + url);
    return mk(url, audio
      ? { type: "audio", format: "MP3", label: "MP3 · Audio" }
      : { quality: key, label: `MP4 · ${/hd/i.test(key) ? "HD" : /sd/i.test(key) ? "SD" : `Option ${i + 1}`}` });
  }).filter(Boolean)
});

async function supun(path, url) {
  const key = process.env.SUPUN_API_KEY;
  if (!key) throw new Error("SUPUN_API_KEY is not configured on the backend");
  const endpoint = new URL(`https://supunofc.site/api/download/${path}`);
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("apikey", key);
  return getJSON(endpoint.href);
}

async function supunTikTok(url) {
  // API shape: { success, results: { status, title, cover, data[], music_info } }
  const d = await supun("down/tiktok/dl", url);
  const r = d?.results;
  if (d?.success !== true || r?.status !== true) throw new Error(d?.message || r?.message || "TikTok provider returned no media");
  const names = {
    watermark: "Watermark",
    nowatermark: "No watermark",
    nowatermark_hd: "HD · No watermark"
  };
  const items = (Array.isArray(r.data) ? r.data : []).map((m, i) =>
    mk(m?.url, { quality: m?.type || "", label: `MP4 · ${names[m?.type] || `Option ${i + 1}`}` })
  );
  const musicUrl = r.music_info?.url;
  if (musicUrl) items.push(mk(musicUrl, { type: "audio", format: "MP3", quality: "", label: "MP3 · Original sound" }));
  return {
    title: r.title || "",
    thumbnail: r.cover || findThumb(d) || "",
    duration: Number(r.durations) || null,
    items: items.filter(Boolean)
  };
}

async function tikwm(url) {
  const d = await getJSON(`https://www.tikwm.com/api/?hd=1&url=${encodeURIComponent(url)}`);
  const r = d?.data;
  if (d?.code !== 0 || !r) throw new Error(d?.msg || "TikTok fallback returned no media");
  const base = "https://www.tikwm.com";
  const items = [
    mk(r.hdplay, { quality: "hd", label: "MP4 · HD No watermark" }, base),
    mk(r.play, { quality: "sd", label: "MP4 · No watermark" }, base),
    mk(r.wmplay, { quality: "wm", label: "MP4 · Watermark" }, base),
    mk(r.music, { type: "audio", format: "MP3", label: "MP3 · Original sound" }, base)
  ];
  return { title: r.title || "", thumbnail: mk(r.cover, {}, base)?.url || findThumb(d) || "", items: items.filter(Boolean) };
}

async function supunFacebook(url) {
  // API shape: { success, result: { ok, title, thumbnail, duration, variants[] } }
  const d = await supun("facebook/dl", url);
  const r = d?.result;
  if (d?.success !== true || r?.ok !== true) throw new Error(d?.message || r?.error || "Facebook provider returned no media");
  const items = (Array.isArray(r.variants) ? r.variants : []).map((m, i) =>
    mk(m?.url, {
      format: String(m?.ext || "mp4").toUpperCase(),
      quality: m?.quality || "",
      label: `${String(m?.ext || "mp4").toUpperCase()} · ${m?.quality || `Option ${i + 1}`}`
    })
  ).filter(Boolean);
  return {
    title: r.title || "",
    thumbnail: r.thumbnail || findThumb(d) || "",
    duration: Number(r.duration) || null,
    items
  };
}

async function supunYouTube(url, format = "mp4") {
  // API shape: { success, result: { title, thumbnail, durationSeconds, videoStreams[], audioStreams[] } }
  const d = await supun("yt-down", url);
  const r = d?.result;
  if (d?.success !== true || !r) throw new Error(d?.message || "YouTube provider returned no media");

  const streams = format === "mp3"
    ? (Array.isArray(r.audioStreams) ? r.audioStreams : [])
    : (Array.isArray(r.videoStreams) ? r.videoStreams : []);

  const items = streams.map((stream, index) => {
    const audio = format === "mp3";
    const extension = String(stream?.extension || (audio ? "m4a" : "mp4")).toLowerCase();
    const quality = String(stream?.resolution || (audio ? "Audio Only" : ""));
    const size = stream?.sizeStr && stream.sizeStr !== "N/A" ? ` · ${stream.sizeStr}` : "";
    const label = audio
      ? `Audio · ${extension.toUpperCase()}${size}`
      : `${quality || stream?.format || `Video ${index + 1}`}${size}`;
    return mk(stream?.downloadUrl, {
      type: audio ? "audio" : "video",
      format: extension.toUpperCase(),
      extension,
      quality,
      label
    });
  }).filter(Boolean);

  return {
    title: r.title || "",
    thumbnail: r.thumbnail || "",
    duration: Number(r.durationSeconds) || null,
    items
  };
}

const dtz = kind => async url => fromScan(await getJSON(`${DTZ}/api/download/${kind}?url=${encodeURIComponent(url)}`));

const dtzList = (kind, pick) => async (url, format) => {
  const k = kind === "yt" ? (format === "mp3" ? "ytmp3" : "ytmp4") : kind;
  const d = await getJSON(`${DTZ}/api/download/${k}?url=${encodeURIComponent(url)}`);
  if (!d?.status || !d?.result) throw new Error(d?.message || "Provider returned no media");
  const r = d.result, audio = format === "mp3";
  const items = (Array.isArray(pick(r)) ? pick(r) : []).map((m, i) =>
    mk(m?.direct_url || m?.download_url || r.direct_url || r.download_url, kind === "yt"
      ? { type: audio ? "audio" : "video", format: audio ? "MP3" : "MP4", quality: m?.quality || "", label: m?.label || (m?.quality ? `${m.quality}${audio ? "kbps" : "p"}` : "Best") }
      : { type: m?.type || "video", format: m?.format || "MP4", quality: m?.quality || "", label: m?.label || `Media ${i + 1}` })
  ).filter(Boolean);
  return { title: r.title || "", thumbnail: r.thumbnail || findThumb(d) || "", items };
};

const CHAINS = {
  tiktok: [["Supun", supunTikTok], ["TikWM", tikwm], ["DTZ", dtz("tiktok")]],
  facebook: [["Supun", supunFacebook], ["DTZ", dtz("facebook")]],
  instagram: [["DTZ", dtzList("instagram", r => r.media || [r])]],
  youtube: [["Supun", supunYouTube]]
};

const rank = item => {
  if (item.type === "audio") return -100000;
  const q = String(item.quality || item.label || "").toLowerCase();
  const k = q.match(/(\d+)\s*k/);
  return k ? Number(k[1]) * 1000 : (parseInt(q, 10) || (/hd/i.test(q) ? 720 : 0));
};

export async function resolveMedia(platform, url, format = "mp4") {
  const chain = CHAINS[platform];
  if (!chain) throw Object.assign(new Error("Unsupported platform"), { statusCode: 400 });
  const errors = [];
  for (const [name, fn] of chain) {
    try {
      const result = await fn(url, format);
      if (result.items?.length) {
        const seen = new Set();
        result.thumbnail = String(result.thumbnail || "").replace(/^http:/i, "https:");
        result.items = result.items.filter(item => !seen.has(item.url) && seen.add(item.url)).sort((a, b) => rank(b) - rank(a));
        return result;
      }
      errors.push(`${name}: no media links`);
    } catch (e) {
      errors.push(`${name}: ${e.name === "TimeoutError" ? "timeout" : (e.message || "request failed")}`);
    }
  }
  console.warn(`[resolve ${platform}] ${errors.join(" | ")}`);
  const err = new Error("දැන් මෙම video එක ලබාගත නොහැක. Link එක public ද කියා පරීක්ෂා කර ටික වෙලාවකින් නැවත උත්සාහ කරන්න.");
  err.statusCode = 502;
  err.detail = errors;
  throw err;
}
