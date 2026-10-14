# Local development

Read and follow this file at the start of every session, before editing.

File changes belong only in a git worktree. The primary clone stays on `main` and is never edited. Do not commit files another agent changed.

## Worktree

If you are already in a linked worktree, stay there and edit only that directory. `git rev-parse --git-dir` and `git rev-parse --git-common-dir` differ, and `git rev-parse --show-superproject-working-tree` prints nothing.

If you are in the primary clone, do this before any edit:

1. Update `main`. This step is required every time you create a worktree:

```bash
git checkout main && git pull --ff-only origin main
```

2. Create your branch from that updated `main`:

```bash
git worktree add -b <type>/<short-topic> .worktrees/<type>-<short-topic> main
```

3. Point your workspace root at that worktree. Do every edit, commit, and push there. `.worktrees/` is gitignored. Do not change files in the primary clone.

## Local servers

The user keeps one API tunnel for every worktree. Do not start it. Before UI work that calls the API, confirm port 8080 is listening (`ssh -N -L 8080:localhost:8080 netcup` prints nothing while it is up). If it is not listening, stop and tell the user.

Leave the user's Vite server on http://localhost:5173 alone. When you change the UI, install dependencies in this worktree's `panel/frontend` if `node_modules` is missing, then start Vite on the next free port from 5174 upward:

```bash
npm run dev -- --port <free> --strictPort
```

That server proxies `/api` to `127.0.0.1:8080`. Verify the change in the browser at that port. Panel and agent changes do not apply on the VPS until the user updates it after merging.

## Pull request

Open a pull request that contains only this branch's commits.

Before the user merges into `main`, merge `main` into this feature branch and make sure that merge is clean:

```bash
git fetch origin
git merge origin/main
```

If there are conflicts, resolve them on this branch and commit the result. Do not ask the user to merge while conflicts remain.

Watch every CI job until it has finished, including the jobs from that merge. You may tell the user the pull request is ready to merge only after `main` is merged in with no conflicts and every job has passed. If any job fails or is still running, do not ask them to merge. Fix failures on this branch, push, and watch again.

The user merges, and only after that. Then the user updates the VPS:

```bash
git checkout main && sudo ./update.sh --pull
```

After the user has merged, remove this worktree from the primary clone with `git worktree remove`.

## Checks

Frontend tests run from `panel/frontend` (`npm test`). Backend and agent tests use `uv run pytest` in `panel/backend` and `agent`.

Do not merge, force-push, or run `update.sh`.
