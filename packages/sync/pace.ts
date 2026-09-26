// How often a relayed value leaves: the `pace` a `sync: peers` component
// declares (@yaks/vocab lifetime.ts).
//
// A page that moves something every frame writes every frame, and its own
// graph takes every write at once. What crosses the socket is paced: for each
// entity, a paced component is sent at most once a pace. The first write after
// a quiet spell goes at once; the writes inside the pace fold into one patch,
// sent when the pace runs out, so the last value always arrives and a mover
// that stops is heard where it stopped. A clear goes at once, and takes the
// patch it would have followed with it: a peer should not see a value come
// back after it was cleared.
//
// A pace starts per send, not per value: the values one relay message carried
// cool together, and what they gathered goes out together, so a page moving
// forty things sends one message a pace, not forty.

import type { Bundle, Comp, Eid } from '@yaks/graph'
import { comps } from '@yaks/graph'
import { paceOf, type Vocab } from '@yaks/vocab'
import type { Timer } from './socket.ts'

// One relayed component on one entity, and what is said about it.
type Said = [eid: Eid, comp: string, patch: Comp | null]

let key = (eid: Eid, comp: string) => eid + ' ' + comp

// Said values, one bundle per entity, in the order they were said.
let bundled = (said: Said[]): Bundle[] => {
  let out = new Map<Eid, Bundle>()
  for (let [eid, comp, patch] of said) {
    let b = out.get(eid) ?? { entity: { eid } }
    b[comp] = patch
    out.set(eid, b)
  }
  return [...out.values()]
}

/**
 * The relay, paced. Returns what the sync hands each committed write's relayed
 * bundles to; `send` is the socket's relay, and `timer` is how a pace is timed.
 * A component with no pace is sent as it is written.
 */
export let pacer = (
  vocab: Vocab,
  send: (bundles: Bundle[]) => void,
  timer: Timer,
): (bundles: Bundle[]) => void => {
  let cooling = new Set<string>() // sent less than a pace ago
  let gathered = new Map<string, Said>() // written since, folded into one

  let say = (said: Said[]) => {
    if (said.length) send(bundled(said))
  }

  // A pace ran out for the values one message carried: what they gathered
  // meanwhile goes out, and starts the next pace; the rest are quiet again.
  let cool = (keys: string[], pace: number) =>
    timer(() => {
      let due = keys.filter((k) => gathered.has(k))
      for (let k of keys) if (!gathered.has(k)) cooling.delete(k)
      say(due.map((k) => gathered.get(k)!))
      for (let k of due) gathered.delete(k)
      if (due.length) cool(due, pace)
    }, pace)

  return (bundles) => {
    let now: Said[] = []
    let starting = new Map<number, string[]>() // pace → the keys it times
    for (let b of bundles) {
      let eid = b.entity.eid
      for (let [comp, patch] of comps(b)) {
        let k = key(eid, comp)
        let pace = paceOf(vocab, comp)
        if (patch == null) gathered.delete(k)
        if (patch == null || pace == null) now.push([eid, comp, patch])
        else if (cooling.has(k)) {
          let was = gathered.get(k)?.[2]
          gathered.set(k, [eid, comp, { ...was, ...patch }])
        } else {
          cooling.add(k)
          now.push([eid, comp, patch])
          if (!starting.has(pace)) starting.set(pace, [])
          starting.get(pace)!.push(k)
        }
      }
    }
    say(now)
    for (let [pace, keys] of starting) cool(keys, pace)
  }
}
