/// <reference lib="deno.ns" />
// A keystroke in a page whose vocabulary declares rules: one title patched on
// one of five thousand docs, each with two notes pointing at it, in a client
// with no server (so every rule runs, as a page's own and optimistic ones do).
// Four rules, the shapes a page runs: a gate, a validation, a join from the
// doc to its notes, and a page-own state rule. Each has already fired, so a
// keystroke is what it costs to ask them and find nothing to do; a keystroke
// with no rules is the baseline.

import { type Bundle } from '@yaks/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { client } from './client.ts'

let text = { type: 'string' }
let doc: VocabDoc = {
  $defs: {
    doc: { component: true, type: 'object', properties: { title: text } },
    note: {
      component: true,
      type: 'object',
      properties: { doc: { type: 'string', ref: 'entity' }, body: text },
    },
    shelf: { component: true, type: 'object', properties: { aisle: text } },
    flag: {
      component: true,
      type: 'object',
      properties: { level: { type: 'string', enum: ['ok'] } },
    },
    tagged: { component: true, type: 'object', properties: { by: text } },
    Pick: {
      component: true,
      type: 'object',
      sync: 'none',
      durable: 'connection',
      properties: { seen: { type: 'boolean' } },
    },
  },
}
let rules: VocabDoc = {
  $defs: {
    shelve: { rule: true, match: '.doc, +!shelf, +shelf.aisle=Z' },
    guard: { rule: true, match: '.doc.title=bad, +!flag, +flag.level=boom' },
    tag: {
      rule: true,
      match: '$d .doc; .note, note.doc=$d, +!tagged, +tagged.by=rule',
    },
    pick: { rule: true, match: '.doc, +!Pick, +Pick.seen=true' },
  },
}

let DOCS = 5_000

let page = (declared: boolean) => {
  let c = client(loadVocab(declared ? [doc, rules] : [doc]), [], {
    vault: false,
    wireVault: false,
  })
  let seed: Bundle[] = []
  for (let i = 0; i < DOCS; i++) {
    seed.push({ entity: { eid: `d${i}` }, doc: { title: `doc ${i}` } })
    for (let n = 0; n < 2; n++) {
      seed.push({ entity: { eid: `n${i}.${n}` }, note: { doc: `d${i}` } })
    }
  }
  c.mutate(seed)
  let n = 0
  return () => {
    n++
    c.mutate([{ entity: { eid: 'd7' }, doc: { title: `doc 7${n}` } }])
  }
}

let plain = page(false)
let ruled = page(true)

Deno.bench('keystroke, no rules', { group: 'keystroke', baseline: true }, plain)
Deno.bench('keystroke, four rules', { group: 'keystroke' }, ruled)
