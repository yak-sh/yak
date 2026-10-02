// Lasting effects ride in their caster's fight. Absolute deadlines and tick
// cursors make frame rate irrelevant; peers read the same carriers and expiry.
import type { Effect } from './ability-effects.ts'

export type Lasting = Extract<
  Effect,
  { kind: 'dot' | 'hot' | 'buff' | 'debuff' }
>
export type Status = {
  id: string
  target: string
  life: number
  name: string
  kind: Lasting['kind']
  until: number
  next: number
  amount: number
  stat?: 'damage' | 'armor' | 'speed'
  share?: number
}

export let lasting = (e: Effect): e is Lasting =>
  e.kind == 'dot' || e.kind == 'hot' || e.kind == 'buff' || e.kind == 'debuff'

export let carries = (value: unknown): Status[] =>
  Array.isArray(value)
    ? value.filter((s) =>
      typeof s?.id == 'string' &&
      typeof s?.target == 'string' && typeof s?.until == 'number' &&
      typeof s?.next == 'number' && typeof s?.amount == 'number' &&
      ['dot', 'hot', 'buff', 'debuff'].includes(s?.kind)
    )
    : []

export let applied = (
  e: Lasting,
  target: string,
  life: number,
  name: string,
  now: number,
  blow: number,
  max: number,
  id = crypto.randomUUID(),
): Status => ({
  id,
  target,
  life,
  name,
  kind: e.kind,
  until: now + e.ms,
  next: now + 1000,
  amount: e.kind == 'dot'
    ? blow * e.scale / Math.floor(e.ms / 1000)
    : e.kind == 'hot'
    ? max * e.share / Math.floor(e.ms / 1000)
    : 0,
  ...e.kind == 'buff' || e.kind == 'debuff'
    ? { stat: e.stat, share: e.share }
    : {},
})

/** Includes a tick on the expiry boundary, but never one after expiry. */
export let elapsed = (s: Status, now: number) => {
  let ticks = Math.max(
    0,
    Math.floor((Math.min(now, s.until) - s.next) / 1000) + 1,
  )
  return { amount: ticks * s.amount, next: s.next + ticks * 1000 }
}

export let factor = (
  statuses: Status[],
  target: string,
  stat: Status['stat'],
  now: number,
  life?: number,
): number =>
  Math.max(
    0.1,
    1 + statuses.filter((s) =>
      s.target == target && s.stat == stat && s.until > now &&
      (life == null || s.life == life)
    ).reduce((n, s) => n + (s.kind == 'debuff' ? -1 : 1) * (s.share ?? 0), 0),
  )

export let labels = (statuses: Status[], now: number): string =>
  statuses.filter((s) => s.until > now).map((s) =>
    `${s.name.replace(/[<>&"']/g, '')} ${Math.ceil((s.until - now) / 1000)}s`
  ).join(' · ')
