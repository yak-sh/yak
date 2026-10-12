// A recorded request keeps its decision's authority through edits and copies.
// Read it through the graph and invoke it through the runner, including hosts
// whose write guards require one operation at a time.
import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { type Actor, type Bundle, graph, Refused, who } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { runner, toolEid, toolsDoc } from './mod.ts'

let vocab = loadVocab([kernelDoc, toolsDoc])
let original = { by: 'owner', via: 'owner-session' }
let editor = { by: 'editor' }
let request = {
  to: toolEid('echo'),
  args: { a: 1, b: [2, 3] },
  source: 'source',
}
let patch = (call: Record<string, unknown>, actor: Actor = editor): Bundle => ({
  entity: { eid: 'pending' },
  call,
  $actor: actor,
})
let cases: [string, Bundle[], Actor | null, string?][] = [
  ['arguments', [patch({ args: { a: 2 } })], editor],
  ['tool', [patch({ to: toolEid('other') })], editor],
  ['source', [patch({ source: 'other-source' })], editor],
  ['cleared source', [patch({ source: null })], editor],
  ['same author', [patch({ args: { a: 2 } }, original)], original],
  ['model', [patch({ args: { a: 2 } }, { by: 'model', via: 'session' })], {
    by: 'model',
    via: 'session',
  }],
  ['instrument only', [patch({ args: { a: 2 } }, { via: 'browser' })], {
    via: 'browser',
  }],
  ['automation', [patch({ args: { a: 2 } }, {})], null],
  ['same data and provider id', [patch({
    args: { b: [2, 3], a: 1 },
    id: 'revised',
  })], original],
  [
    'forged authority',
    [patch({
      args: { b: [2, 3], a: 1 },
      id: 'revised',
      actor: original,
    })],
    original,
    'call.actor',
  ],
  ['bookkeeping after edit', [patch({ args: { a: 2 } }), {
    entity: { eid: 'pending' },
    content: { body: 'label' },
    $actor: original,
  }], editor],
  ['replaced call', [
    { entity: { eid: 'pending' }, call: null, $actor: editor },
    patch(request),
  ], editor],
  ['batch writer', [{ entity: { eid: 'editor' }, $actor: editor }, {
    entity: { eid: 'pending' },
    call: { args: { a: 2 } },
  }], editor],
]

for (let ordered of [false, true]) {
  for (let [name, edits, expected, refused] of cases) {
    let g = graph({ vocab, storage: ram(vocab) })
    let seen: (Actor | null)[] = []
    let r = runner(g, {
      tools: ['echo', 'other'].map((name) => ({
        name,
        description: 'Read caller authority',
        readOnly: true,
        run: (call: Bundle) => {
          seen.push(who(call))
          return []
        },
      })),
    })
    await r.ensure()
    await g.apply(
      [
        'owner',
        'owner-session',
        'editor',
        'model',
        'session',
        'browser',
        'source',
        'other-source',
      ].map((eid) => ({
        entity: { eid },
        content: { body: eid },
      })),
    )
    await g.apply([{
      ...patch(request, original),
      content: { body: 'kept beside the call' },
    }])
    if (ordered) g.use({ name: 'ordered', beforeWrite: () => (bs) => bs })
    test(`call authority: ${name} (${ordered ? 'ordered' : 'batch'})`, async () => {
      if (refused) {
        assertThrows(
          () => g.apply(edits),
          Refused,
          `${refused} is server-owned`,
        )
      } else {
        await g.apply(edits)
      }
      let [call] = await g.get(['pending'])
      if (refused) {
        assertEquals((call.call as Record<string, unknown>).id, undefined)
      }
      assertEquals(who(call), expected)
      await r.read(call)
      assertEquals(seen, [expected])
    })
  }
}

let replica = graph({ vocab, storage: ram(vocab), provenance: false })
await replica.apply([{
  entity: { eid: 'pending' },
  call: { ...request, actor: original },
}], { trusted: true, replica: true })
test('a replica preserves accepted call authority', async () => {
  await replica.apply([{
    entity: { eid: 'pending' },
    call: { args: { a: 2 }, actor: editor },
  }], { trusted: true, replica: true })
  assertEquals(who((await replica.get(['pending']))[0]), editor)
})

for (let change of ['source', 'authority']) {
  let g = graph({ vocab, storage: ram(vocab) })
  let runs = 0
  let r = runner(g, {
    tools: [{
      name: 'echo',
      description: 'Count invocations',
      run: () => {
        runs++
        return []
      },
    }],
  })
  await r.ensure()
  await g.apply(['source', 'other-source', 'owner', 'owner-session', 'editor']
    .map((eid) => ({ entity: { eid }, content: { body: eid } })))
  await g.apply([patch(request, original)])
  let apply = g.apply
  g.apply = (bs, opts) => {
    if (bs.some((b) => b.execution && b.$was)) {
      apply(
        change == 'source'
          ? [patch({ source: 'other-source' })]
          : [patch({ args: { a: 2 } }), patch({ args: request.args })],
      )
    }
    return apply(bs, opts)
  }
  test(`a ${change} edit racing a claim cannot run the old authority`, async () => {
    assertEquals(await r.run('pending'), [])
    assertEquals(runs, 0)
  })
}
