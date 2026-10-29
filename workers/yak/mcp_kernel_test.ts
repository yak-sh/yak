// The hosted connector uses package arguments and preserves published reads.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { connector, kernel, meta, seed, signIn, unique } from './probe.ts'
import { toolEid } from '@yaks/tools'

test('the hosted connector writes and lists an app file', async () => {
  let k = await kernel()
  let space = `mcp${crypto.randomUUID().slice(0, 8)}`
  let { cookie } = await seed(k, [{ slug: space, apps: ['notes'] }])
  let agent = connector(k, cookie)
  let at = { space, app: 'notes' }
  await agent.tool('app_files', {
    ...at,
    files: [{ path: 'index.html', content: '<h1>Notes</h1>' }],
  })
  assertStringIncludes(
    await agent.tool('app_files', { ...at, op: 'list' }),
    'index.html',
  )
})

// A connector call validates arguments before the package runs as the caller.
test('hosted memory calls use package arguments and preserve published reads', async () => {
  let k = await kernel()
  let space = unique('memory')
  let them = await seed(k, [{ slug: space, apps: [] }])
  let agent = connector(k, them.cookie)
  // The package's own arguments answer bundles, and an edit made through
  // that interface is still what the published recall reads.
  type Memory = {
    entity: { eid: string }
    doc: { title: string; body: string }
    $was: { doc: { body: string } }
  }
  let exact = 'use a scale for every ingredient'
  let saved = await agent.call('tools/call', {
    name: 'store_memory_save',
    arguments: { space, said: exact, title: 'weigh ingredients' },
  })
  assertEquals(saved.isError, undefined)
  let [made] = saved.structuredContent.result as Memory[]
  assert(made.entity.eid)
  assertEquals(made.doc, { title: 'weigh ingredients', body: exact })
  let recalled = await agent.call('tools/call', {
    name: 'store_memory_recall',
    arguments: { space, said: 'scale' },
  })
  assertEquals(recalled.isError, undefined)
  let [memory] = recalled.structuredContent.result as Memory[]
  assertEquals(memory.entity.eid, made.entity.eid)
  assertEquals(memory.doc.body, exact)

  // The directory records the call and its caller; its source points back
  // to the distinct connector invocation rather than to itself.
  let calls = await meta(k).query(
    `.call.to=${toolEid('memory_save')}&.created.by=${them.person}&?created`,
  ) as unknown as {
    entity: { eid: string }
    call: { args: { said: string }; source: string | { eid: string } }
    created: { by: { eid: string; name: string } }
  }[]
  let invocation = calls.find((c) => c.call.args.said == exact)!
  assert(invocation)
  assertEquals(invocation.created.by, { eid: them.person, name: them.name })
  let source = typeof invocation.call.source == 'string'
    ? invocation.call.source
    : invocation.call.source.eid
  assert(source)
  assert(source != invocation.entity.eid)

  let changed = 'use a scale and weigh every ingredient'
  await agent.tool('store_memory_save', {
    space,
    id: memory.entity.eid,
    said: changed,
    was: memory.$was.doc.body,
  })
  assertStringIncludes(
    await agent.tool('memory_recall', { space, words: 'weigh' }),
    `"${changed}"`,
  )
  let ana = connector(k, (await signIn(k)).cookie)
  let excluded = await assertRejects(
    () => ana.tool('store_memory_recall', { space, said: 'scale' }),
    Error,
  )
  assertStringIncludes(excluded.message, `not a member of ${space}`)
})
