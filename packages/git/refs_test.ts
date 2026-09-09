// The branch, and the step that moves it: a manifest landed as a commit, the
// ref patched onto it, the caller's own row written in the same batch — and
// the same step reached through the plugin, where a release row is what wakes
// it. Constants: ./harness.ts.

import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { CORE_URI, type VocabDoc } from '@yaks/vocab'
import { commits } from './plugin.ts'
import { commitOnto, refAt, refEid, type Repo } from './refs.ts'
import { MAIN } from './http.ts'
import { AUTHOR, COMMITTER, file, fixture, HELLO, X } from './harness.ts'

let APP = 'a0000000-0000-4000-8000-00000000000a'

let comp = (b: Bundle, name: string): Comp => (b[name] ?? {}) as Comp

// A host's own two words: what a release is, and what it says once committed —
// the pair @yaks/git deliberately does not spell (`deploy` and `commit{target}`
// on yaks.app).
let hostDoc: VocabDoc = {
  $vocabulary: { [CORE_URI]: true },
  title: 'host',
  $defs: {
    release: { type: 'object', properties: { files: { type: 'string' } } },
    made: {
      type: 'object',
      properties: {
        release: { type: 'string', ref: 'entity', death: 'cascade' },
      },
    },
  },
}

let landing = (repo: Repo, files: Record<string, string>, message: string) => ({
  repo,
  app: APP,
  files,
  author: AUTHOR,
  committer: COMMITTER,
  message,
})

Deno.test('a manifest lands as a commit and the branch follows it', async () => {
  let { g, bytes } = fixture()
  let repo: Repo = { refs: g, objects: g, bytes }

  let one = await commitOnto(
    repo,
    landing(repo, { 'a.txt': file(bytes, HELLO) }, 'one\n'),
  )
  assertEquals(await refAt(g, APP), one.oid)

  // The parent is read from the REF, never carried: the second landing knows
  // nothing of the first.
  let two = await commitOnto(
    repo,
    landing(repo, { 'a.txt': file(bytes, X) }, 'two\n'),
  )
  assertEquals(await refAt(g, APP), two.oid)
  let follows = await g.read(`.parent!&.edge.from=${two.oid}`)
  assertEquals(follows.map((e) => String(comp(e, 'edge').to)), [one.oid])

  // One row per branch, patched — not a second row nobody notices is stale.
  let [row] = await g.read(`.eid=${refEid(APP, MAIN)}`)
  assertEquals(comp(row, 'ref').name, MAIN)
})

Deno.test('what the caller says about a commit rides the same batch', async () => {
  let { g, bytes } = fixture({ docs: [hostDoc] })
  let repo: Repo = { refs: g, objects: g, bytes }
  let release = 'b0000000-0000-4000-8000-00000000000b'

  let made = await commitOnto(repo, {
    ...landing(repo, { 'a.txt': file(bytes, HELLO) }, 'one\n'),
    beside: (oids) => [{ entity: { eid: oids.oid }, made: { release } }],
  })
  let [row] = await g.read(`.made.release=${release}`)
  assertEquals(row.entity.eid, made.oid)
})

Deno.test('the plugin commits a release, and commits it once', async () => {
  let seen: Bundle[] = []
  let g!: ReturnType<typeof fixture>['g']
  let bytes!: ReturnType<typeof fixture>['bytes']
  let plugin = commits({
    comp: 'release',
    of: async (b) => {
      seen.push(b)
      // Already committed? The host's own question, asked its own way.
      if ((await g.read(`.made.release=${b.entity.eid}`)).length) return null
      return {
        ...landing({ refs: g, objects: g, bytes }, {
          'a.txt': file(bytes, HELLO),
        }, 'one\n'),
        beside: (oids) => [
          { entity: { eid: oids.oid }, made: { release: b.entity.eid } },
        ],
      }
    },
  })
  let made = fixture({ docs: [hostDoc], plugins: [plugin] })
  g = made.g
  bytes = made.bytes

  let release = 'b0000000-0000-4000-8000-00000000000b'
  await g.apply([{ entity: { eid: release }, release: { files: '{}' } }])
  let head = await refAt(g, APP)
  assert(head, 'the branch stands at a commit')
  assertEquals((await g.read('.made!')).map((r) => r.entity.eid), [head])

  // A second touch of the same release makes no second commit: the plugin
  // asked, and the host said there was nothing to commit.
  await g.apply([{ entity: { eid: release }, release: { files: '{}' } }])
  assertEquals(await refAt(g, APP), head)
  assertEquals((await g.read('.made!')).length, 1)
  assert(seen.length > 1, 'the second write reached the plugin')
})
