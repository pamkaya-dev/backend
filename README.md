NURO MEDIA DOWNLOADER — UPDATED BUILD 2.1.0

PROJECT STRUCTURE
- frontend/ : static website
- backend/  : Node.js API

BACKEND DEPLOYMENT (Railway)
1. Create a Railway project and deploy the contents of the backend/ folder.
2. Use Node.js 18.18+ (Node 20 LTS recommended).
3. Add these Railway Variables:
   SUPUN_API_KEY       = your NEW API key
   PROXY_SECRET        = a long random secret (keep it private and stable)
   PROXY_DOWNLOADS     = true
   FRONTEND_ORIGIN     = https://your-site.github.io
   DEBUG               = false
   MAX_RESOLVES_PER_MINUTE = 30
4. Do not put the API key in frontend/config.js or any frontend file.
5. After deployment, check:
   https://YOUR-RAILWAY-DOMAIN/health
   It should return {"ok":true,"service":"nuro-media-api"}.
6. Keep the same PROXY_SECRET after redeploys. Changing it invalidates old download links.

LOCAL BACKEND
1. Open a terminal in backend/.
2. Run: npm install
3. Copy .env.example to .env and fill in your key and a private PROXY_SECRET.
4. Run: npm start
5. Do not upload or share .env.

FRONTEND
1. Open frontend/config.js.
2. Set API_BASE_URL to your Railway HTTPS domain, without a trailing slash.
3. Deploy the frontend folder to your static host (for example GitHub Pages).

SUPPORTED NORMALIZATION
- TikTok: cover, title, watermark / no-watermark / HD variants, original sound MP3.
- Facebook: title, SD / HD variants, duration, thumbnail fallback from public page metadata.
- YouTube / Instagram: existing DTZ provider adapter retained.
- API response includes status, platform, title, duration, thumbnail and normalized items.

SECURITY / OPERATIONS
- Rotate any API key previously posted in chat or exposed publicly.
- Set the replacement only as Railway's SUPUN_API_KEY variable.
- Keep .env private; it is ignored by Git.
- The API has basic in-memory resolve rate limiting. For multi-instance production deployments,
  use a shared rate limiter at the hosting/proxy layer.
- Provider/CDN links can expire or be blocked by their source platforms. Resolve the link again
  if a download reports an expired link.
- Only download media you own or have permission to save. Respect platform terms and creators' rights.
