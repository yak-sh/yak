// Provider replacement and discovery through the registry and runner interfaces.
import { equal, match, ok, test, throws } from '@yaks/testing'
import { type Bundle, type Comp, graph, mint, type Tool } from '@yaks/graph'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { registry } from './registry.ts'
import { answerSchema, inputSchemaOf } from './schema.ts'
import { answerOf, callDoc, faulted, runner, toolDoc, toolEid } from './mod.ts'
import { reader } from './read.ts'

let sample = (revision = 'one', readOnly = false): Tool => ({
  noun: 'sample',
  verb: 'read',
  description: `Read sample ${revision}`,
  revision,
  readOnly,
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'integer' } },
  },
  run: (call) => [{
    entity: { eid: '$answer' },
    content: { body: revision },
    output: { source: call.entity.eid },
  }],
})

let world = () => {
  let vocab = loadVocab([kernelDoc, callDoc, toolDoc], [kernelKeywords])
  return graph({ vocab, storage: ram(vocab) })
}
let ask = (args = {}): Bundle => ({
  entity: { eid: mint() },
  call: { to: toolEid('sample_read'), args },
})
let words = (answer: Bundle[], call: Bundle) =>
  (answerOf(answer, call.entity.eid)[0].content as { body: string }).body

test('registry discovery preserves names, schemas and provider groups', () => {
  let tool = sample()
  let catalog = registry([{ name: '@examples/samples', tools: [tool] }])
  equal(catalog.get(toolEid('sample_read')), catalog.get('sample_read'))
  let found = ok(catalog.describe('sample_read'))
  match(found, {
    name: 'sample_read',
    provider: '@examples/samples',
    inputSchema: inputSchemaOf(tool),
    outputSchema: answerSchema,
  })
  equal('run' in found, false)
  equal(catalog.providers().map((p) => [p.name, p.tools.map((t) => t.name)]), [
    ['@examples/samples', ['sample_read']],
  ])
  equal(catalog.search('SAMPLE examples').map((t) => t.name), ['sample_read'])
  equal(catalog.search('missing'), [])
  equal(catalog.describe('missing'), undefined)
})

test('tool names cannot shadow recorded tool identities in either registration order', async () => {
  let tool = sample()
  let shadow = {
    ...sample(),
    name: toolEid('sample_read'),
    noun: undefined,
    verb: undefined,
  }
  for (let tools of [[tool, shadow], [shadow, tool]]) {
    await throws(() => registry([{ name: 'samples', tools }]), 'identity')
  }
})

test('provider replacement is atomic on collision and notifies after publication', async () => {
  let catalog = registry([{ name: 'first', tools: [sample()] }])
  let notices: string[][] = []
  let stop = catalog.subscribe(() =>
    notices.push(catalog.list().map((t) => t.name))
  )
  await throws(() => catalog.replace('other', [sample('two')]), 'sample_read')
  equal(catalog.get('sample_read')?.revision, 'one')
  equal(notices, [])
  await throws(
    () => registry([{ name: 'same', tools: [] }, { name: 'same', tools: [] }]),
    'same',
  )
  await throws(
    () => registry([{ name: 'same', tools: [sample(), sample()] }]),
    'sample_read',
  )
  catalog.replace('first', [sample('two')])
  equal(catalog.get('sample_read')?.revision, 'two')
  catalog.replace('first', null)
  equal(catalog.get('sample_read'), undefined)
  equal(notices, [['sample_read'], []])
  stop()
  catalog.replace('first', [sample()])
  equal(notices.length, 2)
})

test('admitted calls retain implementation without restoring an older tool declaration', async () => {
  let g = world()
  let catalog = registry([{ name: 'samples', tools: [sample()] }])
  let run = runner(g, { tools: catalog })
  let pending = ask(), pinned = ok(run.admit(pending))
  catalog.replace('samples', [sample('two')])
  await run.ensure()
  await pinned.ensure()
  await run.ensure()
  equal(
    ((await g.get([toolEid('sample_read')]))[0].tool as Comp)?.revision,
    'two',
  )
  equal(words(await pinned.call(), pending), 'one')
})

let futureGraph = world()
let futureCatalog = registry([{ name: 'samples', tools: [sample()] }])
let futureRunner = runner(futureGraph, { tools: futureCatalog })
await futureRunner.ensure()

test('future calls follow replacements at the existing identity and record ordinary receipts', async () => {
  let g = futureGraph, catalog = futureCatalog, run = futureRunner
  catalog.replace('samples', [sample('two')])
  await run.ensure()
  let next = ask()
  equal(words(await run.call(next), next), 'two')
  equal(
    ((await g.get([toolEid('sample_read')]))[0].tool as Comp)?.revision,
    'two',
  )
  equal(
    ((await g.get([next.entity.eid]))[0].call as Comp)?.to,
    toolEid('sample_read'),
  )
  equal((await g.read(`.result.call=${next.entity.eid}`)).length, 1)
})

test('registration batches cannot finish an older declaration after its replacement', async () => {
  let g = world()
  let catalog = registry([{ name: 'samples', tools: [sample()] }])
  let run = runner(g, { tools: catalog })
  let get = g.get.bind(g)
  let started = Promise.withResolvers<void>()
  let release = Promise.withResolvers<void>()
  let first = true
  g.get = async (ids, comps) => {
    let held = await get(ids, comps)
    if (first && ids.includes(toolEid('sample_read'))) {
      first = false
      started.resolve()
      await release.promise
    }
    return held
  }
  let old = run.ensure()
  await started.promise
  catalog.replace('samples', [sample('two')])
  let next = run.ensure()
  release.resolve()
  await Promise.all([old, next])
  await run.ensure()
  equal(
    ((await g.get([toolEid('sample_read')]))[0].tool as Comp)?.revision,
    'two',
  )
})

test('replacement during registration keeps the admitted implementation', async () => {
  let g = world()
  let catalog = registry([{ name: 'samples', tools: [sample()] }])
  let run = runner(g, { tools: catalog })
  let apply = g.apply.bind(g)
  g.apply = (bundles, opts) => {
    if (
      bundles.some((b) => (b.tool as Comp | undefined)?.name == 'sample_read')
    ) {
      catalog.replace('samples', [sample('two', true)])
    }
    return apply(bundles, opts)
  }
  let call = ask(), admitted = ok(run.admit(call))
  await admitted.ensure()
  equal(words(await admitted.call(), call), 'one')
})

test('shared registry reads keep validation and caller selection without writes', async () => {
  for (let make of [runner, reader]) {
    let g = world()
    g.apply = () => {
      throw new Error('read attempted to write')
    }
    let catalog = registry([{ name: 'samples', tools: [sample('one', true)] }])
    let run = make(g, { tools: catalog, takes: (call) => !call.blocked })
    let call = ask()
    let admitted = ok(run.admit(call))
    catalog.replace('samples', [sample('two', true)])
    equal(words(await admitted.read(), call), 'one')
    equal(words(await run.read(call), call), 'two')
    let bad = ask({ value: 'invalid' })
    equal(faulted(await run.read(bad), bad.entity.eid), true)
    equal(run.admit({ ...ask(), blocked: {} }), undefined)
  }
})
