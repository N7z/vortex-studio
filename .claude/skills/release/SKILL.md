---
name: release
description: Cut a tagged release of Vortex Studio - bump the version, open the develop-to-master release PR, merge it, tag master, publish the GitHub release, and merge master back into develop. Use whenever the user asks to release, cut a release, ship a version, tag a version, do a major/minor/patch release, or "do the whole release process". Covers where the version number lives and the exact branch, commit-message and tag conventions the repo already follows.
---

# Releasing Vortex Studio

The canonical rules live in `CONTRIBUTING.md` under "Releases". This skill is the
executable version of them plus the details that only show up when you actually do it.

Releases go out from `develop`. `master` is the released branch and is always tagged.

## Pick the number

From `CONTRIBUTING.md`:

- **last number** (1.0.2 → 1.0.3) for fixes only
- **middle number** (1.0.2 → 1.1.0) when there are new features
- **first number** (1.0.2 → 2.0.0) only when the saved map format changes in a way
  older files or older builds cannot handle

Read the commits before deciding — do not take the user's word for "minor" if the log
shows a format change:

```bash
git log --oneline "$(git describe --tags --abbrev=0 master)"..develop --no-merges
```

If the range touches the map format — `resources/js/studio/vortexProject.js`, its
round-trip tests in `scripts/project.test.mjs`, or any migration under
`database/migrations` that rewrites saved parts — stop and confirm the major bump with
the user before continuing.

## Where the version lives

`package.json` is the only source of truth. Nothing else hardcodes it:

- `vite.config.js` reads `package.json` at build time into `__APP_VERSION__`
- `resources/js/studio/version.js` re-exports that as `APP_VERSION`, falling back to `'dev'`
- `MenuBar.jsx` shows it in Help → About; `StartScreen.jsx` shows it at the bottom of the start screen

So a release edits exactly two files, and the diff is three lines:

- `package.json` — the `"version"` key
- `package-lock.json` — the `"version"` at the top **and** the one under `packages.""`

**Do not bump `live-editing-server/package.json`.** It has sat at 1.0.0 through every
release so far and is versioned separately. Changing that is a decision for the user,
not a step in this process.

Do not run `npm version` — it makes a tag and a commit that do not match the conventions below.

## The process

Confirm the merge the release is built on actually landed on `develop` before starting.

### 1. Tests, before anything else

```bash
npm test              # scripts/*.test.mjs
./vendor/bin/pest     # tests/Feature
```

Both must be green. If either fails, stop and report — do not release around a failure.
Keep the counts, they go in the PR body.

### 2. Bump on `develop`

```bash
git checkout develop && git pull --ff-only
# edit package.json + package-lock.json
git add package.json package-lock.json
git commit -m "set the version to X.Y.Z"
git push origin develop
```

Commit message is exactly `set the version to X.Y.Z`, lowercase, no `v`.

### 3. Release PR

```bash
gh pr create --base master --head develop --title "release vX.Y.Z" --body "..."
```

Body: one line on why the middle/last number moved, an **In this release** list written
from the commit log in plain user-facing language, and a checklist of the steps below.

### 4. Merge, tag, publish

```bash
gh pr merge <n> --merge --subject "merge develop into master for vX.Y.Z" --body ""
git checkout master && git pull --ff-only
git tag vX.Y.Z && git push origin vX.Y.Z
```

A **merge commit**, never squash and never rebase — the tag has to sit on the merge
commit, the way `v1.0.2` (`3e5b4a2`) and `v1.1.0` (`ce380ec`) do. Tag name carries the
`v`, the version in `package.json` does not.

Then the GitHub release, matching the voice of the existing ones (`gh release view v1.1.0`):
a one-line summary of what kind of release it is, an **In this release** bullet list
ending with "the version bumped to X.Y.Z", an optional **Thanks** section crediting
outside contributors by handle and PR number, and a compare link last.

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

### 5. Merge back — do not skip

```bash
git checkout develop && git pull --ff-only
git merge master --no-ff -m "merge master back into develop after vX.Y.Z"
git push origin develop
```

Without this the branches diverge and the next release PR carries stale history.
See `6051d7c` after v1.0.2 and `af6ffd9` after v1.1.0.

### 6. Verify

```bash
git diff origin/master origin/develop --stat   # must be empty
git log --graph --oneline --all -8
gh release list | head -3
```

## Permission prompts

`gh pr merge` and `git checkout master` have been blocked by the auto-mode permission
classifier mid-release. That leaves the release half-finished — bumped and PR'd but not
tagged. If it happens, say plainly which step is blocked and print the remaining commands
rather than probing for a way around it; the user can run them with `!` or add a Bash
permission rule.
