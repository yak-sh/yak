// The bands' turns: each beat of a band makes one change to the tab's graph
// through the door its block names (the browser, an agent over MCP, a
// terminal), once, in order, after the story's steps, and what each printed
// and changed is kept for its window. A band reached runs every band above it
// first: the reader has passed them, and what a beat names may be what an
// earlier one made.
import type { Yak } from './yak.ts'
import type { Term } from './term.ts'
import { subjectOf } from './figure.ts'
import { type Beat, called } from './site.ts'

/** What a turn did: what its window printed, and the entity it changed. */
export type Done = { out: string[]; fault: boolean; eid?: string }

export type Turns = ReturnType<typeof turns>

type Band = { beats: Beat[]; ran: number; done: Done[] }

export let turns = (yak: Yak, term: Term) => {
  // Each band by its key, in the order the page drew them.
  let bands = new Map<string, Band>()
  let chain = Promise.resolve()
  let listeners = new Set<() => void>()
  let told = () => listeners.forEach((l) => l())
  // A beat through the door its block names: typed in a terminal, called by
  // the agent, or called by a page in the browser. An outbox beat writes
  // nothing: it shows what an earlier write left to happen; a session beat
  // starts a session wearing a persona, and shows what it is given.
  let run = (b: Beat) => {
    if (b.kind == 'outbox') return Promise.resolve({ code: 0, out: [] })
    if (b.kind == 'session') return yak.context(b.line)
    if (b.kind == 'sh') return yak.run(b.line)
    let { tool, args } = called(b.line)
    return b.kind == 'mcp' ? yak.ask(tool, args) : yak.call(tool, args)
  }
  let turn = (band: Band, i: number) =>
    chain = chain.then(() => term.idle()).then(async () => {
      // What the turn changed is the subject of its last write.
      let eid: string | undefined
      let stop = yak.listen(({ bundles, generation }) => {
        if (!generation) eid = subjectOf(bundles) ?? eid
      })
      let { code, out } = await run(band.beats[i]).finally(stop)
      await yak.settled()
      band.done[i] = { out, fault: code != 0, eid }
      told()
    })
  let upto = (band: Band, n: number) => {
    while (band.ran < Math.min(n, band.beats.length)) turn(band, band.ran++)
  }
  return {
    /** A band's beats, the first time as the page draws it. */
    band: (key: string, beats: Beat[]) => {
      let band = bands.get(key)
      if (band) band.beats = beats
      else bands.set(key, { beats, ran: 0, done: [] })
    },
    /** Run every beat of a band up to `n` (counting from 1) that has not
     * run, after every beat of each band above it. */
    reach: (key: string, n: number) => {
      for (let [k, band] of bands) {
        if (k == key) {
          upto(band, n)
          break
        }
        upto(band, Infinity)
      }
      return chain
    },
    /** What beat `i` of a band did, once it has run. */
    done: (key: string, i: number): Done | undefined => bands.get(key)?.done[i],
    listen: (l: () => void) => {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    /** Settles once every beat reached has run. */
    idle: () => chain,
  }
}
