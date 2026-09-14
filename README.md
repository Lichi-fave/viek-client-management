# VIEK Client Management — Debugging Report

Full-stack debugging assessment for the Software Development Intern role. This README covers what I found, why it was happening, how I fixed it, and how I tested each fix.

## How I approached it

I didn't start by reading the code top to bottom. I ran the app first, clicked through it, and let it break — then chased each error back to its source. A couple of the "bugs" only showed up once I actually tried to use the feature (delete looked fine until I checked that the client was actually gone), so running things end-to-end mattered more than reading them.

Once the app was up, I isolated each backend bug with a small standalone Node script before touching `server.js`, so I could confirm the actual behavior (e.g. `"1" !== 1` evaluating to `true`) instead of assuming from reading the code. Then I fixed, restarted, and re-tested with `curl` against the real endpoints before moving to the next issue.

---

## Bugs Identified & Root Causes

### 1. Delete client silently did nothing

**Where:** `server.js`, `DELETE /api/clients/:id`
**Root cause:** `req.params.id` is always a string in Express, but `client.id` is a number. `client.id !== id` was comparing `1 !== "1"`, which is always `true`, so no client was ever filtered out. The endpoint still returned a success message, which made it worse — it looked like it worked.
**Fix:** Convert `req.params.id` to a number before filtering, and return 400 if it isn't a valid number.

### 2. Project filtering by client returned nothing

**Where:** `server.js`, `GET /api/projects`
**Root cause:** Same type mismatch — `req.query.clientId` is a string, `project.clientId` is a number.
**Fix:** `Number(clientId)` before comparing.

### 3. Client list never rendered

**Where:** `App.jsx`, `loadClients()`
**Root cause:** The backend responds with `{ data: clients }`, but the frontend was reading `result.clients`, which is `undefined`. `clients.length` and `clients.map()` would then throw (or silently show "No clients found" depending on render order).
**Fix:** Read `result.data` instead.

### 4. App crashed before first load

**Where:** `App.jsx`, `useState()` for `projects`
**Root cause:** Initialized as `undefined` instead of `[]`. Before the first successful fetch, `projects.map()` threw.
**Fix:** `useState([])`.

### 5. Adding a client silently failed

**Where:** `App.jsx`, `addClient()`
**Root cause:** The POST request never set `Content-Type: application/json`. Without that header, Express's `express.json()` middleware doesn't parse the body, so `req.body` was `undefined` server-side and every add request hit the "Name and email are required" branch.
**Fix:** Added the header.

### 6. New client IDs could collide after a delete

