# Deployment

An owner database has exactly one serving process. A deployment stops the old
`tasksd` process, waits for it to exit, and only then starts the replacement.
The replacement opens the database, runs the idempotent migration in one
`BEGIN IMMEDIATE` transaction, completes boot reconciliation, and binds the HTTP
port. Brief HTTP downtime is intentional; direct SQLite clients continue
normally.

Use an ordinary sequential systemd restart. There is no shared-port successor,
`--join` mode, PREPPED handoff, writer lock, or Deno/Rust owner-database
co-serving mode. The exclusive port claim rejects a second serving process even
for the same database. `TASKS_PLANE=app` and `yak-bridge` accept disposable
parity databases only and refuse the owner path.

The app-plane proxy and Rust front remain only because the parity harness still
exercises those routes on disposable copies. Retiring that compatibility code is
a separate cleanup; it must not be re-enabled as an owner-database deployment
topology meanwhile.

Schema changes shipped through serving-process startup must be transactional,
idempotent, and compatible across the deployment boundary. Use additive
expand/contract changes while versions may differ. A destructive cutover is an
explicit offline maintenance operation, never a process-lifetime database lock.
