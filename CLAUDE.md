# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TripAI (aitu) is an AI-powered travel itinerary planner. Chinese-language only. Single Cloudflare Worker serves both the React SPA and the Hono API backend.

## Development Commands

```bash
# Backend (Cloudflare Worker)
npm run dev          # wrangler dev — starts API on :8787

# Frontend (React + Vite)
cd frontend && npm run dev    # Vite dev server, proxies /api -> :8787
cd frontend && npm run build  # Build to frontend/dist/

# Production deploy
npm run deploy       # Builds frontend, then wrangler deploy --minify

# Type generation
npm run cf-typegen   # Generate Worker types from wrangler.jsonc
```

No test runner or linter is configured for the backend. Frontend has ESLint (`cd frontend && npm run lint`).

## Architecture

**Backend**: Hono on Cloudflare Workers (`src/index.ts` as entry, routes split into `src/routes/`). Bindings: D1 (`DB`), KV (`CACHE`), Queues (`AI_QUEUE`). TypeScript compilation checked with `npx tsc --noEmit`.

**Frontend**: React 18 SPA (`frontend/src/`). No state management library, no CSS framework — custom CSS with CSS variables and dark mode via `data-theme` attribute. Vite builds to `frontend/dist/` which the Worker serves as static assets.

**AI Provider**: Volcengine Doubao via OpenAI-compatible API. Custom client in `src/services/openai.ts` (no npm dependency). Multi-tier fallback: Cloudflare AI Gateway (Workers AI) → Volcengine direct; streaming → queue → polling.

**Maps/Weather**: Amap/Gaode Maps API (`src/services/map.ts`) for maps, geocoding, and weather.

## Backend Structure

Entry point `src/index.ts` mounts all route modules via `app.route()` and includes the queue consumer + scheduled cleanup cron (3 AM).

### Route Modules (`src/routes/`)

| File | Endpoints | Purpose |
|---|---|---|
| `generate.ts` | `/api/plans/generate-step`, `/api/plans/nearby/generate-step` | 5-step pipeline (weather→explore→attractions→food→generate) for both regular and nearby plans |
| `plans.ts` | `/api/plans/*` | CRUD, share, featured, public listing |
| `interaction.ts` | `/api/plans/:id/revise`, reviews | AI chat for itinerary modifications + review system |
| `attraction.ts` | `/api/attraction/*` | Detail guide, nearby route, geocode, image |
| `map.ts` | `/api/map/*` | Geocoding, POI, routing |
| `ai.ts` | `/api/ai/*` | Legacy single-shot generation, result polling |
| `social.ts` | `/api/social/*` | Social features |
| `misc.ts` | Various utilities | Health check, config |

### Service Modules (`src/services/`)

| File | Purpose |
|---|---|
| `openai.ts` | Custom OpenAI-compatible client (chatCompletion, chatStream, chatJSON, chat). Auto-injects system message via `injectSystemMessage()` |
| `ai-stream.ts` | AI provider factory, SSE streaming with gateway fallback, queue dispatch |
| `db.ts` | D1 init (auto-creates tables + indexes) and CRUD for plans/reviews |
| `map.ts` | Amap routing, POI, nearby search, geocoding |
| `weather-client.ts` | Weather data fetching |
| `weather.ts` | Weather analysis (rain detection, indoor suggestions) |
| `image.ts` | Image search, download, Cache API storage as base64 |
| `featured.ts` | Featured plans logic |
| `shortlink.ts` | Short URL generation |
| `geo.ts` | Server-side geolocation |

### Prompt Templates (`src/prompt/`)

All AI prompts are extracted as template functions returning `ChatMessage` objects:

| File | Functions | Used by |
|---|---|---|
| `system.ts` | `JSON_INSTRUCTION`, `SYSTEM_MESSAGE` | Injected into all AI calls by `openai.ts` |
| `generate.ts` | `buildExplorePrompt`, `buildAttractionsPrompt`, `buildFoodPrompt`, `buildGeneratePrompt` | Regular plan generation |
| `nearby.ts` | `buildNearbyExplorePrompt`, `buildNearbyAttractionsPrompt`, `buildNearbyFoodPrompt`, `buildNearbyGeneratePrompt` | Nearby plan generation |
| `attraction.ts` | `buildAttractionDetailPrompt`, `buildNearbyRoutePrompt` | Attraction detail/route |
| `revise.ts` | `buildReviseMessages` | Chat-based itinerary modification |
| `legacy.ts` | `formatPrompt` | Legacy single-step generation |

### Utilities (`src/utils/`)

| File | Purpose |
|---|---|
| `pace.ts` | `PACE_CONFIG` — 3 travel pace presets (relaxed/moderate/intensive) controlling activity density, duration, rest intervals |
| `plan.ts` | `generateId`, `validatePlanParams`, re-exports `formatPrompt` |
| `date.ts` | Date helpers for nearby plans |
| `geo.ts` | Client-side geolocation |

## Itinerary Generation Flow

5-step pipeline executed from frontend `Plan.jsx`:

1. **weather** — Fetch weather data (JSON response, no AI)
2. **explore** — AI city overview (SSE streaming)
3. **attractions** — AI attraction recommendations (SSE streaming)
4. **food** — AI food recommendations (SSE streaming)
5. **generate** — AI assembles full itinerary using all context (SSE streaming or async queue)

Steps 2-4 run in parallel. The generate step can be async: dispatched to Cloudflare Queue, frontend polls `/api/ai/result/:requestId`.

Generation state is persisted in `sessionStorage` keyed by plan ID so refreshes don't lose progress.

## Frontend Routing

| Route | Component | Purpose |
|---|---|---|
| `/` | Home | Landing with featured plans |
| `/create` | CreatePlan | Trip creation form |
| `/nearby` | NearbyPlans | Nearby planning (geolocation) |
| `/plan/:id/generate` | Plan | Step-by-step generation with streaming UI |
| `/plan/:id` | PlanDetail | View/edit/review, AI chat for revisions |
| `/explore` | Explore | Browse public plans |

## Authorization

No auth system. Plans have an `edit_token` (UUID) returned once at creation, passed via `X-Edit-Token` header or `?token=` query param. Plan updates use optimistic locking with a `version` field.

## Caching Strategy

- **KV**: Geocoding (90 days), attraction details (90 days), featured plans
- **Cache API**: Images stored as base64 data URLs (avoids KV size limits)

## Database

D1 (SQLite). Schema auto-initialized on first request via `initDatabase()`. Tables: `plans` (with `edit_token`, `status` columns), `reviews`. No migration system — column additions use `ALTER TABLE ... ADD COLUMN` wrapped in try/catch.
