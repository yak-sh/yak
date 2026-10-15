// Mossvale's lasting kinds and tuning; timing and refresh rules live in game.
import {
  applied as apply,
  carries as decode,
  factor as modifier,
  refreshed as refresh,
  type Status as TimedStatus,
} from '@yaks/game'
import type { Effect } from './ability-effects.ts'

export { elapsed, labels } from '@yaks/game'
export type Lasting = Extract<
  Effect,
  { kind: 'dot' | 'hot' | 'buff' | 'debuff' }
>
export type Status = TimedStatus<Lasting['kind'], 'damage' | 'armor' | 'speed'>

let kind = (value: string): value is Lasting['kind'] =>
  ['dot', 'hot', 'buff', 'debuff'].includes(value)

export let lasting = (e: Effect): e is Lasting => kind(e.kind)
export let carries = (value: unknown): Status[] => decode(value, kind)

export let applied = (
  e: Lasting,
  target: string,
  life: number,
  name: string,
  now: number,
  blow: number,
  max: number,
  id?: string,
): Status =>
  apply(
    {
      ...e,
      amount: e.kind == 'dot'
        ? blow * e.scale / Math.floor(e.ms / 1000)
        : e.kind == 'hot'
        ? max * e.share / Math.floor(e.ms / 1000)
        : 0,
    },
    target,
    life,
    name,
    now,
    id,
  )

export let factor = (
  statuses: Status[],
  target: string,
  stat: Status['stat'],
  now: number,
  life?: number,
): number =>
  modifier(
    statuses,
    target,
    stat,
    now,
    life,
    (k) => k == 'debuff' ? -1 : 1,
    0.1,
  )

export let refreshed = (held: Status[], next: Status): Status[] =>
  refresh(held, next, (k) => k == 'dot' || k == 'hot')
