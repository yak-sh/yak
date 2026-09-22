// The transition, held to the files. The fleet server is being dismantled: its
// components move into `@yaks/*` packages designed for the use-case, and
// `docs/transition.md` says, one row per fleet component, which package
// component its rows become — or why nothing takes them. That table is the
// spec for the one-time export/import (D-37573, C#9faadb22f2); this test is
// what keeps it true while both halves still exist.
//
// It proves two things and nothing else: the packages compose (one vocabulary,
// no word declared twice), and the table covers (every manifest component
// accounted for, every package component it names real). It asserts no parity:
// where the package's shape is better, the table's note says what changed.

import { assert, assertEquals } from '@std/assert'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { kernelKeywords } from '@yaks/kernel'
import { blobKeywords } from '@yaks/blob'
import { edgeKeywords } from '@yaks/edge'
import { idKeywords } from '@yaks/id'
import { keyKeywords } from '@yaks/key'
import { nameKeywords } from '@yaks/names'

let root = new URL('../', import.meta.url)
let packagesAt = new URL('packages/', root)

let compsOf = (d: VocabDoc) =>
  Object.entries(d.$defs ?? {})
    .filter(([, s]) => s?.component === true)
    .map(([n]) => n)

// Every package vocabulary, read as the plain JSON file it is.
let packages = (): Map<string, VocabDoc> => {
  let out = new Map<string, VocabDoc>()
  for (let e of Deno.readDirSync(packagesAt)) {
    if (!e.isDirectory) continue
    try {
      out.set(
        e.name,
        JSON.parse(
          Deno.readTextFileSync(new URL(`${e.name}/vocab.json`, packagesAt)),
        ),
      )
    } catch {
      continue
    } // a package with no vocabulary of its own
  }
  return out
}

// Every component the fleet server still declares, as its checklist.
let manifestComps = (): string[] => {
  let out: string[] = []
  for (let e of Deno.readDirSync(new URL('src/vocab/manifests/', root))) {
    let m = JSON.parse(
      Deno.readTextFileSync(new URL(`src/vocab/manifests/${e.name}`, root)),
    ) as { comps: Record<string, unknown> }
    out.push(...Object.keys(m.comps))
  }
  return out.sort()
}

type Row = { comp: string; pkg: string; says: string; note: string }

// The table itself: the rows under the `| fleet comp |` header of the doc.
let table = (): Row[] =>
  Deno.readTextFileSync(new URL('docs/transition.md', root))
    .split('\n')
    .filter((l) => /^\| `/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()))
    .map(([comp, , pkg, says, note]) => ({
      comp: comp.replaceAll('`', ''),
      pkg: pkg.replace('@yaks/', ''),
      says: says.replaceAll('`', ''),
      note: note ?? '',
    }))

Deno.test('transition: every package vocabulary loads beside every other', () => {
  let docs = [...packages().values()]
  assert(docs.length >= 30, `only ${docs.length} package vocabularies walked`)
  let v = loadVocab(docs, [
    kernelKeywords,
    blobKeywords,
    edgeKeywords,
    idKeywords,
    keyKeywords,
    nameKeywords,
  ])
  // No filter, no held-back list: a word declared twice makes loadVocab throw,
  // and that is the invariant — the fleet's duplicate spellings are resolved in
  // the table, not hidden here.
  for (let d of docs) {
    for (let name of compsOf(d)) assert(v.comp(name), `${name} did not load`)
  }
})

Deno.test('transition: the table accounts for every fleet component', () => {
  assertEquals(table().map((r) => r.comp).sort(), manifestComps())
})

Deno.test('transition: a row names a package component that exists', () => {
  let docs = packages()
  for (let r of table()) {
    if (r.pkg == '—') {
      // Nothing takes these rows. A drop owes a reason, in the note.
      assert(r.note, `${r.comp} is dropped with no reason given`)
      continue
    }
    let doc = docs.get(r.pkg)
    assert(doc, `${r.comp}: no packages/${r.pkg}/vocab.json`)
    assert(
      compsOf(doc).includes(r.says),
      `${r.comp}: @yaks/${r.pkg} does not declare ${r.says}`,
    )
  }
})
