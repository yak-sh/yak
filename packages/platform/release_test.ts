import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { reloadLevel, status } from './mod.ts'
import type { Release, Reload } from './mod.ts'
import type { Files, Version } from './versions.ts'
import type { VocabDoc } from '@yaks/vocab'

let was: Release = {
  files: 'old',
  vocab: {
    $defs: {
      row: { type: 'object', properties: { value: { type: 'string' } } },
      call: { tool: true },
    },
  },
}

test('same files win over required marks, including a restored release', () => {
  assertEquals(reloadLevel(was, was, [{ reload: 'required' }]), undefined)
})
test('cosmetic changes and additions are optional, crossed marks only raise', () => {
  let next = { ...was, files: 'new' }
  assertEquals(reloadLevel(was, next), 'optional')
  assertEquals(
    reloadLevel(was, next, [{}, { reload: 'required' }, {}]),
    'required',
  )
  assertEquals(
    reloadLevel(was, {
      files: 'new',
      vocab: {
        $defs: {
          ...was.vocab.$defs,
          extra: { type: 'object' },
        },
      },
    }),
    'optional',
  )
})
test('dropping tools, components or properties and retyping require reload', () => {
  for (
    let vocab of [
      {},
      { $defs: { row: was.vocab.$defs!.row } },
      { $defs: { ...was.vocab.$defs, row: { type: 'object' } } },
      {
        $defs: {
          ...was.vocab.$defs,
          row: {
            type: 'object',
            properties: {
              value: { type: 'number' },
            },
          },
        },
      },
    ]
  ) assertEquals(reloadLevel(was, { files: 'new', vocab }), 'required')
})

// An app's kept versions as a release check reads them: each version's files,
// and its manifest by the sha its vocab.json names, its reads counted.
let kept = (
  all: { version: number; files: Files; reload?: Reload }[],
  docs: Record<string, VocabDoc> = {},
) => {
  let reads = { versions: 0, vocab: 0 }
  let versions: Version[] = all
    .map((v) => ({ eid: `v${v.version}`, at: '', worker: '', ...v }))
    .sort((a, b) => b.version - a.version)
  return {
    reads,
    versions: () => (reads.versions++, Promise.resolve(versions)),
    vocab: (v: Version) => (
      reads.vocab++, Promise.resolve(docs[v.files['vocab.json']] ?? {})
    ),
  }
}
let note = (type: string) => ({
  $defs: { note: { type: 'object', properties: { text: { type } } } },
})

test('a page on the serving release reads nothing', async () => {
  let k = kept([])
  assertEquals(await status(k, 3, 3), { version: 3 })
  assertEquals(k.reads, { versions: 0, vocab: 0 })
})
test('a version not kept has no status', async () => {
  let k = kept([{ version: 1, files: {} }])
  assertEquals(await status(k, 2, 1), null)
  assertEquals(await status(k, 1, 2), null)
})
test('a release check compares the pair and every mark crossed between', async () => {
  let k = kept([
    { version: 1, files: { 'vocab.json': 'a', 'index.html': '1' } },
    {
      version: 2,
      files: { 'vocab.json': 'a', 'index.html': '2' },
      reload: 'required',
    },
    { version: 3, files: { 'vocab.json': 'a', 'index.html': '3' } },
    { version: 4, files: { 'vocab.json': 'b', 'index.html': '3' } },
    { version: 5, files: { 'index.html': '1', 'vocab.json': 'a' } },
  ], { a: note('string'), b: note('number') })
  assertEquals(await status(k, 1, 2), { version: 2, reload: 'required' })
  // The mark on the page's own release is not crossed.
  assertEquals(await status(k, 2, 3), { version: 3, reload: 'optional' })
  // Nor is it only forward: a rollback over it crosses it too.
  assertEquals(await status(k, 3, 1), { version: 1, reload: 'required' })
  assertEquals(await status(k, 3, 4), { version: 4, reload: 'required' })
  // v1's files again, listed in another order: neither the marks crossed nor
  // the number warns, and no manifest is read.
  let read = k.reads.vocab
  assertEquals(await status(k, 1, 5), { version: 5 })
  assertEquals(k.reads.vocab, read)
})
