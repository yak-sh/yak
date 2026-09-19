// Composition: one vocabulary out of both halves. The fleet authors its words
// in src/vocab/manifests/*.json; each `@yaks/*` package authors its own in
// packages/<name>/vocab.json; and `loadVocab` refuses a name declared twice,
// because a word has one home. The end state D-37573 names is `yak serve` over
// a plugin config, where those two lists are ONE list — so the day the fleet
// manifests become plugin vocabularies, every word has to already mean one
// thing across the whole set.
//
// This test is that invariant, held from both ends:
//
//   1. The PACKAGES compose with each other, today, for real — loadVocab over
//      every packages/*/vocab.json, and it must not throw.
//   2. A word both halves declare must be a word both halves MEAN THE SAME BY.
//      Those are listed below: each one is the fleet's kernel/work/sessions
//      declaration of a thing a package now also describes, and merging them
//      is a DELETION of the fleet's copy (T-37574), not a decision. Any word
//      that lands on this list without being on that list is a collision: two
//      ideas wearing one spelling, and one of them has to be renamed before
//      the halves can merge at all (T-37576).
//   3. Perform that deletion here and load the whole thing. The fleet's copy
//      of each shared word drops out, the package's stands, and the union
//      loads — which is exactly what `yak serve` will do.

import { assert, assertEquals } from '@std/assert'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { blobKeywords } from '@yaks/blob'
import { edgeKeywords } from '@yaks/edge'
import { idKeywords } from '@yaks/id'
import { nameKeywords } from '@yaks/names'
import { fleetDocs, fleetKeywords } from './fleet_vocab.ts'

let packagesAt = new URL('../../packages/', import.meta.url)

// Every package vocabulary, read as the plain JSON file it is.
let packageDocs = (): VocabDoc[] => {
  let out: VocabDoc[] = []
  for (let e of Deno.readDirSync(packagesAt)) {
    if (!e.isDirectory) continue
    let at = new URL(`${e.name}/vocab.json`, packagesAt)
    try {
      out.push(JSON.parse(Deno.readTextFileSync(at)))
    } catch {
      continue // a package with no vocabulary of its own
    }
  }
  return out
}

let compsOf = (d: VocabDoc) =>
  Object.entries(d.$defs ?? {})
    .filter(([, s]) => s?.component === true)
    .map(([n]) => n)

let keywords = [
  ...fleetKeywords,
  blobKeywords,
  edgeKeywords,
  idKeywords,
  nameKeywords,
]

// The words both halves declare AND agree about: same idea, different file.
// Each is the fleet's own declaration of something a package now describes too
// — the fleet's copy is what disappears when its manifest becomes a plugin
// vocabulary. This list only ever shrinks.
let SHARED = [
  'alias',
  'archetype',
  'archived',
  'artifact',
  'attachment',
  'blocked',
  'board',
  'call',
  'camera',
  'cancelled',
  'canvas',
  'card',
  'claim',
  'client',
  'completed',
  'conflict',
  'contains',
  'content',
  'created',
  'cursor',
  'deliver',
  'delivered',
  'doc',
  'edge',
  'effect',
  'email',
  'entity',
  'entry',
  'exception',
  'exit',
  'filed',
  'fold',
  'fork',
  'layout',
  'mail',
  'member',
  'memory',
  'model',
  'notified',
  'output',
  'pane',
  'pin',
  'process',
  'project',
  'prompt',
  'provider',
  'requires',
  'result',
  'retired',
  'service',
  'session',
  'shelf',
  'stop',
  'task',
  'updated',
  'usage',
  'wake',
  'worktree',
]

Deno.test('compose: every package vocabulary loads beside every other', () => {
  let docs = packageDocs()
  assert(docs.length >= 20, `only ${docs.length} package vocabularies walked`)
  let v = loadVocab(docs, keywords)
  for (let d of docs) {
    for (let name of compsOf(d)) {
      assert(v.comp(name), `${name} did not load`)
    }
  }
})

Deno.test('compose: a word both halves say is a word both halves agree on', () => {
  let mine = new Set(packageDocs().flatMap(compsOf))
  let shared = fleetDocs().flatMap(compsOf).filter((n) => mine.has(n)).sort()
  // A failure here names a word the fleet and a package spell alike. If they
  // mean the same thing, add it to SHARED; if they do not, rename one of them
  // — there is no third answer, and no alias (M-17871).
  assertEquals(shared, SHARED)
})

Deno.test('compose: fleet + packages are ONE vocabulary once the shared words merge', () => {
  let held = new Set(SHARED)
  // The merge the plugin migration performs: the fleet stops declaring what a
  // package already declares. Done here in memory, the whole union loads.
  let fleet = fleetDocs().map((d) => ({
    ...d,
    $defs: Object.fromEntries(
      Object.entries(d.$defs ?? {}).filter(([n]) => !held.has(n)),
    ),
  }))
  let v = loadVocab([...packageDocs(), ...fleet], keywords)
  // Both halves answer out of the one table: a fleet-only word, a
  // package-only word, and a shared word served by the package's declaration.
  for (
    let name of ['signal', 'tool_use', 'failed', 'tree_entry', 'notice', 'doc']
  ) {
    assert(v.comp(name), `${name} is absent from the composed vocabulary`)
  }
})
