# Package gate stability — T-37432

## Reproduction

Base: `a201e206`. Linux x86_64, Deno 2.9.1, V8 14.9.207.2-rusty, TypeScript
6.0.3; dynamically loaded SQLite 3.53.3
(`/home/linuxbrew/.linuxbrew/opt/sqlite/lib/libsqlite3.so.0`).

Ten sequential invocations, not a retrying gate:

```sh
ulimit -c unlimited
for i in $(seq 1 10); do
  timeout --kill-after=10s 180s env DENO_JOBS=16 deno task check:packages \
    > "run-$i.log" 2>&1
  echo "$i exit=$?"
done
```

`coredumpctl` was unavailable; the kernel wrote `core.<pid>` in the working
directory. Nine runs exited 139; one reached the 180-second diagnostic deadline
(exit 124). Raw logs and the retained first core are in `/tmp/T-37432-before/`
on the investigation host. Redundant multi-GB cores were removed after
extracting backtraces. No cores are committed.

| Run | Exit | Seconds |
| --- | ---- | ------- |
| 1   | 139  | 34      |
| 2   | 139  | 14      |
| 3   | 124  | 180     |
| 4   | 139  | 19      |
| 5   | 139  | 28      |
| 6   | 139  | 32      |
| 7   | 139  | 34      |
| 8   | 139  | 33      |
| 9   | 139  | 37      |
| 10  | 139  | 45      |

The last completed test varied; these are output tails, **not** identification
of the asynchronous caller:

- Run 1:
  `./packages/harness/children_test.ts => completion answers an open delegation call; wait rejects foreign children and times out ... ok (128ms)`
- Run 2:
  `./packages/journal/sqlite_test.ts => undo restores the prior column over SQLite ... ok (54ms)`
- Run 3:
  `./packages/harness/window_test.ts => detached windows receive frontier notices without loading new offscreen bodies ... ok (380ms)`
- Run 4:
  `./packages/journal/sqlite_test.ts => undo of a death is refused over SQLite too ... ok (52ms)`
- Run 5:
  `./packages/key/key_test.ts => a kind read under another name derives from its tag ... ok (19ms)`
- Run 6:
  `./packages/harness/store_test.ts => SQLite commits simultaneous append batches with distinct positions ... ok (393ms)`
- Run 7:
  `./packages/mail/md_test.ts => text: the words stay, a link keeps its address ... ok (1ms)`
- Run 8:
  `./packages/key/key_test.ts => a kind read under another name derives from its tag ... ok (18ms)`
- Run 9:
  `./packages/harness/streaming_test.ts => partial failure preserves text and does not automatically retry ambiguous request ... ok (924ms)`
- Run 10:
  `./packages/harness/transcript_test.ts => fenced code fills the boxed message interior without changing source ... ok (605µs)`

## Root cause

Both inspected cores stopped at `sqlite3_reset+21`, dereferencing the database
pointer from a freed statement, via `ffi_call_unix64` / `ffi_call` / Deno FFI.
This is not a process exit caused by SIGKILL.

A temporary guarded `Database.prepare()` in a separate diagnostic worktree
checked `db.open` before calling statement methods. Logging before throwing (the
migration watcher catches errors) identified this path in three runs:

```text
Timeout.check                 packages/sqlite/migration.ts:205
MigrationControl.read         packages/sqlite/migration.ts:46
harness driver.query          packages/harness/store.ts:75
cached Statement.all          sqlite3_reset (freed handle)
```

The statement was `select * from _yaks_migration where singleton = 1`, prepared
by `open()` in the durable-queue restart test in
`packages/harness/pool_test.ts`. That test stops agent A's daemon, reuses the
still-open harness with agent B, and closes B. The migration monitor introduced
by `47dfb4b9` was stopped only by `Agent.close()`, not `Daemon.stop()`. A's
interval therefore survived, then read a native statement that B's close had
finalized. Timing decides whether it faults, stalls on invalid native state, or
escapes detection before exit. The initial suspects `9559479f` and `c67de4be`
are not the source of this identified lifetime violation.

## Fix and regression coverage

- Stop the host's migration monitor synchronously at the daemon-stop boundary,
  which full agent shutdown also uses. Preserve daemon-only restart's open DB.
- Refuse both queries (including cache hits) and execs on a closed harness
  driver **before** entering FFI. The underlying library finalizes statements at
  close without invalidating their JavaScript objects.
- A fake-clock regression observes one monitor read, stops A, advances the
  clock, reuses the connection with B, closes B, and advances ten more seconds.
  It failed before the fix (two reads instead of one after A stopped), and
  passes afterward without sleeps or deliberately invoking invalid FFI.
- A driver regression covers cached queries, new queries, and exec after close.
- Correct the existing TUI table assertion to the neutral code background
  already shipped by `476aa9d8`; otherwise the now-finishing gate reports that
  unrelated stale expectation.

No runner changes, retry wrappers, test exclusions, or slow-test markings.
Targeted harness migration/store/pool and TUI table tests: 29 passed.

## Verification

Ten consecutive `DENO_JOBS=16 deno task check:packages` runs exited 0, each with
**1,676 passed / 0 failed**, using the same 180-second outer diagnostic limit.
Runs were sequential and no other investigation suite ran concurrently. The
actual gate command remains unchanged.

| Run | Exit | Seconds | Peak process-tree RSS (MiB) |
| --- | ---- | ------- | --------------------------- |
| 1   | 0    | 21.0    | 4809.5                      |
| 2   | 0    | 16.0    | 7396.0                      |
| 3   | 0    | 15.7    | 3503.0                      |
| 4   | 0    | 16.0    | 2688.4                      |
| 5   | 0    | 16.5    | 7224.3                      |
| 6   | 0    | 16.2    | 2646.2                      |
| 7   | 0    | 17.1    | 5059.2                      |
| 8   | 0    | 15.9    | 4586.4                      |
| 9   | 0    | 15.9    | 4918.2                      |
| 10  | 0    | 16.5    | 2850.7                      |

RSS was sampled every 100 ms by summing `/proc/<pid>/stat` resident pages for
the gate and its descendants; shared pages can be counted more than once and
short-lived peaks can be missed. The range was 2.6–7.2 GiB. The visible cgroup
`memory.events` did not change over these runs: `oom=0`, `oom_kill=0`,
`oom_group_kill=0`. An external observer reported host pressure during the
initial investigation (including core generation and overlapping diagnostic
runs); this is not evidence that host-wide memory pressure is impossible, nor
does it account for the captured native SIGSEGV and deterministic stale-call
regression. Memory pressure did not prevent the fixed gate from completing.

Full gates on the fixed tree:

- `deno task check`: exit 0, 23.618 seconds (including the unchanged package
  gate at default concurrency).
- `DB_PATH=:memory: deno task test`: exit 0, 45.259 seconds.
- Both suite-time reports were HELD; no timing baselines were loosened.

Post-fix logs, per-run exit/duration/RSS measurements, and cgroup counter
snapshots are in `/tmp/T-37432-after/`.
