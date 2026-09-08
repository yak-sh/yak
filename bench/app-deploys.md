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

`app-deploy:gate` reads the committed rows and gates three medians on the latest
row: files → live, deploy, and one file → live. Each may only fall: the floor is
the minimum of every earlier row from the same host, the limit is `floor × 1.25`
(`BENCH_TOL`), and a latest row above any limit fails. Rows from different hosts
are never compared. No rows, or a host's first row, pass as bootstrap. Corrupt
rows fail rather than reset a floor.

## Baseline

2026-09-08, production, 5 runs, before `Server-Timing` on the write doors:

| step      | call median | live median | live p95 |
| --------- | ----------: | ----------: | -------: |
| files (3) |     3561 ms |     3718 ms |  4046 ms |
| deploy    |     3871 ms |             |  4501 ms |
| one file  |     2108 ms |     2338 ms |  3398 ms |

A plain GET from the same box took 190–520 ms, so the write call is the cost and
the bytes are live 150–250 ms after it answers.
