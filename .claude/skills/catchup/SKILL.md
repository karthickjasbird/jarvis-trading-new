---
name: catchup
description: Get up to speed on the Jarvis project at the start of a session. Reads Claude memory, git state, and recent commits, then summarizes where things stand and suggests next steps.
---

# Catch up on Jarvis

Run this at the start of a session to quickly reconstruct context.

Steps:

1. Read the Claude memory files — `MEMORY.md` and the files it indexes, especially
   `project_phase.md`.
2. Skim the "Current phase" section of `CLAUDE.md` at the repo root.
3. Run `git status` and `git log -8 --oneline` for uncommitted changes and recent history.
4. Run `git diff --stat` to see which files hold the most uncommitted work.
5. Check the tail of `startup.log` for any recent runtime errors.

Then give Karthick a short summary (under ~200 words):

- **Released:** the latest committed version.
- **In progress:** what the uncommitted WIP is — which files, what feature.
- **Where we left off:** the active edit surface.
- **Suggested next steps:** 2–3 concrete options.

If `project_phase.md` looks stale compared to `git status`, update it before finishing.
