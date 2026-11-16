# NURO SEO Center — setup

The SEO module is added as a separate route group and does not replace the existing media downloader routes.

## 1. Backend environment variables

Add these in the backend host's environment settings (Railway, not in frontend `config.js`):

- `GEMINI_API_KEY` — private Google Gemini API key
- `GEMINI_MODEL` — optional; defaults to `gemini-3.5-flash-lite`
- `MAX_SEO_AI_PER_MINUTE` — optional; defaults to `8`
- `FRONTEND_ORIGIN` — include the exact frontend origins, for example `https://www.allneedtools.com,https://allneedtools.com`

Do not put the Gemini key in frontend files, HTML, JavaScript, Git, or a public ZIP. Use an adult-managed Google account/API project where required by Google's terms. Review the current API terms, free-tier data use and billing settings before enabling it; avoid sending private or sensitive information to the AI service.

## 2. Deploy

Redeploy the backend after setting the environment variables. The existing `/api/resolve`, `/api/search`, and `/api/file` routes remain in place. New routes:

- `GET /api/seo/health` — checks whether the AI key is configured (does not reveal it)
- `POST /api/seo/ai` — AI writer, keyword ideas, campaign plan and text-based on-page review

The API has a lightweight per-instance request limit. For a public production service with meaningful traffic, add shared rate limiting and authentication/abuse protection before scaling.

## 3. Frontend

The frontend reads the existing `window.NURO_CONFIG.API_BASE_URL` from `config.js`. Keep it pointed at the existing Railway HTTPS backend. Deploy the updated frontend static files to the existing hosting project.

## 4. Important feature boundaries

- Campaign plans and backlink tracker records are stored in the visitor's browser `localStorage`; they are not shared between devices and are not stored in the backend database.
- The backlink tracker is a manual organizer. It does not crawl or verify backlinks.
- Keyword ideas are AI suggestions, not measured search volume, CPC, difficulty or ranking data.
- The on-page review analyzes text supplied by the user; it is not a live website crawl or technical audit.
- Actual backlink discovery, ranking metrics and search-volume data require a separate licensed SEO data provider and its API credentials.
- The campaign planner is designed for useful content and genuine manual outreach, not automated link spam.
