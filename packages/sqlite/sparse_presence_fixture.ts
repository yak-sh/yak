// A tiny public world beside retained history, with real planner statistics.
import { graph } from '@yaks/graph'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { loadVocab } from '@yaks/vocab'
import type { Driver } from '@yaks/sql'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'

export let presenceVocab = loadVocab([archetypeDoc, {
  $defs: {
    den: {
      component: true,
      type: 'object',
      properties: { name: { type: 'string' } },
    },
    chosen: { component: true, type: 'object' },
    hidden: { component: true, type: 'object' },
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
}])

export let seedPresence = (d: Driver) => {
  let s = storage(d, presenceVocab)
  s.install()
  let g = graph({ storage: s, vocab: presenceVocab, plugins: [archetypes()] })
  for (let at = 0; at < 10000; at += 500) {
    g.apply(Array.from({ length: 500 }, (_, i) => ({
      entity: { eid: `history-${at + i}` },
      doc: { title: 'retained' },
    })))
    if (at == 4500) {
      g.apply([
        { entity: { eid: 'world' }, den: { name: 'Mossvale' } },
        { entity: { eid: 'choice' }, chosen: {} },
        { entity: { eid: 'secret' }, chosen: {}, hidden: {} },
      ])
    }
  }
  d.query({ t: 'analyze' })
  return catalog(d)!
}
