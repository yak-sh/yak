// Shared test fixtures (not part of the published package — see deno.json): a
// graph carrying this package's vocabulary beside @yaks/edge's and @yaks/key's,
// and a byte store with nothing under it but a Map.
//
// The byte store is a Map rather than @yaks/blob's SQLite backend because a
// tree body is BINARY — raw ids, not text — and that backend holds text. A
// deployment uses the file or object backend for the same reason.

import { Database } from '@yaks/sqlite/db'
import { address, type Blobs, encode } from '@yaks/blob'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { type Graph, graph, type Plugin } from '@yaks/graph'
import { keyDoc, keyKeywords, keys } from '@yaks/key'
import { type Driver, storage } from '@yaks/sqlite'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { gitDoc } from './comp.ts'
import { type Index, index } from './index.ts'

let entity: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}

/** The git vocabulary as a store would load it. */
export let git: Vocab = loadVocab([entity, edgeDoc, keyDoc, gitDoc], [
  edgeKeywords,
  keyKeywords,
])

let mem = (): Driver => {
  let db = new Database(':memory:')
  db.exec('pragma foreign_keys = on')
  return {
    query: (sql, params) => db.prepare(sql).all(...params),
    exec: (sql) => db.exec(sql),
  }
}

/** A byte store over a Map, counting the reads so a test can prove an object
 * already named is never read again. */
export let store = (): Blobs & { reads: () => number } => {
  let bytes = new Map<string, Uint8Array>()
  let reads = 0
  return {
    has: (sha) => bytes.has(sha),
    get: (sha) => {
      reads++
      return bytes.get(sha)
    },
    put: (sha, b) => {
      bytes.set(sha, b)
    },
    reads: () => reads,
  }
}

/**
 * The whole stack: a graph, a byte store, and the index over both.
 *
 * A caller testing the PLUGIN brings the words its own releases are said in,
 * and the plugin that watches for them — a host's two contributions, which is
 * the only thing a fixture cannot guess.
 */
export let fixture = (
  more: { docs?: VocabDoc[]; plugins?: Plugin[] } = {},
): {
  g: Graph
  bytes: ReturnType<typeof store>
  git: Index
} => {
  let vocab = more.docs?.length
    ? loadVocab([entity, edgeDoc, keyDoc, gitDoc, ...more.docs], [
      edgeKeywords,
      keyKeywords,
    ])
    : git
  let db = storage(mem(), vocab)
  db.install()
  let g = graph({
    storage: db,
    vocab,
    plugins: [edges(vocab), keys(vocab), ...more.plugins ?? []],
  })
  let bytes = store()
  return { g, bytes, git: index(g, bytes) }
}

/** A file in the byte store, as a deploy manifest names it: its address. */
export let file = (bytes: Blobs, text: string): string => {
  let sha = address(text)
  bytes.put(sha, encode(text))
  return sha
}

// ---------------------------------------------------------------------------
// What git said.
//
// Every id below was computed once by git itself, in two throwaway
// repositories — one `--object-format=sha1`, one `--object-format=sha256` —
// over the same two files: `hello.txt` holding `hello\n`, and `lib/a.txt`
// holding `x\n`.
//
//   git hash-object -w hello.txt lib/a.txt
//   printf '100644 blob <a.txt>\ta.txt\n' | git mktree               -> LIB
//   printf '100644 blob <hello>\thello.txt\n040000 tree <LIB>\tlib\n'
//     | git mktree                                                   -> ROOT
//   printf '040000 tree <LIB>\ta\n100644 blob <hello>\ta.txt\n'
//     | git mktree                                                   -> SORT
//   GIT_AUTHOR_NAME=yaks GIT_AUTHOR_EMAIL=a6433884@users.yaks.app \
//   GIT_AUTHOR_DATE='1757000000 +0000' GIT_COMMITTER_NAME=yaks.app \
//   GIT_COMMITTER_EMAIL=git@yaks.app GIT_COMMITTER_DATE='1757000000 +0000' \
//     git commit-tree <ROOT> -m 'deploy 1'                           -> ONE
//   …the same at 1757000060, `-p <ONE>`, `-m 'deploy 2'`             -> TWO
//
// If one of these ever fails, the format moved, not the fixture.

/** `hello.txt`, and `lib/a.txt`. */
export let HELLO = 'hello\n'
export let X = 'x\n'

/** The blobs. */
export let HELLO_OID = 'ce013625030ba8dba906f756967f9e9ca394464a'
export let HELLO_OID256 =
  '2cf8d83d9ee29543b34a87727421fdecb7e3f3a183d337639025de576db9ebb4'
export let X_OID = '587be6b4c3f93f93c489c0111bba5596147a26cb'
export let X_OID256 =
  '14f5162e2fe3d240d0d37aaab0f90e4af9a7cfa79639f3bab005b5bfb4174d9f'

/** The tree `lib`, holding `a.txt`. */
export let LIB_OID = '6ca2b082c4982a05d9978c0e48bfbae57de44389'
export let LIB_OID256 =
  '0d9eae87e730c49c87b9b44893200349fb5f3a38fdfc9ff7b414da7d4a0faed4'

/** The root tree, holding `hello.txt` and `lib`. */
export let ROOT_OID = 'ac1c5891ad5273a54f42e865c3db6a45fff0b472'
export let ROOT_OID256 =
  '133367cabc1b9be778cb8ea2c153968ea1b4500d8fc43775ed85861d59310361'

/** A tree holding the directory `a` and the file `a.txt` — the sort rule, in
 * one object: `a.txt` comes FIRST, because `a` sorts as `a/`. */
export let SORT_OID = 'ad94769f8d8ffb761d45605960041a5a43a3fe24'

/** The two commits over the root tree, the second following the first. */
export let ONE_OID = '2b72ae1c151a09616df8389672bace7669a3497d'
export let ONE_OID256 =
  '5c7129e9c0f86495833abf9fa0ebcf9df81943cc60fc153b2e7a68bbdd481932'
export let TWO_OID = 'a8ac25d0b48d7f164c003a207298fef1f357c0de'
export let TWO_OID256 =
  '5411674d3cb34e9f54b3b6941b41e5530a2f080c33bbd44342bbe7144e7a4a97'

/** Who those commits say wrote and recorded them. */
export let AUTHOR = {
  name: 'yaks',
  email: 'a6433884@users.yaks.app',
  at: 1757000000000,
}
export let COMMITTER = {
  name: 'yaks.app',
  email: 'git@yaks.app',
  at: 1757000000000,
}
