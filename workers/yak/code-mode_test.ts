import { clock, equal, match, ok, test, throws } from '@yaks/testing'
import { connector, fresh, meta, seed } from './probe.ts'
import { evaluate } from '../../packages/code-mode/testing.ts'
import { catalog, declarations, execute, LIMITS } from '@yaks/code-mode'
import { source } from '@yaks/code-mode/source'
import { strip } from '@yaks/esbuild/strip'
import { compiler } from './testing.ts'
import { COOKIE, sign } from './lib/token.ts'
import { type as typeOf } from '../../packages/code-mode/types.ts'
import {
  argsOf,
  type Bundle,
  type Comp,
  graph,
  mint,
  type Tool,
  who,
} from '@yaks/graph'
import { registry, runner, toolEid, toolsDoc } from '@yaks/tools'
import { spineDoc } from '@yaks/kernel/vocab'
import { provenanceDoc } from '@yaks/provenance/vocab'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'

let fixture = (tools: Tool[]) => {
  let vocab = loadVocab([spineDoc, provenanceDoc, toolsDoc])
  let g = graph({ vocab, storage: ram(vocab) })
  let catalog = registry([{ name: 'yaks', tools }])
  let run = runner(g, { tools: catalog })
  let actor = { by: mint(), via: mint() }
  let asked: Bundle = {
    entity: { eid: mint() },
    call: { to: toolEid('code_mode') },
    $actor: actor,
  }
  return { g, catalog, run, asked, actor }
}
let echoed: Bundle[] = []
let echo: Tool = {
  name: 'echo',
  description: 'Echo typed input',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  run: (call) => {
    echoed.push(call)
    return [{
      entity: { eid: mint() },
      content: { body: String(argsOf(call).text) },
    }]
  },
}
let one = fixture([echo])
test('code mode compiles TS, preserves identity, records calls and validates each input', async () => {
  let out = await execute(
    'let text: string = "typed"; return await tools.yaks.echo({text})',
    one.catalog,
    one.run,
    one.asked,
    evaluate,
    strip,
  )
  equal(out.error, undefined)
  match(out.value, {
    structuredContent: { result: [{ content: { body: 'typed' } }] },
  })
  equal(who(echoed[0]), one.actor)
  equal((echoed[0].call as Comp).source, one.asked.entity.eid)
  equal((await one.g.read('.call')).length, 1)
  let bad = await execute(
    'return await tools.yaks.echo({text: 1})',
    one.catalog,
    one.run,
    one.asked,
    evaluate,
    strip,
  )
  match(bad.value, { isError: true })
  equal(echoed.length, 1)
})

let two = fixture([echo])
test('code mode caps calls, arguments, script and combined output', async () => {
  let many = await execute(
    'for(let i=0;i<17;i++) await tools.yaks.echo({text:"x"})',
    two.catalog,
    two.run,
    two.asked,
    evaluate,
    strip,
  )
  equal(many.calls.length, 16)
  ok(many.error?.includes('16 tool calls'))
  let huge = await execute(
    'return tools.yaks.echo({text:"x".repeat(70000)})',
    two.catalog,
    two.run,
    two.asked,
    evaluate,
    strip,
  )
  equal(huge.calls.length, 0)
  ok(huge.error?.includes('64 KiB'))
  await throws(
    () =>
      execute(
        ' '.repeat(70000),
        two.catalog,
        two.run,
        two.asked,
        evaluate,
        strip,
      ),
    '64 KiB',
  )
  let large = await execute(
    'for(let i=0;i<4;i++) await tools.yaks.echo({text:"x".repeat(60000)}); return "x".repeat(240000)',
    two.catalog,
    two.run,
    two.asked,
    evaluate,
    strip,
  )
  ok(
    new TextEncoder().encode(JSON.stringify(large)).length <=
      LIMITS.outputBytes,
  )
  ok(large.calls.some((c) => c.error))
})

let three = fixture([echo])
test('deadline revokes bridge; completed scripts cannot leave new calls behind', async () => {
  let time = clock()
  let bridge: Parameters<typeof evaluate>[1] | undefined
  let started = Promise.withResolvers<void>()
  let out = execute(
    '',
    three.catalog,
    three.run,
    three.asked,
    async (_, b) => {
      bridge = b
      started.resolve()
      return await new Promise(() => {})
    },
    strip,
    time,
  )
  await started.promise
  await time.advance(LIMITS.wallMs)
  ok((await out).error?.includes('30 seconds'))
  await throws(
    () => bridge!.call('yaks', 'echo', JSON.stringify({ text: 'late' })),
    'ended',
  )
  equal((await three.g.read('.call')).length, 0)
})

