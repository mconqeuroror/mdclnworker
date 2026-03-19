# Reel Finder — Full Stack Reference

Frontend, middleware, and backend for the Viral Reel Finder feature.

---

## 1. Server mount (backend entry)

**File:** `src/server.js`

```javascript
import viralReelsRoutes from './routes/viral-reels.routes.js';
// ...
// Mount BEFORE catch-all /api so /api/viral-reels/* is handled by this router
app.use('/api/viral-reels', viralReelsRoutes);
```

---

## 2. Backend routes

**File:** `src/routes/viral-reels.routes.js`

- **Auth:** `authMiddleware` (cookie or `Authorization: Bearer`) for most routes; `reelMediaAuth` for stream/media (cookie **or** `?token=` JWT with `type: "reel_media"`).
- **Subscription:** `requireSubscription` — allows `role === "admin"` or `premiumFeaturesUnlocked === true` or `subscriptionStatus` in `["active", "trialing"]`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | auth + subscription | List top reels (from `getTopReels`, limit 100). |
| GET | `/:id/stream-token` | auth + subscription | Issue short-lived JWT for `/:id/stream` (e.g. `?token=...`). |
| GET | `/:id/stream` | reelMediaAuth + subscription | Proxy stream reel video (redirects, 403→Apify refresh, R2 cache on success). |
| GET | `/:id/download` | auth + subscription | Download reel MP4: R2 URL → 302 redirect; else proxy with refresh on 403. |
| GET | `/media` | reelMediaAuth + subscription | Query `?url=...` — proxy image to client (allowed hosts only). |
| GET | `/admin/profiles` | auth + admin | List Reel Finder profiles with reel counts. |
| POST | `/admin/profiles` | auth + admin | Add profile by `username`. |
| POST | `/admin/profiles/bulk` | auth + admin | Add many profiles via `usernames[]`. |
| PATCH | `/admin/profiles/:id` | auth + admin | Update `isActive` or `scrapeGroup`. |
| DELETE | `/admin/profiles/:id` | auth + admin | Delete profile. |
| POST | `/admin/profiles/:id/scrape` | auth + admin | Scrape one profile (Apify). |
| POST | `/admin/clear-reels` | auth + admin | `deleteMany` on all `Reel` rows; body `{ rescrape?: boolean }` (default `true`) starts full pipeline when Apify is set. |
| POST | `/admin/trigger-scrape` | auth + admin | Start full scrape pipeline (background). |
| POST | `/admin/trigger-hot` | auth + admin | Re-scrape tier-1 hot reels. |
| POST | `/admin/trigger-warm` | auth + admin | Re-scrape tier-2 warm reels. |
| POST | `/admin/assign-groups` | auth + admin | Assign scrape groups to all profiles. |
| POST | `/admin/recalculate` | auth + admin | Recalculate viral scores (background). |
| GET | `/admin/logs` | auth + admin | Last 20 scrape logs. |

**Helpers in routes file:**

- `reelMediaAuth` — JWT from cookie or `Authorization` or `?token=`; for `?token=` requires `type: "reel_media"` and optional `reelId` match.
- `requireSubscription` — DB check: `subscriptionStatus` active/trialing or admin or `premiumFeaturesUnlocked`.
- `isAllowedMediaHost` — instagram.com, cdninstagram.com, fbcdn.net, r2.dev, blob.vercel-storage.com, `R2_PUBLIC_URL` host.
- `normalizeAndValidateMediaUrl`, `resolveRedirectUrl`, `checkCdnUrl` — URL validation and redirect following.
- `fetchFreshVideoUrlFromApify(reelUrl)` — Apify `apify/instagram-reel-scraper` with `directUrls: [reelUrl]`; returns `videoUrl` or `videoUrlNoWatermark`.
- `fetchFreshVideoUrlWithRetry(reelUrl)` — 2 attempts, 2s delay.
- `proxyStream`, `proxyDownloadWithRefresh` — HTTP GET to CDN with redirect follow; on 403/404/410 and `reel.reelUrl` call refresh then re-proxy.
- `cacheToR2InBackground(reelId, cdnUrl)` — Download full video from CDN, upload to R2 `reels/{reelId}.mp4`, set `reel.videoUrl` to R2 URL.
- `isR2Url(url)` — true if URL is R2 (r2.dev or `R2_PUBLIC_URL`).
- Download: if `videoUrl` is R2 → 302 redirect to it; else `proxyDownloadWithRefresh`.

