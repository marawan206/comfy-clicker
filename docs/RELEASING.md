# Releasing

How a change gets from a branch into the game, and how players find out it happened.

Everything here is one person's process, so it is short on ceremony and long on the two things that
actually go wrong: shipping a save format the old client cannot read, and shipping a balance change
nobody told the players about.

## The pieces

| Thing | Where | Who reads it |
|---|---|---|
| Patch notes | `src/data/patchNotes.ts` | the in-game modal, `CHANGELOG.md`, the tests |
| Changelog | `CHANGELOG.md` (generated) | anyone looking at the repo |
| Version | `package.json` + the newest note | the About box, the Settings chip |
| Save format | `SAVE_VERSION` in `src/game/constants.ts` | every save that has ever been written |

`src/data/patchNotes.ts` is the source of truth. `CHANGELOG.md` is generated from it with
`pnpm notes` and is never edited by hand; `pnpm notes:check` fails when the two disagree, and a test
runs the same check so CI catches a forgotten regeneration.

## Versions

Semver, read as a game rather than as a library:

- **major** stays at 0 until the game is feature complete.
- **minor** (`0.2.0` → `0.3.0`) is a release: new systems, new content, balance passes.
- **patch** (`0.2.0` → `0.2.1`) is a hotfix: something shipped broken and this fixes it.

The version in `package.json` and the newest entry in `patchNotes.ts` must match. A test enforces it,
so a release that forgets one of the two fails before it goes out.

`SAVE_VERSION` is separate and moves on its own clock: bump it only when the save shape changes in a
way that needs a migration, and add that migration to `MIGRATIONS` in `src/game/save.ts` in the same
commit. Loading an older save must keep working forever; that is what the save round-trip tests are
for.

## Cutting a release

1. Branch: `feat/<thing>` off `main`, one branch per feature, commits in the usual style
   (`feat(area): what changed`, body explaining why, no AI or assistant mentions anywhere).
2. Build the thing. Tests come with it, not after it.
3. `pnpm typecheck && pnpm test && pnpm lint && pnpm build` all green before the merge.
4. Add the release entry at the top of `PATCH_NOTES`:
   - `version` the new one, `date` today in UTC, `kind: 'release'`
   - a short `title` and one dry `summary` line
   - one `changes` row per thing a player would notice, in `added` / `changed` / `balance` / `fixed`
5. Bump `version` in `package.json` to match.
6. `pnpm notes` to regenerate `CHANGELOG.md`.
7. Commit the notes on their own: `chore(release): v0.3.0`.
8. Merge with `git merge --no-ff` so the branch stays visible in the history, tag it
   `git tag -a v0.3.0 -m "0.3.0 <title>"`, and push `main` with `--follow-tags`.
9. Vercel deploys `main`. Check the Settings chip says the new version.

## Shipping a hotfix

Same shape, smaller:

1. Branch `fix/<thing>` off `main`.
2. Fix it, with the test that would have caught it.
3. Add a `kind: 'hotfix'` entry, bump the patch version, `pnpm notes`.
4. Merge, tag, push. A hotfix does not wait for anything else to be ready.

If the fix is urgent enough that notes can wait, ship the fix and add the note in the same day, not
the same week. A version that exists with no entry is the one thing this system cannot explain.

## Writing patch notes

These are read by players, so:

- say what changed for them, not which module moved
- numbers over adjectives: "pays back 0.954 on the credit", not "rebalanced"
- one line per change, no trailing period, no em-dashes anywhere (the separator in this repo is `·`)
- a nerf gets the same plain sentence a buff does, and says what it used to be

The in-game modal shows the newest entry expanded and collapses the rest. Opening it stamps the
version as seen, which clears the dot on the Settings tile; the watermark is browser-local, so a
player on a new device sees the notes again rather than a cloud save swallowing them.

## Checks before a merge

```
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm notes:check
```

CI runs the first four on every push to `main` and on pull requests. `notes:check` runs inside the
test suite, so a stale `CHANGELOG.md` fails `pnpm test` too.
