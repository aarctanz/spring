# Deployment Guide

## Prerequisites

- Docker and Docker Compose installed
- exec0 service running in Docker (network: `exec0_default`, container: `exec0-exec0-api-1`)
- Google Cloud Console project with OAuth 2.0 credentials configured

## 1. Environment Setup

Copy the example env file and fill in all values:

```bash
cp .env.example .env
```

### Required variables

| Variable | Description | Example |
|---|---|---|
| `PGUSER` | PostgreSQL username | `spring` |
| `PGPASSWORD` | PostgreSQL password — use a strong random password | `<random>` |
| `PGDATABASE` | PostgreSQL database name | `spring` |
| `DB_PORT` | Host port for PostgreSQL (internal is always 5432) | `5433` |
| `DATABASE_URL` | Used by app in local dev only — Docker overrides this | `postgres://spring:spring@localhost:5433/spring` |
| `PORT` | Port the API listens on | `3001` |
| `NODE_ENV` | Set to `production` for deployment | `production` |
| `APP_BASE_URL` | Public URL of the API (used by Better Auth for OAuth redirects) | `https://api.codespardha.me` |
| `GOOGLE_CLIENT_ID` | From Google Cloud Console → APIs & Services → Credentials | `xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console | `GOCSPX-xxxx` |
| `GOOGLE_ALLOWED_HD` | Google Workspace domain to restrict sign-ups | `nitkkr.ac.in` |
| `BETTER_AUTH_SECRET` | Session signing secret — minimum 32 random characters | Generate with `openssl rand -base64 32` |
| `FRONTEND_URL` | Frontend app URL | `https://contest.codespardha.me` |
| `ALLOWED_ORIGIN` | CORS origin for frontend — must match `FRONTEND_URL` exactly | `https://contest.codespardha.me` |
| `ENGINE_URL` | exec0 API URL — use Docker container name since spring joins exec0's network | `http://exec0-exec0-api-1:8080` |

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an OAuth 2.0 Client ID (Web application)
3. Add authorized redirect URI: `{APP_BASE_URL}/api/auth/callback/google`
   - Local: `http://localhost:3001/api/auth/callback/google`
   - Production: `https://api.spring.nitkkr.ac.in/api/auth/callback/google`
4. Copy Client ID and Client Secret into `.env`

## 2. Build and Start

```bash
# Build and start all services
docker compose up -d --build

# Check logs
docker compose logs spring -f
```

This starts:
- **db** — PostgreSQL 18 with healthcheck, data persisted in `pgdata` volume
- **spring** — Bun app on port 3001, joins `exec0_default` network to reach exec0

The `spring` container connects to `db` using Docker's internal DNS (not `DATABASE_URL` from `.env` — docker-compose overrides it with `db:5432`).

## 3. Run Migrations (first deploy or schema change)

Migrations are **not** run automatically. Run manually after first deploy or whenever schema changes:

```bash
# Push schema to database
docker exec spring-spring-1 bunx drizzle-kit push

# Verify tables were created
docker exec spring-db-1 psql -U spring -d spring -c "\dt"
```

> **Note:** Use `drizzle-kit push` (not `migrate`) — it syncs schema directly without migration files. Use `docker exec` with container names, not `docker compose exec` (which can have flag parsing issues).

## 4. Seed Data (first deploy only)

Seed contest, problems, test cases, tags, and languages. Only needed once — the seed script fetches available languages from exec0.

```bash
# Make sure exec0 is running first
docker exec spring-spring-1 bun run src/db/seed.ts
```

> **Important:** exec0 must be reachable at `ENGINE_URL` before seeding — the seed script fetches the language list from it.

## 5. Verify

```bash
# Health check
curl http://localhost:3001/

# Server time
curl http://localhost:3001/time

# Languages (should return list if seeded)
curl http://localhost:3001/languages

# OpenAPI docs
curl http://localhost:3001/openapi/json
```

## 6. Reverse Proxy (Production)

Place Nginx or Caddy in front of the spring container. Example Nginx config:

```nginx
server {
    listen 443 ssl;
    server_name api.spring.nitkkr.ac.in;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Important: `APP_BASE_URL` and `ALLOWED_ORIGIN` must use the public HTTPS URL, not `localhost`.

## 7. Network Architecture

```
┌──────────────────────────────────────────────────┐
│  exec0_default network                           │
│                                                  │
│  ┌──────────────────┐   ┌─────────────────────┐  │
│  │ exec0-exec0-api-1│   │ spring-spring-1     │  │
│  │ :8080            │◄──│ :3001               │  │
│  └──────────────────┘   └──────┬──────────────┘  │
│                                │                 │
└────────────────────────────────┼─────────────────┘
                                 │
┌────────────────────────────────┼─────────────────┐
│  spring_default network       │                  │
│                                │                 │
│  ┌──────────────────┐          │                 │
│  │ spring-db-1      │◄─────────┘                 │
│  │ PostgreSQL :5432 │                            │
│  └──────────────────┘                            │
│                                                  │
└──────────────────────────────────────────────────┘
```

The spring container is on both networks:
- `spring_default` — to reach its own PostgreSQL
- `exec0_default` — to reach exec0 API for code execution

## 8. Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build

# Run migrations if schema changed
docker exec spring-spring-1 bunx drizzle-kit push
```

> **Warning:** Always use `docker compose` (v2, space), never `docker-compose` (v1, hyphen). They handle volume naming differently — mixing them can cause data loss. The volume `name: spring_pgdata` in docker-compose.yml prevents this, but stick to v2 to be safe.

## 9. Troubleshooting

**"Failed to connect to database"**
- Check `docker compose logs db` — is PostgreSQL healthy?
- Verify `PGUSER`, `PGPASSWORD`, `PGDATABASE` match between db and spring services

**"BETTER_AUTH_SECRET" error**
- Set `NODE_ENV=production` and provide `BETTER_AUTH_SECRET` (min 32 chars) in `.env`

**exec0 unreachable (500 on /run or /submit)**
- Verify exec0 is running: `docker ps | grep exec0`
- Check `ENGINE_URL` points to the exec0 container name: `http://exec0-exec0-api-1:8080`
- Confirm spring is on exec0's network: `docker inspect spring-spring-1 | grep exec0`

**CORS errors from frontend**
- `ALLOWED_ORIGIN` must exactly match the frontend URL (protocol + domain + port)
- No trailing slash

**Google OAuth redirect_uri_mismatch**
- The redirect URI in Google Console must match `{APP_BASE_URL}/api/auth/callback/google`
- `APP_BASE_URL` must be the public-facing URL (not `localhost` in production)

**Bind address — container not reachable**
- Elysia listens on `localhost` by default. If requests from Docker's port mapping don't reach the app, update `src/index.ts` to bind to `0.0.0.0`:
  ```ts
  .listen({ port: Number(process.env.PORT ?? 3000), hostname: "0.0.0.0" })
  ```
