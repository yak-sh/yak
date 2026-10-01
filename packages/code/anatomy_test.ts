import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import {
  anatomy,
  anatomyData,
  anatomyDocuments,
  anatomyId,
  anatomyPlugin,
  type AnatomySource,
} from './anatomy.ts'

test('anatomy is a descriptor-safe allowlist with all seventeen groups', () => {
  let reads = 0
  let getter = {
    enumerable: true,
    get: () => {
      reads++
      throw Error('vault read')
    },
  }
  let schemas = { type: 'string', default: 'authored', run: () => {} }
  Object.defineProperty(schemas, 'secret', getter)
  let part = {
    name: 'book',
    package: 'shop',
    schema: schemas,
    extends: false,
    props: [{ name: 'title', schema: schemas, refs: [], value: 'graph row' }],
    refs: [],
    before: [],
    rules: {},
    options: { token: 'config value' },
    host: { vault: 'vault value' },
  }
  Object.defineProperty(part, 'loaded', getter)
  let comps = [part]
  Object.defineProperty(comps, '1', getter)
  let source = {
    host: 'native',
    scope: 'native',
    comps,
    secrets: [{
      name: 'api-key',
      description: 'secret value',
      value: 'secret value',
    }],
  }
  Object.defineProperty(source, 'tools', getter)
  let got = anatomy(source as AnatomySource)
  assertEquals(reads, 0)
  assertEquals(got.comps[0].schema, { type: 'string', default: 'authored' })
  assertEquals(got.comps[0].props, [{
    name: 'title',
    schema: { type: 'string', default: 'authored' },
    refs: [],
  }])
  assertEquals(got.secrets[0].name, 'api-key')
  let printed = JSON.stringify(got)
  for (
    let forbidden of [
      'graph row',
      'config value',
      'vault value',
      'secret value',
    ]
  ) {
    assert(!printed.includes(forbidden))
  }
  assertEquals(
    Object.keys(got).filter((k) => Array.isArray(got[k as keyof typeof got]))
      .length,
    18,
  )
  assertEquals(got.observed?.skills, false)
  assertEquals(anatomyData({ fn: () => {}, date: new Date(), okay: true }), {
    okay: true,
  })
})

test('anatomy IDs and edges preserve owner, extension and registration identity', () => {
  let docs = anatomyDocuments([
    {
      title: 'base',
      package: 'base',
      $defs: {
        book: {
          component: true,
          type: 'object',
          properties: { owner: { ref: 'person' } },
          before: ['person'],
        },
        person: { component: true, type: 'object', properties: {} },
        book_list: {
          tool: true,
          input: {},
          outputSchema: { type: 'array' },
          readOnly: true,
        },
        seen: { effect: true, created: ['book'] },
      },
    },
    {
      title: 'extra',
      package: 'extra',
      $defs: {
        book: {
          component: true,
          extends: true,
          type: 'object',
          properties: { label: { type: 'string' } },
        },
      },
    },
  ])
  let source: AnatomySource = {
    host: 'one',
    scope: 'native',
    ...docs,
    packages: [{ name: 'base', configured: true }, {
      name: 'extra',
      configured: true,
    }],
    roles: [{ name: 'graph', facets: ['vocab', 'tools'], loaded: true }],
    facets: [{
      name: 'vocab',
      package: 'base',
      selected: true,
      attempted: true,
    }, { name: 'tools', package: 'base', selected: true, attempted: false }],
  }
  let before = anatomy(source)
  assertEquals(before.tools[0].loaded, false)
  assertEquals(before.effects[0].loaded, false)
  assertEquals(
    before.comps.filter((c) => c.name == 'book').map((c) => c.package),
    ['base', 'extra'],
  )
  let extension = before.comps.find((c) => c.extends)!
  let base = before.comps.find((c) => c.name == 'book' && !c.extends)!
  assert(
    before.edges.some((e) =>
      e.from == extension.id && e.to == base.id && e.kind == 'extends'
    ),
  )
  assert(before.edges.some((e) => e.from == base.id && e.kind == 'ref:owner'))
  assert(before.edges.some((e) => e.from == base.id && e.kind == 'before'))
  source.tools![0].loaded = source.tools![0].bound = true
  source.tools!.push({ ...source.tools![0] })
  let after = anatomy(source)
  assertEquals(after.tools.length, 1)
  assertEquals(after.tools[0].id, before.tools[0].id)
  assert(
    after.edges.some((e) => e.to == after.tools[0].id && e.kind == 'binds'),
  )
  assertEquals(anatomyId('tools', 'a:b', 'c'), 'tools:a%3Ab:c:')
})

test('composition projections do not run hooks, resources or literal code patches', () => {
  let ran = 0
  let never = () => {
    ran++
    throw Error('must not execute')
  }
  let projected = anatomyPlugin('actual-owner', {
    name: 'plugin',
    hooks: { commit: never },
    resources: { env: never },
    requests: ['$new'],
    rules: [{
      phase: 'rules',
      match: '.book',
      produce: { secret: { value: 'row value' } },
      run: never,
    }, { name: 'compiled', match: { pattern: 'AST value' }, run: never }],
    declared: [{
      rule: {
        name: 'authored',
        match: '.person',
        before: ['last'],
        optimistic: true,
      },
      pattern: 'compiled value',
    }],
    beforeWrite: never,
    tools: { hidden: { run: never } },
  })
  let got = anatomy({ host: 'native', scope: 'native', ...projected })
  assertEquals(ran, 0)
  assertEquals(got.rules[0].package, 'actual-owner')
  assertEquals(got.rules[0].resources, ['env'])
  assertEquals(got.rules[0].capabilities, ['beforeWrite'])
  assertEquals(got.hooks[0].name, 'plugin:commit')
  assertEquals(got.rules[1].match, '.book')
  assertEquals(got.rules[2].match, undefined)
  let printed = JSON.stringify(got)
  for (
    let forbidden of ['row value', 'AST value', 'compiled value', 'hidden']
  ) assert(!printed.includes(forbidden))
})
