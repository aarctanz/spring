# Routes Spec

All routes return JSON. Auth routes are managed by Better Auth at `/auth/*`.

## Auth

Managed by Better Auth. Cookie-based sessions, Google SSO only (`@nitkkr.ac.in`).

| Method | Path                          | Auth | Description                  |
| ------ | ----------------------------- | ---- | ---------------------------- |
| POST   | `/auth/sign-in/social`        | Yes   | Initiate Google SSO          |
| GET    | `/auth/callback/google`       | Yes   | Google OAuth callback        |
| POST   | `/auth/sign-out`              | Yes  | Sign out, clear session      |
| GET    | `/auth/get-session`           | Yes  | Get current session and user |

## Contests

| Method | Path                     | Auth | Description                              |
| ------ | ------------------------ | ---- | ---------------------------------------- |
| GET    | `/contests`              | Yes   | List all contests                        |
| GET    | `/contests/:contestNumber` | Yes | Get contest with its problems            |

**Response fields:**
- Contest: `contestNumber`, `title`, `description`, `startTime`, `endTime`
- Problems (nested): `slug`, `label`, `title`, `description`, `difficulty`, `score`, `timeLimitMs`, `memoryLimitMb`, `visibleFrom`, `tags`

## Problemset

| Method | Path                | Auth | Description                              |
| ------ | ------------------- | ---- | ---------------------------------------- |
| GET    | `/problemset`       | Yes   | List all visible problems                |
| GET    | `/problemset/:slug` | Yes   | Get problem with sample test cases       |

**Response fields:**
- Problem: `slug`, `label`, `title`, `description`, `difficulty`, `score`, `timeLimitMs`, `memoryLimitMb`, `visibleFrom`, `tags`
- Test cases (nested, sample only): `input`, `expectedOutput`, `order`

## Languages

| Method | Path          | Auth | Description              |
| ------ | ------------- | ---- | ------------------------ |
| GET    | `/languages`  | Yes   | List active languages    |

**Response fields:** `engineLanguageId`, `name`, `version`

---

## Planned Routes

### Run (execute code without judging)

| Method | Path                       | Auth | Description                          |
| ------ | -------------------------- | ---- | ------------------------------------ |
| POST   | `/problemset/:slug/run`    | Yes  | Run code against sample test cases   |

**Request body:** `{ engineLanguageId: number, code: string }`

**Response:** Array of per-test-case results with `input`, `expectedOutput`, `actualOutput`, `status` (e.g. `AC`, `WA`, `TLE`, `RE`), `timeMs`, `memoryKb`.

### Submit (judge against all test cases)

| Method | Path                       | Auth | Description                          |
| ------ | -------------------------- | ---- | ------------------------------------ |
| POST   | `/problemset/:slug/submit` | Yes  | Submit solution for judging          |
| GET    | `/submissions/:id`         | Yes  | Get submission result                |
| GET    | `/problemset/:slug/submissions` | Yes | List user's submissions for a problem |

**Request body (submit):** `{ engineLanguageId: number, code: string }`

**Response (submit):** `{ submissionId: string }` — poll `/submissions/:id` for result.

**Response (submission detail):** `submissionId`, `slug`, `engineLanguageId`, `status`, `score`, `timeMs`, `memoryKb`, `testResults[]`, `createdAt`

### Approach (editorial/solution discussion per problem)

| Method | Path                            | Auth | Description                     |
| ------ | ------------------------------- | ---- | ------------------------------- |
| GET    | `/problemset/:slug/approaches`  | Yes   | List approaches for a problem   |
| POST   | `/problemset/:slug/approaches`  | Yes  | Submit an approach              |
| GET    | `/problemset/:slug/approaches/:id` | Yes | Get a specific approach         |

**Request body (post):** `{ title: string, content: string }` (markdown)

**Response fields:** `id`, `author` (rollNumber, name), `title`, `content`, `createdAt`
