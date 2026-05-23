---
name: restart-server
description: Cleanly restart the Jarvis dev server. Kills any process on port 3000, starts the server, and checks startup.log for errors.
---

# Restart the Jarvis dev server

The dev server is `tsx server.ts` (also `npm run dev`), serving on
http://localhost:3000. It writes to `startup.log`.

Steps:

1. Kill any running server:
   - `lsof -ti:3000 | xargs kill -9 2>/dev/null` — frees the port
   - `pkill -f "tsx.*server.ts" 2>/dev/null` — catches stragglers
   Treat "no process found" as success, not an error.
2. Start the server in the background with `npm run dev` (use run_in_background).
3. Wait for startup, then read the tail of `startup.log`. Success looks like
   `Server running on http://localhost:3000`.
4. If the log shows an error (port still in use, missing API key, TypeScript error),
   report the exact error to Karthick — do not silently retry.

Report: confirm the server is up on port 3000, or surface the precise error from
`startup.log`.
