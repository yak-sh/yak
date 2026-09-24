// What a host does about a persona that changed, exported as
// `@yaks/persona/effects`: it writes the persona files again (./files.ts) a
// moment after the write commits, so a checkout's AGENTS.md says what the
// graph says without anybody running `persona sync`.
//
// Only where the config asks for it: `{"use": "@yaks/persona", "with":
// {"files": true}}`. Each file's path comes from a project's checkout, not from
// the database, so a host opened on a copy of a graph would write into the
// checkouts the original names. The live host opts in; a probe does not.
//
// A write starts a timer and returns, so the commit is never held open, and a
// burst of writes is one pass. A pass renders every persona (a few hundred
// milliseconds over the fleet's graph) and writes only the files whose text
// moved, so the watches only have to avoid passes nothing asked for: a doc
// edit or a new link counts when it touches something the last pass said. A
// host that has not made a pass yet counts every one, and its first pass
// learns the set. Passes run one at a time; the timer is dropped when the
// host shuts down.

import type { Watch } from '@yaks/effects'
import type { Eid, Graph } from '@yaks/graph'
import { EDGE, relations } from '@yaks/edge'
import { DOC } from '@yaks/doc'
import { sync } from '@yaks/mirror'
import type { Vocab } from '@yaks/vocab'
import { PERSONA } from './comp.ts'
import { personaMirror, remembered } from './files.ts'
import { CARRIES, READS } from './worn.ts'

/** What this plugin reads from its entry in a config. */
export type Options = { files?: boolean }

/** How long a burst of writes settles before one pass answers all of it. */
export let AFTER = 1_000

/** The watches that keep the persona files current, when `files` is on. */
export let effects = (
  host: {
    graph: Graph
    vocab: Vocab
    config?: { db?: string }
    stopping?: AbortSignal
  },
  options: Options = {},
): Watch[] => {
  if (!options.files) return []
  let db = host.config?.db ?? Deno.env.get('DB_PATH')
  let said = new Set<Eid>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = Promise.resolve()
  let pass = async () => {
    try {
      let m = await personaMirror(host.graph, remembered(db))
      said = m.said
      let done = await sync(m.binding)
      for (let f of done.failed) console.warn('@yaks/persona files —', f)
      for (let p of done.conflicts) {
        console.warn(`@yaks/persona files — ${p} was edited by hand, left`)
      }
    } catch (error) {
      console.warn('@yaks/persona files —', error)
    }
  }
  let soon = () => {
    if (host.stopping?.aborted) return
    clearTimeout(timer)
    timer = setTimeout(() => last = last.then(pass), AFTER)
  }
  host.stopping?.addEventListener('abort', () => clearTimeout(timer), {
    once: true,
  })
  let about = (...eids: unknown[]) =>
    (!said.size || eids.some((e) => said.has(String(e)))) && soon()
  let tags = relations(host.vocab)
  let doc = 'write the persona files again'
  return [
    {
      comp: PERSONA,
      created: soon,
      changed: { home: soon },
      removed: soon,
      doc,
    },
    {
      comp: DOC,
      changed: {
        title: (e) => about(e.entity.eid),
        body: (e) => about(e.entity.eid),
      },
      doc,
    },
    { comp: EDGE, created: (e) => about(e.comp?.from, e.comp?.to), doc },
    // An unlinked edge is gone before anybody can read which ends it had.
    ...[tags[CARRIES], tags[READS]].filter(Boolean).map((comp) => ({
      comp,
      removed: soon,
      doc,
    })),
  ]
}
