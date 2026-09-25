#!/usr/bin/env -S deno run -A
// One-time (T-39629): every session Claude Code ran on this machine is read
// from its own transcript file by one importer now (@yaks/session/tail). What
// the graph holds of those sessions came from the importers before it: the
// fleet server's (`imported{source: 'native'}`, and the `stop` it wrote at
// each turn's end), the turn spool, and past.ts. All of it was derived from
// the same files, in shapes the new importer does not write, so each outside
// session with a transcript on disk loses its entries here, and the duty reads
// the file in again: a recent one at full depth, an older one its prose alone.
// The session rows, their briefs and their claims stay.
//
// A dry run lists what each session would lose, by the kinds of entry, and
// rehearses the deletes to show anything outside them the deletes would touch.
//
// The write holds the session duty's lease (`@yaks/session`) from before it
// reads until the last delete: no importer, the old spool's or the new one,
// reads a transcript into a session while it is being emptied. Start it, then
// restart the server; it takes the lease the old server gives back, the new
// one waits for it, and reads every transcript in once it is free. The deletes
// go in small batches, so every other writer waits well under its busy
// timeout. `--import` runs the duty's looks here instead, once the lease is
// let go, which is how a copy proves the whole change.
//
//   deno run -A bin/reimport-transcripts.ts <config> [--write] [--import]

import type { Bundle, Eid } from '@yaks/graph'
import { holding } from '@yaks/effects'
import { close, opened } from '../packages/cli/local.ts'
import { sessionFor } from '../packages/session/who.ts'
import {
  claudeProjects,
  look,
  managed,
  type Seen,
  transcripts,
} from '../packages/session/service.ts'

let [path, ...flags] = Deno.args
let write = flags.includes('--write')
let reimport = flags.includes('--import')
let host = await opened(path, ['graph'], false)
let g = host.graph
let dir = claudeProjects()!

let KINDS = [
  'imported',
  'content',
  'output',
  'reasoning',
  'call',
  'result',
  'notice',
  'stop',
  'error',
  'exception',
  'ask',
  'using',
]
let kinds = KINDS.map((k) => k == 'call' ? '?call.id' : `?${k}`).join('&')

let BATCH = Number(Deno.env.get('BATCH') ?? 100)

let migrate = async () => {
  let doomed: Eid[] = []
  let shapes: Record<string, number> = {}
  let sessions = 0
  for (let f of transcripts(dir)) {
    let s = await sessionFor(g, f.id)
    if (!s || await managed(g, s.entity.eid)) continue
    let entries = await g.read(`.entry.session=${s.entity.eid}&${kinds}`)
    if (!entries.length) continue
    sessions++
    for (let b of entries) {
      let shape = KINDS.filter((k) => b[k] != null).join('+') || '(none)'
      shapes[shape] = (shapes[shape] ?? 0) + 1
      doomed.push(b.entity.eid)
    }
  }
  console.log(`${doomed.length} entries in ${sessions} sessions`, shapes)

  let deletes = (eids: Eid[]): Bundle[] =>
    eids.map((eid) => ({ entity: { eid }, $delete: true }))

  if (!write) {
    // What a delete would also touch: anything that is not one of these entries.
    let doom = new Set(doomed)
    let touched: Record<string, number> = {}
    for (let i = 0; i < doomed.length; i += BATCH) {
      let made = await g.apply(deletes(doomed.slice(i, i + BATCH)), {
        check: true,
      })
      for (let b of made) {
        if (doom.has(b.entity.eid)) continue
        let shape = Object.keys(b).filter((k) => k != 'entity').join('+')
        touched[shape] = (touched[shape] ?? 0) + 1
      }
    }
    console.log('beyond the entries, a delete touches', touched)
  } else {
    for (let i = 0; i < doomed.length; i += BATCH) {
      let t = performance.now()
      await g.apply(deletes(doomed.slice(i, i + BATCH)))
      console.log(
        `${Math.min(i + BATCH, doomed.length)} of ${doomed.length}: ${
          Math.round(performance.now() - t)
        }ms`,
      )
    }
  }
}

if (write) {
  let live = new AbortController()
  console.log('waiting for the @yaks/session lease')
  await holding(
    g,
    '@yaks/session',
    { holder: host.me, signal: live.signal, poll: 100 },
    async () => {
      await migrate()
      live.abort()
    },
  )
} else {
  await migrate()
}

if (reimport) {
  let said = host.config.person
  let person = said && ((await g.address([said])).get(said) ?? said)
  let seen: Seen = { tails: new Map(), done: new Set() }
  let files = transcripts(dir).length
  let t = performance.now()
  // Every look reads the recent transcripts on and one older one in; the
  // older ones are done when every file has been read or followed.
  while (seen.done.size + seen.tails.size < files) {
    let before = seen.done.size + seen.tails.size
    await look(g, dir, seen, { person: person as Eid })
    if (seen.done.size + seen.tails.size == before) break
  }
  console.log(
    `read ${seen.tails.size} followed and ${seen.done.size} older transcripts in ${
      Math.round(performance.now() - t)
    }ms`,
  )
}
await close(0)
