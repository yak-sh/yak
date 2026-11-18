import { equal, test } from '@yaks/testing'
import { diagnostic, position, unavailable } from './check-imports.ts'
import type { Info } from './tsconfig.ts'
import 'typescript'

let base = 'file:///repo/'
let info = (edges: Record<string, string[]>): Info => ({
  redirects: { alias: 'file:///repo/typed.ts' },
  npmPackages: {},
  modules: Object.entries(edges).map(([file, deps]) => ({
    specifier: new URL(file, base).href,
    dependencies: deps.map((dep) => ({
      specifier: dep,
      code: { specifier: dep.includes(':') ? dep : new URL(dep, base).href },
    })),
  })),
})
let absent = (s: string) => s.startsWith('node:')

test('host imports name the source and shortest chain through shared cyclic dependencies', () => {
  let graph = info({
    'entry.ts': ['long.ts', 'shared.ts'],
    'long.ts': ['shared.ts'],
    'shared.ts': ['entry.ts', 'node:fs', 'node:os'],
    'other.ts': ['node:crypto'],
  })
  equal(
    unavailable(graph, ['entry.ts'], absent, base),
    ['node:fs', 'node:os'].map((specifier) => ({
      file: `${base}shared.ts`,
      specifier,
      chain: [`${base}entry.ts`, `${base}shared.ts`, specifier],
    })),
  )
})

test('host imports inspect both code and type targets, with redirects and aliases', () => {
  let graph = info({ 'entry.ts': [], 'typed.ts': [] })
  graph.modules[0].dependencies = [{
    specifier: './typed.ts',
    code: { specifier: `${base}typed.ts` },
    type: { specifier: 'alias' },
  }]
  graph.modules[1].dependencies = [{
    specifier: 'filesystem',
    type: { specifier: 'node:fs' },
  }]
  equal(unavailable(graph, ['entry.ts'], absent, base), [{
    file: `${base}typed.ts`,
    specifier: 'filesystem',
    chain: [`${base}entry.ts`, `${base}typed.ts`, 'node:fs'],
  }])
  equal(unavailable(graph, ['entry.ts'], () => false, base), [])
})

test('unresolved host imports still fail at the importing source', () => {
  let graph = info({ 'entry.ts': [] })
  graph.modules[0].dependencies = [{ specifier: 'node:missing' }]
  equal(
    unavailable(graph, ['entry.ts'], absent, base)[0].specifier,
    'node:missing',
  )
})

test('Workers follow deployed modules while browsers check the complete type program', () => {
  let graph = info({
    'entry.ts': ['host.ts', 'node:timers'],
    'host.ts': ['node:fs'],
  })
  let dep = graph.modules[0].dependencies![0]
  dep.type = dep.code
  delete dep.code
  equal(
    unavailable(graph, ['entry.ts'], absent, base).map((m) => m.specifier),
    ['node:timers', 'node:fs'],
  )
  equal(
    unavailable(graph, ['entry.ts'], absent, base, new Set(), true).map((m) =>
      m.specifier
    ),
    ['node:timers'],
  )
  // A direct type-only Node import in a deployed module still fails.
  graph.modules[0].dependencies!.push({
    specifier: 'node:os',
    type: { specifier: 'node:os' },
  })
  equal(
    unavailable(graph, ['entry.ts'], absent, base, new Set(), true).map((m) =>
      m.specifier
    ),
    ['node:timers', 'node:os'],
  )
  // Another Worker's supported APIs never change this one's capabilities.
  equal(
    unavailable(
      graph,
      ['entry.ts'],
      (s) => absent(s) && s != 'node:timers',
      base,
      new Set(),
      true,
    ).map((m) => m.specifier),
    ['node:os'],
  )
})

test('host-only subtrees are omitted only at an explicitly deferred boundary', () => {
  let graph = info({
    'entry.ts': ['host.ts', 'live.ts'],
    'host.ts': ['node:fs'],
    'live.ts': ['node:os'],
  })
  graph.modules[0].dependencies![0].isDynamic = true
  let boundary = new Set([`${base}host.ts`])
  equal(
    unavailable(graph, ['entry.ts'], absent, base, boundary).map((m) =>
      m.specifier
    ),
    ['node:os'],
  )
  delete graph.modules[0].dependencies![0].isDynamic
  equal(
    unavailable(graph, ['entry.ts'], absent, base, boundary).map((m) =>
      m.specifier
    ),
    ['node:fs', 'node:os'],
  )
})

test('host diagnostics locate every import form in current source, ignoring comments and values', async () => {
  for (
    let line of [
      "import 'node:fs'",
      "import { readFile } from 'node:fs'",
      "import type { Stats } from 'node:fs'",
      "export { readFile } from 'node:fs'",
      "export type { Stats } from 'node:fs'",
      "await import('node:fs')",
      'await import(`node:fs`)',
      "type Stats = import('node:fs').Stats",
      "import fs = require('node:fs')",
    ]
  ) {
    let source = "// import 'node:fs'\nlet value = 'node:fs'\n" + line
    equal(await position(source, 'node:fs'), `3,${line.indexOf('node:fs') + 1}`)
  }
  equal(
    await position(
      "let view = <section>hello</section>\nawait import('node:fs')",
      'node:fs',
      'view.tsx',
    ),
    '2,15',
  )
  let found = unavailable(
    info({ 'entry.ts': ['dep.ts'], 'dep.ts': ['node:fs'] }),
    ['entry.ts'],
    absent,
    base,
  )[0]
  equal(
    await diagnostic(found, 'browser', () => "\nimport 'node:fs'", base),
    "dep.ts(2,9): error TS2307: browser cannot import 'node:fs'.\n  entry.ts -> dep.ts -> node:fs",
  )
})