---

## 3. Backend service

**File:** `src/services/viral-reels.service.js`

- **getTopReels({ limit })** — Prisma: reels with `postedAt >= 10 days ago`, include profile (username, followerCount, avgViews), order by viralScore desc, take limit. Returns array of DTOs with snake_case (e.g. `video_url`, `thumbnail_url`, `viral_score`, `profiles`, etc.).
- **calculateViralScore(reel, accountAvgViews, audioTrendCount)** — Ratio vs account avg, engagement, recency, velocity, shares, audio trend, absolute view bonuses; returns `{ viralScore, viewsToAvgRatio, engagementRate, momentumMultiplier, breakdown }`.
- **assignTier(viralScore, postedAt)** — Tier 1 hot, 2 warm, 3 cold, 4 other.
- **getGlobalMedian()**, **getCachedGlobalMedian()** — Median of profile `avgViews` (cached 3h).
- **getAudioTrendCount(audioName)** — Count of reels with same audio, last 48h, viralScore > 20.
- **scrapeProfileReels(username, resultsLimit)** — Apify `apify/instagram-reel-scraper` by username; map to internal reel shape (instagramReelId, reelUrl, videoUrl, thumbnailUrl, views, likes, etc.).
- **scrapeReelByUrl(reelUrl)** — Apify by direct URL; returns fresh { views, likes, comments, shares }.
- **scrapeAndSave(profile, globalMedian, force)** — Cooldown/logic; **scrapeProfileReels**; update profile avgViews; for each reel compute velocity, viral score, tier; **upsert** Reel (create or update).
- **scrapeHotReels()** / **scrapeWarmReels()** — Re-scrape tier 1 / tier 2 reels, update views and scores.
- **runScraperPipeline({ force })** — Create ScrapeLog; get profiles by `scrapeGroup` (or all if force); apply cooldowns; batch **scrapeAndSave**; update log.
- **recalculateScores()** — Recompute viral score and tier for recent reels.
- **assignScrapeGroups()** — Set `scrapeGroup = index % 6` for all profiles.
- **scrapeSingleProfileById(profileId, { force })** — Load profile, call **scrapeAndSave**, return `{ found, skipped }`.

---

## 4. Middleware (shared)

**File:** `src/middleware/auth.middleware.js`

- Reads JWT from `req.cookies.auth_token` or `Authorization: Bearer <token>`.
- Rejects if missing, invalid, or `decoded.type === "refresh"`.
- Sets `req.user = { ...decoded, userId, id: userId }`.

**File:** `src/middleware/admin.middleware.js`

- Requires `req.user.userId` (must run after auth).
- Loads user from DB; requires `user.role === 'admin'`.
- Sets `req.user` with full user fields.

---

## 5. Database models (Prisma)

**ReelFinderProfile**

- id, username (unique), instagramUrl, isActive, followerCount, avgViews, avgViewsUpdatedAt, addedAt, lastScrapedAt, scrapeCount, scrapeGroup.
- Relation: `reels` → Reel[].

**Reel**

- id, profileId, instagramReelId (unique), reelUrl, thumbnailUrl, views, likes, comments, shares, caption, audioName, postedAt, viralScore, viewsToAvgRatio, lastScoreUpdate, createdAt, videoUrl, contentCategory, prevViews, prevViewsAt, viewsPerHour, audioTrendBonus, lastScrapedAt, momentumMultiplier, scrapeTier, shareBonus, viewsPerHourPrev.
- Relation: `profile` → ReelFinderProfile.

**ScrapeLog**

- id, status, profilesScraped, reelsFound, startedAt, finishedAt.

---

## 6. Frontend — Reel Finder page

**File:** `client/src/pages/ViralReelFinderPage.jsx`

