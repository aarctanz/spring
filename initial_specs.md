# API specs
api specs for a placement helper system we're going to build, for the version one it'll contain a minimal contest system like codeforce. We'll gradually build it to it step by step. Don't forget to ask questions if you have any. this is bakcend, and we've seperate frontend
# Auth Spec

## Overview

We will use Google SSO only for v1, and access will be restricted to users from the college Google Workspace domain `nitkkr.ac.in`. The backend must verify Google identity on the server and enforce the hosted-domain check using Google’s token claims rather than trusting the email string alone.[^1][^2]

We will use server-side sessions with HTTP-only cookies instead of JWT access tokens. This keeps login state, logout, and invalidation simpler for a small centralized backend.

## Tech choices

- Runtime: Bun
- Framework: Elysia
- Auth library: Better Auth with Google provider
- Session model: Cookie-based server sessions
- API docs: Elysia OpenAPI
- Domain access rule: only `@nitkkr.ac.in` Google Workspace accounts allowed[^3][^2][^1]
- Drizzle orm
- Postgres database

Elysia’s OpenAPI plugin can expose interactive docs and raw OpenAPI JSON, which is useful for the frontend team. The documented default endpoints include `/openapi` and `/openapi/json`.

Better Auth’s Google setup requires Google OAuth credentials and a callback route such as `/api/auth/callback/google`, and that callback URI must be registered in Google Cloud.[^3]

## Auth strategy

### Why sessions over JWT

- Logout is straightforward; delete or revoke the session.
- Server always controls active login state.
- Easier for a single backend plus web frontend.
- No need to manage refresh-token rotation in v1.


### Google Workspace enforcement

At Google callback time, backend must:

1. Verify the Google ID token on the server.[^2][^1]
2. Validate issuer, audience, expiry, and signature.[^1][^2]
3. Read the `sub` claim as the stable Google user identifier. Google recommends using `sub` as the durable unique user ID.[^1]
4. Read the `hd` claim and accept login only if `hd === "nitkkr.ac.in"`. Google’s guidance says `hd` identifies managed Google-hosted domains and should be used for domain restriction.[^2][^1]

If `hd` is missing or different, login must be rejected even if the email string looks valid.[^2][^1]

## Auth routes

### 1. `GET /auth/google/login`

Starts Google sign-in.

**Behavior**

- Backend redirects user to Google OAuth consent flow.
- Optionally pass hosted-domain hint for `nitkkr.ac.in`.
- No JSON body.

**Response**

- `302 Redirect` to Google


### 2. `GET /auth/google/callback`

Google redirects here after successful sign-in.

**Behavior**

- Exchange code for tokens.
- Verify Google ID token on server.
- Enforce `hd === "nitkkr.ac.in"`.
- Find or create local user.
- Create session.
- Set secure HTTP-only cookie.
- Redirect user to frontend app.

**Success response**

- `302 Redirect` to frontend, for example `/dashboard`

**Failure response**

- `401 Unauthorized` or redirect to frontend error page


### 3. `GET /auth/me`

Returns current logged-in user from session.

**Success response**

```json
{
  "user": {
    "id": "usr_123",
    "name": "student",
    "email": "someone@nitkkr.ac.in",
    "avatarUrl": "https://...",
    "role": "student"
  }
}
```

**Failure**

```json
{
  "error": "UNAUTHORIZED"
}
```


### 4. `POST /auth/logout`

Logs out the current user.

**Behavior**

- Delete or revoke session server-side
- Clear auth cookie

**Success response**

```json
{
  "success": true
}
```


## Session cookie policy

Use one session cookie with these settings:

- `HttpOnly: true`
- `Secure: true` in production
- `SameSite: Lax` for normal web flow
- `Path: /`
- Reasonable expiry, for example 7 days
- Rotate session on login

If frontend and backend are on different subdomains, configure cookie domain deliberately; otherwise keep it host-scoped.

## OpenAPI docs

Expose API docs for frontend consumption:

- `GET /openapi`
- `GET /openapi/json`

Use Elysia runtime schemas for all route params and responses so docs stay accurate.

# Database Design

## Goals

The auth schema should be minimal and only store what this app needs:

- local user identity
- Google identity mapping
- active sessions
- optional external coding handles for future progress tracking

No password tables, OTP tables, or email-verification tables are needed in v1 because Google Workspace SSO replaces that flow.[^1][^2]

## Tables

### `users`

Stores the local app user.


