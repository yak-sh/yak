# Deployment

An owner database has exactly one serving process. `src/server.ts` acquires an
exclusive lock on `<database>-server.lock` before dynamically importing the
runtime module graph. Consequently `live_db.ts`, SQLite open, WAL negotiation,
schema inspection, migration, backfill, and boot writes are all behind the lock.
It remains held through migration, reconciliation, readiness, serving, and
graceful database close. A rejected boot exits with code 73 and a durable
diagnosis in the supervisor log; it never opens SQLite or announces readiness.

A deployment stops the old `tasksd` process, waits for the server and effects
worker to exit, and only then starts the replacement. Brief HTTP downtime is
intentional. The effects worker is started only after the guarded server's
readiness beat, so it cannot race boot migration. Per-socket workers are
children of that serving path and open read-only. Offline utilities
(`task backup`, `deno task seed`, explicit backfills) remain separate operator
commands; do not run them as a second server.

Use an ordinary sequential systemd restart. There is no shared-port successor,
`--join` mode, PREPPED handoff, writer lock, or Deno/Rust owner-database
co-serving mode. The exclusive port claim rejects a second serving process even
for the same database. `TASKS_PLANE=app` and `yak-bridge` accept disposable
parity databases only and refuse the owner path.

The app-plane proxy and Rust front remain only because the parity harness still
exercises those routes on disposable copies. Retiring that compatibility code is
a separate cleanup; it must not be re-enabled as an owner-database deployment
topology meanwhile.

## Schema-breaking controlled cutover

Binaries shipped before the pre-open ownership barrier are unsupported during a
schema-breaking cutover. Stop every old server, effects process, auxiliary
reader, and offline writer first; do not rely on an old binary to observe the
new lock or understand the new schema.

Rehearse and execute the cutover in this order:

1. Stop and reap all old processes. Confirm no server is ready and no utility
   still has the owner database open.
2. Take a consistent backup. Restore it to a disposable path and require
   `pragma integrity_check = 'ok'`, the expected schema version, and matching
   graph row counts before proceeding.
3. On another disposable copy, start exactly one current guarded successor.
   Require one migration, the expected `user_version`, integrity checks, and the
   HTTP readiness beat. Only then admit current-version readers.
4. Inject a migration failure in the rehearsal. Require the successor to stop
   without readiness and release ownership only after its storage work has
   unwound. Restore the already-verified backup, re-check its pre-cutover schema
   and graph facts, then retry from the guarded successor.
5. Repeat the stop, verified backup, single-successor migration, integrity, and
   readiness sequence against the owner database. Preserve the verified backup
   until post-cutover validation is complete.

Normal additive migrations remain transactional and idempotent. A
schema-breaking migration is nevertheless a controlled maintenance event: the
lock prevents a second server from touching storage, but it does not make old
readers version-compatible. Reader-version enforcement and Screen storage are
separate integrations.