- **Props:** `embedded`, `sidebarCollapsed`, `onUpgrade`.
- **Access:** `hasPremiumAccess(user)` (admin, or subscriptionStatus active/trialing, or premiumFeaturesUnlocked). If no access, renders **SubscriptionGate** and calls `onUpgrade` on “View Subscription Plans”.
- **Data:** `useQuery(["viral-reels"], () => api.get("/viral-reels"))` when `canAccessReelFinder`; returns list of reels (snake_case from backend).
- **UI:** Header (Reel Finder title, Refresh), stats (last update, profiles count, hot count), grid of **ReelCard** (thumbnail, rank, @username, posted_at, views, ratio, engagement, viral_score; click opens modal).
- **ReelModal:** Shows reel with `video_url` in `<video src={videoUrl}>`, thumbnail as poster, mute toggle, likes/comments/shares/views, caption, viral_score / views_to_avg_ratio / engagement / views_per_hour chips, **Download** (api.get(`/viral-reels/${reel.id}/download`, { responseType: "blob" })), link to `reel_url` (Instagram).
- **Helpers:** `getThumbnailUrl(reel)` → `reel.thumbnail_url`, `getVideoUrl(reel)` → `reel.video_url` (used directly as `<video src>`), `formatCompact`, `ago`, `calcEngagement`.

**Premium access utility**

**File:** `client/src/utils/premiumAccess.js`

- `hasPremiumAccess(user)` — true if admin, or `subscriptionStatus` in `["active","trialing"]`, or `premiumFeaturesUnlocked`.

---

## 7. Frontend — Dashboard / sidebar

- **Dashboard:** Renders `<ViralReelFinderPage embedded ... />` when tab is `reelfinder`; premium tab, so may show upgrade.
- **Sidebar:** Entry for “Reel Finder” (e.g. id `reelfinder`, premium).
- **Admin:** Section that uses `api.get('/viral-reels/admin/profiles')`, `api.get('/viral-reels/admin/logs')`, and POST/PATCH/DELETE for profiles and trigger endpoints (scrape, hot, warm, recalculate, assign-groups).

---

## 8. API usage summary (client)

| Endpoint | Used in |
|----------|--------|
| `GET /api/viral-reels` | ViralReelFinderPage (list reels). |
| `GET /api/viral-reels/:id/download` | ViralReelFinderPage ReelModal (download blob). |
| `GET /api/viral-reels/admin/profiles` | AdminPage (Reel Finder admin). |
| `GET /api/viral-reels/admin/logs` | AdminPage. |
| `POST /api/viral-reels/admin/profiles` | AdminPage (add profile). |
| `POST /api/viral-reels/admin/profiles/bulk` | AdminPage. |
| `PATCH /api/viral-reels/admin/profiles/:id` | AdminPage (isActive, scrapeGroup). |
| `DELETE /api/viral-reels/admin/profiles/:id` | AdminPage. |
| `POST /api/viral-reels/admin/profiles/:id/scrape` | AdminPage. |
| `POST /api/viral-reels/admin/clear-reels` | AdminPage (clear DB reels + optional rescrape). |
| `POST /api/viral-reels/admin/trigger-scrape` | AdminPage. |
| `POST /api/viral-reels/admin/trigger-hot` | AdminPage. |
| `POST /api/viral-reels/admin/trigger-warm` | AdminPage. |
| `POST /api/viral-reels/admin/recalculate` | AdminPage. |
| `POST /api/viral-reels/admin/assign-groups` | AdminPage. |

Stream token and `/stream` / `/media` are available for future use (e.g. when playing via app proxy instead of direct `video_url`).

---

## 9. Environment / dependencies

- **Backend:** `APIFY_API_TOKEN`, `JWT_SECRET`, `R2_*` (for R2 cache). Optional `R2_PUBLIC_URL` for `isR2Url` and allowed media host.
- **DB:** Prisma with `Reel`, `ReelFinderProfile`, `ScrapeLog`.
- **Frontend:** Axios `api` (with auth cookies), `@tanstack/react-query`, `useAuthStore`, `hasPremiumAccess`.

This is the full Reel Finder stack: frontend (page + premium gate + admin), middleware (auth, admin, subscription, reelMediaAuth), and backend (routes + viral-reels service + Prisma models).