**Where:** `server.js`, `POST /api/clients`
**Root cause:** `id: clients.length + 1` assumes the array only ever grows. Once deletes actually started working (see #1), this could reassign an ID still in use.
**Fix:** A `nextClientId` counter that only increments, never reused.

### 7. Plaintext passwords and a single shared fake token

**Where:** `server.js`, login + `authenticate` middleware
**Root cause:** Passwords were stored and compared in plaintext, and every authenticated user shared one hardcoded string (`"Bearer demo-token"`) — not a real token, no expiry, no way to invalidate a session, and trivially guessable.
**Fix:** See the Security section below — this is the one I spent the most time on.

### 8. No handling for an expired or invalid session

**Where:** `App.jsx`
**Root cause:** If a request came back 401, the app didn't do anything — no message, no redirect to login, so it just looked broken.
**Fix:** Added a `handleSessionExpired()` helper that clears the token and shows a message when any protected request returns 401.

---

## Solutions Summary

- Backend: fixed both type-coercion bugs (delete, project filter), fixed ID generation, added a 404/500 handler that doesn't leak stack traces, added input validation on client creation.
- Frontend: fixed the response-shape mismatch, fixed the uninitialized `projects` state, fixed the missing `Content-Type` header, added session-expiry handling and a logout button (small UX gap, not in the original spec, but felt incomplete without it).
- Auth: rebuilt login and session handling from scratch (details below).

---

## Security

This is the section I want to actually explain rather than just list, because it's where I made the most judgment calls.

**What was wrong:** Passwords were stored in plaintext in the users array and compared with `===`. That's a real problem — if this array ever came from a database dump or a leaked `.env`, every password would be exposed as-is. On top of that, the "auth token" was a single hardcoded string every logged-in user shared. It never expired, couldn't be revoked, and anyone could hardcode `"Bearer demo-token"` into a request without ever logging in.

**What I did about it:**

- Passwords are now hashed with `bcrypt` at rest, and login compares against the hash with `bcrypt.compare`, never the raw string.
- Replaced the shared fake token with a real signed JWT (`jsonwebtoken`), unique per user, expiring after 2 hours. The secret is read from an environment variable (`.env`, gitignored) rather than hardcoded — the server now refuses to start without it, which forces this to be set deliberately rather than forgotten.
- Login and password checks return the exact same generic message ("Invalid email or password") whether the email doesn't exist or the password is wrong. The original code's error message would have told an attacker which case applied, making it easier to enumerate valid emails.
- Added rate limiting on `/api/login` (10 attempts per IP per 15 minutes) since there was no brute-force protection at all before.
- Stripped `passwordHash` out of the response object before sending it back on login — small thing, but there's no reason a hash (even a bcrypt one) should ever leave the server.

**What I'd still flag for a production version, not fixed here:**

- Users and clients live in memory and reset on every server restart — fine for this assessment, not fine for anything real. This would need a real database with parameterized queries.
- CORS is wide open (`cors()` with no origin restriction). Fine for local dev against `localhost:5173`, but a production version should restrict this to the actual frontend origin.
- No HTTPS enforcement — that's an infrastructure/deployment concern rather than something to hardcode into `server.js`, but worth noting.
- `npm audit` flags a few vulnerabilities in transitive dependencies from the pinned `express`/`cors` versions specified in the assessment brief. I left the pinned versions as given rather than bumping them unprompted, since that felt outside the scope of "fix the bugs," but it's worth a `npm audit fix` pass before this went anywhere real.

---

## Testing

I tested backend changes directly against the running server with `curl`, one endpoint at a time, before touching the frontend — that way I knew for certain whether a bug was in the API or in how React was consuming it.

- **Login:** correct credentials return a valid JWT; wrong password and unknown email both return the same generic message; confirmed the rate limiter kicks in after repeated failed attempts.
- **Auth middleware:** requests with no token, a garbage token, and a well-formed-but-invalid token all correctly return 401 rather than crashing the server.
- **Delete:** deleted a client, confirmed via `GET /api/clients` that it was actually gone (this was the core bug — previously it "succeeded" without doing anything), then confirmed deleting the same ID again correctly returns 404.
- **Project filtering:** filtered by each `clientId` and confirmed the correct subset of projects came back (previously this always returned an empty array).
- **Add client:** confirmed a new client appears in the list afterward, and that an invalid email is rejected with a 400 before ever reaching the array.
- **Frontend:** ran the full flow in the browser — login, add a client, delete a client, filter projects by client, and logout — to confirm the fixes work together, not just in isolation.

## Reflection

**What took the most investigation:** the auth setup. The individual bugs (delete, filter, response shape) were quick once I isolated them with small test scripts — a few minutes each. The auth piece took longer because it wasn't really "one bug," it was a design decision: do I patch the existing fake-token system just enough to make it "work," or actually rebuild it properly? I went with bcrypt + JWT + rate limiting because the assessment specifically calls out security as something to evaluate, and a shared hardcoded token isn't really fixable in a small way — it needed a real replacement, not a patch.

**My general approach:** run it first, break it on purpose, then trace each failure back to either the request the frontend sent, what the backend expected, or a type mismatch in between. Most of these bugs (delete, filter) were the exact same root cause — string vs. number — showing up in two different places, which made the second one fast to spot once I'd found the first.

**Unresolved / out of scope:** I didn't add persistent storage (database) or tests with a formal test runner (Jest/Vitest), since the brief focused on debugging existing behavior rather than expanding the app's architecture. If this were headed to production I'd want both, plus the CORS/HTTPS items noted in the Security section above.