| Column | Type | Constraints | Notes |
| :-- | :-- | :-- | :-- |
| `id` | `uuid` | `pk` | Internal user ID |
| `email` | `text` | `unique not null` | Must be `@nitkkr.ac.in` |
| `name` | `text` | `not null` | User display name |
| `avatar_url` | `text` | `null` | From Google profile |
| `google_sub` | `text` | `unique not null` | Stable Google user ID [^1] |
| `hosted_domain` | `text` | `not null` | Expected `nitkkr.ac.in` |
| `role` | `text` | `not null default 'student'` | `student` / `admin` |
| `created_at` | `timestamptz` | `not null` | Creation time |
| `updated_at` | `timestamptz` | `not null` | Last update time |
| `last_login_at` | `timestamptz` | `null` | Last successful login |

**Recommended constraints**

- `email` unique
- `google_sub` unique
- `hosted_domain = 'nitkkr.ac.in'` at insert/update time in app logic
- optional DB check: `email LIKE '%@nitkkr.ac.in'`


### `sessions`

Stores server-side login sessions.


| Column | Type | Constraints | Notes |
| :-- | :-- | :-- | :-- |
| `id` | `uuid` | `pk` | Session ID |
| `user_id` | `uuid` | `not null fk users(id)` | Owner |
| `session_token_hash` | `text` | `unique not null` | Store hash, not raw token |
| `expires_at` | `timestamptz` | `not null` | Expiry |
| `created_at` | `timestamptz` | `not null` | Creation time |
| `last_seen_at` | `timestamptz` | `not null` | Optional activity refresh |
| `ip_address` | `text` | `null` | Optional |
| `user_agent` | `text` | `null` | Optional |

**Recommended behavior**

- Hash session token before storing.
- Delete expired sessions with cron or periodic cleanup.
- On logout, delete the current session row.


### `user_handles`

Optional but recommended now, because you already plan to store LeetCode and Codeforces handles later.


| Column | Type | Constraints | Notes |
| :-- | :-- | :-- | :-- |
| `id` | `uuid` | `pk` | Row ID |
| `user_id` | `uuid` | `not null fk users(id)` | Owner |
| `platform` | `text` | `not null` | `leetcode` / `codeforces` |
| `handle` | `text` | `not null` | Username/handle |
| `created_at` | `timestamptz` | `not null` | Creation time |
| `updated_at` | `timestamptz` | `not null` | Update time |

**Constraint**

- `unique(user_id, platform)`




# Auth Flow

## First login

1. User clicks “Continue with Google.”
2. Frontend opens `GET /auth/google/login`.
3. Google authenticates the user.
4. Google redirects to `GET /auth/google/callback`.
5. Backend verifies token and checks `hd === "nitkkr.ac.in"`.[^1][^2]
6. Backend looks up `users.google_sub`.
7. If no user exists, create one.
8. Backend creates a session row.
9. Backend sets session cookie.
10. Backend redirects frontend.
11. Frontend calls `GET /auth/me`.

## Repeat login

Same flow, except existing user is found via `google_sub`, not only email. Google recommends `sub` as the stable identifier because email can change.[^1]

## Logout

1. Frontend calls `POST /auth/logout`.
2. Backend deletes current session row.
3. Backend clears cookie.
4. Frontend treats user as logged out.

# Environment Variables

Use at least these env vars:

```env
APP_BASE_URL=http://localhost:3000
FRONTEND_URL=http://localhost:5173

GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_ALLOWED_HD=nitkkr.ac.in

SESSION_COOKIE_NAME=app_session
SESSION_TTL_HOURS=168

DATABASE_URL=postgres://...
```

If Better Auth requires its own secret or base URL variables, add those too according to its setup. Better Auth’s Google provider setup depends on Google client credentials and callback configuration.[^3]

# Security Notes

- Never trust only the email suffix; enforce hosted domain via verified Google token claims.[^2][^1]
- Use `google_sub` as the primary external identity key.[^1]
- Store hashed session tokens, not raw session tokens.
- Use secure cookies in production.
- Restrict CORS to your frontend origin.
- Clear invalid or expired sessions regularly.


# Frontend Notes

Frontend only needs these auth actions for v1:

- redirect user to Google login
- fetch current user via `/auth/me`
- call logout
- handle unauthorized state globally

Because Elysia can expose OpenAPI docs and raw spec output, frontend can consume that spec directly for integration and mock generation if needed.

# Final v1 recommendation

Keep auth v1 exactly this small:

- Google SSO only
- `nitkkr.ac.in` hosted-domain enforcement
- session cookies
- `users`, `sessions`, and optional `user_handles`
- `/auth/google/login`
- `/auth/google/callback`
- `/auth/me`
- `/auth/logout`[^3][^2][^1]

I can next give you the same markdown for the contest, problem, run, submit, and approach-gating APIs.

<div align="center">⁂</div>

[^1]: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

[^2]: https://developers.google.com/identity/sign-in/web/backend-auth

[^3]: https://www.perplexity.ai/search/b79ebd04-edf0-4eb9-b263-11ff584bc8ad
