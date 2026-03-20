# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Spring** is a backend API for a placement helper system (like Codeforces) for NIT Kurukshetra. Built with Elysia framework on Bun runtime, using Drizzle ORM with PostgreSQL.

## Commands

- **Dev server:** `bun run dev` (runs with --watch on port 3000)
- **Install deps:** `bun install`
- **Tests:** No test runner configured yet (placeholder in package.json)

## Tech Stack

- **Runtime:** Bun
- **Framework:** Elysia (see `.agents/skills/elysiajs/` for reference docs)
- **ORM:** Drizzle (planned)
- **Database:** PostgreSQL
- **Auth:** Better Auth with Google SSO, cookie-based sessions (not JWT)

## Architecture Notes

- Backend-only repo; frontend is separate
- Auth restricted to `@nitkkr.ac.in` Google Workspace domain via `hd` claim verification
- Sessions stored server-side, session tokens hashed before storage
- API docs exposed via Elysia OpenAPI plugin at `/openapi` and `/openapi/json`
- Elysia reference docs and integration guides are in `.agents/skills/elysiajs/`

## Key Design Decisions (from initial_specs.md)

- Google SSO only (no passwords/OTP) — `google_sub` is the stable user identifier, not email
- Domain enforcement must check the verified `hd` token claim, never trust email suffix alone
- Database tables: `users`, `sessions`, `user_handles` (for leetcode/codeforces handles)
- User roles: `student` (default) and `admin`
- Session cookie: HttpOnly, Secure (prod), SameSite=Lax, 7-day expiry
