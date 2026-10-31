# App deploy timing

What a person waits for when they deploy an app on yaks.app, with the server
stages that explain each observation.

```sh
deno task app-deploy:time          # on the box; signs in a throwaway, records
deno task bench:check app-deploy   # reports the latest recorded waits
```

`app-deploy:time` signs in as a test account (`NAME`, default
`app-deploy-bench`; `yak auth yaks.app --as`) on `HOST` (default `yaks.app`) and
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
stay in the file and are never compared with these; the observed waits have new
names (`ship → live`, `ship deploy`, `edit → live`).

App deploy observations include network round trips, storage waits and live-byte
polling. The server does not report the CPU used by that work. These
observations stay diagnostic: the monitor excludes them, and
`bench:check app-deploy` writes `bench/app-deploy.results.json` without
comparing or banking a wall-clock baseline. Corrupt rows still fail.
`bench:ratchet app-deploy` also reports the observations without changing a
baseline.
