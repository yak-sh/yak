// Timed effects over values. A game supplies its kinds, amounts and modifier
// signs; absolute deadlines and tick cursors make frame rate irrelevant.
export type Effect<K extends string = string> = { kind: K }

export type Lasting<K extends string = string, S extends string = string> =
  & Effect<K>
  & { ms: number; amount?: number; stat?: S; share?: number }

export type Status<K extends string = string, S extends string = string> = {
  id: string
  target: string
  life: number
  name: string
  kind: K
  until: number
  next: number
  amount: number
  stat?: S
  share?: number
}

export let carries = <K extends string, S extends string = string>(
  value: unknown,
  kind: (value: string) => value is K,
): Status<K, S>[] =>
  Array.isArray(value)
    ? value.filter((s) =>
      typeof s?.id == 'string' &&
      typeof s?.target == 'string' && typeof s?.until == 'number' &&
      typeof s?.next == 'number' && typeof s?.amount == 'number' &&
      typeof s?.kind == 'string' && kind(s.kind)
    )
    : []

export let applied = <K extends string, S extends string = string>(
  e: Lasting<K, S>,
  target: string,
  life: number,
  name: string,
  now: number,
  id: string = crypto.randomUUID(),
): Status<K, S> => ({
  id,
  target,
  life,
  name,
  kind: e.kind,
  until: now + e.ms,
  next: now + 1000,
  amount: e.amount ?? 0,
  ...e.stat == null ? {} : { stat: e.stat, share: e.share },
})

/** Includes a tick on the expiry boundary, but never one after expiry. */
export let elapsed = (
  s: Status,
  now: number,
): { amount: number; next: number } => {
  let ticks = Math.max(
    0,
    Math.floor((Math.min(now, s.until) - s.next) / 1000) + 1,
  )
  return { amount: ticks * s.amount, next: s.next + ticks * 1000 }
}

export let factor = <K extends string, S extends string>(
  statuses: Status<K, S>[],
  target: string,
  stat: S | undefined,
  now: number,
  life: number | undefined,
  direction: (kind: K) => number,
  minimum: number,
): number =>
  Math.max(
    minimum,
    1 + statuses.filter((s) =>
      s.target == target && s.stat == stat && s.until > now &&
      (life == null || s.life == life)
    ).reduce((n, s) => n + direction(s.kind) * (s.share ?? 0), 0),
  )

export let labels = (statuses: Status[], now: number): string =>
  statuses.filter((s) => s.until > now).map((s) =>
    `${s.name.replace(/[<>&"']/g, '')} ${Math.ceil((s.until - now) / 1000)}s`
  ).join(' · ')

/** Refresh one named source. Games identify periodic kinds whose next tick
 * and per-tick amount must survive a refresh. */
export let refreshed = <K extends string, S extends string>(
  held: Status<K, S>[],
  next: Status<K, S>,
  periodic: (kind: K) => boolean,
): Status<K, S>[] => {
  let prior = held.find((s) => s.id == next.id)
  let keep = prior && periodic(next.kind)
    ? { ...next, next: prior.next, amount: prior.amount }
    : next
  return [...held.filter((s) => s.id != next.id), keep]
}
