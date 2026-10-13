# Local development

Each agent works on its own feature branch. Do not edit `main`, and do not commit files another agent changed.

## Workflow

1. `git checkout main && git pull --ff-only origin main`
2. `git checkout -b <type>/<short-topic>` before any edit
3. Confirm the user already has both local terminals running. Do not start them.
   - UI: `cd panel/frontend && npm run dev` (http://localhost:5173)
   - API tunnel: `ssh -N -L 8080:localhost:8080 netcup` (prints nothing when it is up; local port 8080 must be listening)
4. Implement on that branch. The Vite server proxies `/api` to the tunnel, so UI changes show on refresh. Panel and agent changes do not apply on the VPS until step 8.
5. Open a pull request with only this branch's commits.
6. Watch CI until every job passes. Do not ask for a merge while any job is failing or still running.
7. The user merges.
8. The user updates the VPS: `git checkout main && sudo ./update.sh --pull`

## Checks

Frontend tests run from `panel/frontend` (`npm test`). Backend and agent tests use `uv run pytest` in `panel/backend` and `agent`.

Do not merge, force-push, or run `update.sh`.