test('declarations preserve exact paths and resolve nested unions without recursive expansion', async () => {
  let names = catalog(one.catalog)
  ok(declarations(names).includes('"echo": (args: { "text": string }'))
  ok(
    (await source('return tools.yaks.echo({text:"x"})', names, 1000, strip))[
      'script.js'
    ].includes('Object.create(null)'),
  )
  equal(
    typeOf({
      $defs: { node: { anyOf: [{ type: 'null' }, { $ref: '#/$defs/node' }] } },
      $ref: '#/$defs/node',
    }),
    '(null | unknown)',
  )
})

let k = await fresh({ CODE_MODE: evaluate, ESBUILD: compiler() })
let agent = connector(k, k.owner.cookie)
let graphPerson = await seed(k, [{ slug: 'code-mode-person', apps: [] }])
let graphAgent = connector(k, graphPerson.cookie)
test('nested calls discover new app vocabulary and data without naming a store', async () => {
  let script = `
    await tools.yaks.app_new({space:'code-mode-person',slug: 'code-graph', title: 'Code graph'});
    await tools.yaks.app_files({space:'code-mode-person',app: 'code-graph', files: [{path: 'vocab.json', content: JSON.stringify({$defs:{code_note:{component:true,type:'object',properties:{body:{type:'string'}}}}})}]});
    await tools.yaks.app_deploy({space:'code-mode-person',app: 'code-graph'});
    await tools.yaks.graph_apply({bundles:[{entity:{eid:'$note'},code_note:{body:'new graph'}}]});
    let rows = await tools.yaks.graph_query({q:'.code_note'});
    return {rows, schema:await tools.yaks.graph_schema({component:'code_note'})};
  `
  let out = (await graphAgent.call('tools/call', {
    name: 'code_mode',
    arguments: { script },
  })).structuredContent
  equal(out.error, undefined)
  equal(
    out.calls.filter((c: { result?: { isError?: boolean } }) =>
      c.result?.isError
    ).map((c: { result: { content: unknown } }) => c.result.content),
    [],
  )
  match(out.value.rows, {
    structuredContent: { result: [{ code_note: { body: 'new graph' } }] },
  })
  ok(JSON.stringify(out.value.schema).includes('code_note'))
})
test('code mode requires sign-in and nested calls retain the credential scope', async () => {
  let anon = connector(k, undefined, undefined, '/mcp?auth=mixed')
  await throws(
    () =>
      anon.call('tools/call', {
        name: 'code_mode',
        arguments: { script: 'return 1' },
      }),
    '401',
  )
  let cookie = `${COOKIE}=${await sign({
    person: k.owner.person,
    space: (await meta(k).query('.space'))[0].entity.eid,
    exp: Math.floor(Date.now() / 1000) + 60,
  }, k.secret)}`
  let narrowed = connector(k, cookie)
  let out = await narrowed.call('tools/call', {
    name: 'code_mode',
    arguments: {
      script:
        'return await tools.yaks.app_new({space:"foreign-space",slug:"escape",title:"Escape"})',
    },
  })
  equal(out.structuredContent.calls.length, 1)
  equal(out.structuredContent.value.isError, true)
})
test('one connector call creates, writes and deploys a mockup through the shared tools', async () => {
  let discovered = await agent.call('tools/call', {
    name: 'code_mode',
    arguments: { search: 'app_new' },
  })
  ok(discovered.structuredContent.declarations.includes('"app_new"'))
  let result = await agent.call('tools/call', {
    name: 'code_mode',
    arguments: {
      script: `
    await tools.yaks.app_new({slug: 'code-proof', title: 'Code proof', access: 'public'});
    await tools.yaks.app_files({app: 'code-proof', files: [{path: 'index.html', content: '<!doctype html><h1>Published in one call</h1>'}]});
    return await tools.yaks.app_deploy({app: 'code-proof'});
  `,
    },
  })
  let out = result.structuredContent
  equal(out.error, undefined)
  equal(out.calls.length, 3)
  equal(
    out.calls.map((c: { result: { isError?: boolean } }) => c.result.isError),
    [undefined, undefined, undefined],
  )
  let page = await k.at(k.owner.name + '.' + k.host, '/code-proof/')
  equal(page.status, 200)
  ok((await page.text()).includes('Published in one call'))
  await k.stop()
})
