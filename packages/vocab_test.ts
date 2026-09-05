// One check over the packages as a SET: every vocabulary this repo publishes is
// a FILE — `packages/<name>/vocab.json`, plain JSON Schema — and each package's
// `comp.ts` only re-exports it under the name callers already say. That
// re-export is what a compiler checks; nothing there proves the file still
// stands on its own, readable by a reader that has no TypeScript. This does:
// each file is read as text, parsed as plain JSON, and loaded through
// `loadVocab` with the keyword vocabularies its own `$vocabulary` names.
//
// The one thing a document may need from outside itself is a KIND it sorts
// against: `before` may only name a kind the load declares, so @yaks/mail's
// `mail` — which sorts before @yaks/doc's `doc` — is loaded beside the file
// that declares that word. Which file that is, is looked up in the walked set,
// never listed here.

import { assert, assertEquals } from '@std/assert'
import { blobKeywords } from '@yaks/blob'
import { edgeKeywords } from '@yaks/edge'
import { idKeywords } from '@yaks/id'
import { syncKeywords } from '@yaks/sync'
import {
  CORE_URI,
  type Keywords,
  loadVocab,
  storable,
  type VocabDoc,
} from '@yaks/vocab'

let here = new URL('./', import.meta.url)

// The walk: packages/*/vocab.json, as text → JSON. A document that needed a
// compiler to become an object fails on this line.
let files: [string, VocabDoc][] = []
for (let e of Deno.readDirSync(here)) {
  if (!e.isDirectory) continue
  let at = new URL(`${e.name}/vocab.json`, here)
  let text: string
  try {
    text = Deno.readTextFileSync(at)
  } catch {
    continue
  }
  files.push([e.name, JSON.parse(text)])
}

// The keyword vocabularies a file may name, by the URI it names them with.
let words: Record<string, Keywords> = Object.fromEntries(
  [blobKeywords, edgeKeywords, idKeywords, syncKeywords].map((k) => [k.uri, k]),
)

let compsOf = (d: VocabDoc) => Object.keys(d.$defs ?? {})

let beforeOf = (d: VocabDoc) =>
  Object.values(d.$defs ?? {}).flatMap((s) => s.before ?? [])

// Which file declares a given word — the whole set, so a companion is resolved
// rather than named.
let home = new Map<string, VocabDoc>()
for (let [, d] of files) for (let n of compsOf(d)) home.set(n, d)

Deno.test('packages: every vocab.json is plain JSON that loads', () => {
  assert(files.length >= 10, `only ${files.length} vocab.json files walked`)
  for (let [pkg, doc] of files) {
    assertEquals(storable(doc), [], `${pkg}/vocab.json is not storable`)
    let mine = new Set(compsOf(doc))
    assert(mine.size > 0, `${pkg}/vocab.json declares no components`)
    let beside = [...new Set(beforeOf(doc))]
      .filter((k) => !mine.has(k))
      .map((k) => {
        let d = home.get(k)
        assert(d, `${pkg}/vocab.json sorts before '${k}', which no package has`)
        return d
      })
    // A `$vocabulary` URI is now spelled in the file rather than imported as a
    // constant, so a typo would silently un-register a keyword: every URI a
    // file names is one the repo knows.
    let named = Object.keys(doc.$vocabulary ?? {}).map((uri) => {
      assert(
        uri == CORE_URI || words[uri],
        `${pkg}/vocab.json names $vocabulary '${uri}', which no package owns`,
      )
      return words[uri]
    }).filter(Boolean)
    let vocab = loadVocab([...beside, doc], named)
    for (let name of mine) {
      assert(vocab.comp(name), `${pkg}/vocab.json: ${name} did not load`)
    }
  }
})
