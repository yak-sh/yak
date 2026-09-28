// Brief combat events carried by a player's fight, and replayed once by
// nearby pages. The fight remains the account of damage; these are its visuals.
import type { Event } from './play.ts'

export type PeerEvent = Extract<
  Event,
  { type: 'ability' | 'shot' | 'burst' | 'hit' | 'held' }
>
export type Pulse = { n: number; at: number; event: PeerEvent }

let visible = (e: Event): e is PeerEvent =>
  e.type == 'ability' || e.type == 'shot' || e.type == 'burst' ||
  e.type == 'hit' || e.type == 'held'

export let pulses = (value: unknown): Pulse[] =>
  Array.isArray(value)
    ? value.filter((p) =>
      typeof p?.n == 'number' && typeof p?.at == 'number' &&
      typeof p?.event?.type == 'string' && visible(p.event)
    ).map((p) => ({ n: p.n, at: p.at, event: p.event }))
    : []

export let publish = (
  events: Event[],
  held: Pulse[],
  serial: number,
  now: number,
): { events: Pulse[]; serial: number } => {
  let recent = held.filter((p) => now - p.at < 8000).slice(-63)
  for (let event of events) {
    if (visible(event)) recent.push({ n: ++serial, at: now, event })
  }
  return { events: recent.slice(-64), serial }
}

export let replay = (
  held: Pulse[],
  serial: number,
  seen: number,
  now: number,
): { seen: number; events: Event[] } => {
  let from = serial < seen ? 0 : seen
  return {
    seen: serial,
    events: held.filter((p) => p.n > from && now - p.at < 2000).map((p) =>
      p.event.type == 'hit'
        ? {
          type: 'struck',
          eid: p.event.eid,
          at: p.event.at,
          dmg: p.event.dmg,
        }
        : p.event
    ),
  }
}
