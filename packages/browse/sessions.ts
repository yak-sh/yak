import type { Ent } from './types.ts'
import { sessionCap } from './tray_query.ts'

export type RunnerLease = { holder?: string; until?: string }

// Transcript status records history. A lease or an unexited process proves
// that the runner is alive, including while it rests between turns.
export let trayLive = (e: Ent, lease?: RunnerLease, now = Date.now()) =>
  (!!lease?.holder && !!lease.until && Date.parse(lease.until) > now) ||
  (!!e.process?.pid && !e.exit)

let started = (e: Ent) => Date.parse(e.created?.at ?? '') || 0
export let traySessions = (
  rows: [string, Ent][],
  leases: Record<string, RunnerLease> = {},
  now = Date.now(),
) =>
  rows.toSorted(([aid, a], [bid, b]) =>
    Number(trayLive(b, leases[bid], now)) -
      Number(trayLive(a, leases[aid], now)) || started(b) - started(a)
  ).slice(0, sessionCap)
