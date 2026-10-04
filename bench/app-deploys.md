# App deploy timing

What a person waits for when they deploy an app on yaks.app, and the ratchet
that keeps it from growing (goal V-34987, task T-34986).

```sh
TOKEN_FILE=~/.yak/grant deno task app-deploy:time   # on the box; records
deno task app-deploy:gate                            # anywhere; reads
```

`app-deploy:time` mints a throwaway app in `SPACE` (default `jeff`) on `HOST`
(default `yaks.app`), then `RUNS` (default 5) times: writes three small files
with `app_files` and polls the app URL until the new bytes answer; calls
`app_deploy`; writes one file and polls again. The app is deleted forever at the
end. One row per run of the script is appended to `bench/app-deploys.jsonl`:
median and p95 per step, plus the median `Server-Timing` per stage from the
answers, so a number that moved says which hop moved it. Commit the row with the
next change.

The token is a `grant` from the connector, an hour long and narrowed to the
space, read from `TOKEN_FILE` and never printed. Staging (`HOST=yaks.fyi`) is
the right host once it can sign someone in; until it can mail (T-34979) it
cannot, so production with a throwaway app is the default.

`app-deploy:gate` reads the committed rows through
[@yaks/benchmark](../packages/benchmark/README.md), checking the latest row
against that host's entries in `bench/app-deploy.baseline.json`. It checks three
medians: files → live, deploy, and one file → live. The baseline preserves each
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

## Baseline

2026-09-08, production, 5 runs, before `Server-Timing` on the write doors:

| step      | call median | live median | live p95 |
| --------- | ----------: | ----------: | -------: |
| files (3) |     3561 ms |     3718 ms |  4046 ms |
| deploy    |     3871 ms |             |  4501 ms |
| one file  |     2108 ms |     2338 ms |  3398 ms |

A plain GET from the same box took 190–520 ms, so the write call is the cost and
the bytes are live 150–250 ms after it answers.
