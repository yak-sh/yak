# App deploy timing

What a person waits for when they deploy an app on yaks.app, and the ratchet
that keeps it from growing (goal V-34987, task T-34986).

```sh
deno task app-deploy:time          # on the box; signs in a throwaway, records
deno task bench:check app-deploy   # reads the rows and judges the latest
```

`app-deploy:time` signs in as a throwaway account (`NAME`, default
`app-deploy-bench`; `yak admin throwaway`) on `HOST` (default `yaks.app`) and
mints a one-hour grant narrowed to that account's own space, so it never touches
the owner's account or an account key. The grant stays in memory, is never
printed, and is revoked at the end. Then `RUNS` (default 5) times it ships three
small files (`app_files` stages them, `app_deploy` puts them live) and polls the
app URL until the new bytes answer, then ships a one-file change the same way.
The app is deleted forever at the end. One row per run of the script is appended
to `bench/app-deploys.jsonl`: median and p95 of the write call, the deploy call
and the whole change until live, plus the median `Server-Timing` per stage from
the answers, so a number that moved says which hop moved it. Commit the row with
the next change.

Before `app_files` writes were staged until `app_deploy`, the rows measured
`files → live`, `deploy` and `one file → live`. Those rows (the `files3` ones)
stay in the file and are never compared with these; the gated numbers have new
names (`ship → live`, `ship deploy`, `edit → live`).

`bin/bench-monitor` runs this suite daily with the others (bench/monitor.ts),
taking a fresh measurement into its own record outside the repo. It is a live
measurement (`LIVE`), with no older code to run beside it, so the monitor
reports a check that fails, not one that is slower. Main's gate does not run it:
what an app deploy costs is yaks.app's, not the commit's.

The check reads the rows through
[@yaks/benchmark](../packages/benchmark/README.md), checking the latest row
against that host's entries in `bench/app-deploy.baseline.json`. It checks three
medians: ship → live, ship deploy, and edit → live. The baseline preserves each
host's banked minimum with a 25% tolerance; host names are part of the bench
names, so rows from different hosts are never compared. A check writes
`bench/app-deploy.results.json` and never changes the baseline. No rows pass as
bootstrap. Corrupt rows fail. A host without a banked baseline passes as an
unbanked measurement until explicit acceptance.

App deploy medians have a 1 ms resolution. The ratchet rounds the tolerance
boundary to whole milliseconds, so a 2106 ms floor permits 2633 ms at 25%.

Accept reviewed observations explicitly:

```sh
deno task bench:ratchet app-deploy
```

Acceptance reads the recorded rows; it does not mint an app or run a deploy. It
retains baseline entries for other hosts. Review and commit the baseline diff.
