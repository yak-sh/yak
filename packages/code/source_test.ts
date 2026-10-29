// Commit-pinned resolution over catalog records through the in-process query door.

import { machineDoc } from '@yaks/machine/vocab'
import { equal, ok, test } from '@yaks/testing'
import { graph, identityEid, mint } from '@yaks/graph'
import { fileOf } from '@yaks/file'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { docDoc } from '@yaks/doc/vocab'
import { edgeDoc, edgeKeywords } from '@yaks/edge'
import { gitDoc } from '@yaks/git'
import { fileDoc } from '@yaks/file/vocab'
import { codeDoc } from './vocab.ts'
import { ask } from '@yaks/api'
import { resolveFrames } from './frames.ts'
import {
  catalogAt,
  catalogRepository,
  remembered,
  sourcePath,
} from './source.ts'

let sources = {
  roots: ['/srv/app', '/srv/tree'],
  origins: ['https://box.test'],
}
test('source paths require a known root or origin and reject traversal', () => {
  equal(sourcePath('file:///srv/tree/a%20b.ts?token=x', sources), 'a b.ts')
  equal(
    sourcePath('https://box.test/packages/a.ts?token=x', sources),
    'packages/a.ts',
  )
  for (
    let file of [
      'file:///etc/passwd',
      'file:///srv/apple/a.ts',
      'file://host/srv/app/a.ts',
      'file:///srv/app/../app/a.ts',
      'https://box.test/%2e%2e/a.ts',
      'https://box.test/%ZZ',
      'https://evil.test/a.ts',
      'data:text/plain,secret',
      'https://user:secret@box.test/a.ts',
      'file:///srv/app/a%00.ts',
    ]
  ) equal(sourcePath(file, sources), undefined)
})

test('a remembered catalog retries failures and shares fresh answers', async () => {
  let asked = 0
  let down = true
  let catalog = remembered({
    get: (ids) =>
      ++asked && down
        ? Promise.reject(Error('catalog down'))
        : Promise.resolve(ids.map((eid) => ({ entity: { eid } }))),
  })
  await catalog.get(['f']).then(() => ok(false), () => ok(true))
  down = false
  equal((await catalog.get(['f'])).length, 1)
  equal((await catalog.get(['f'])).length, 1)
  equal(asked, 2)
  let expiredCalls = 0
  let expired = remembered({
    get: () => {
      expiredCalls++
      return Promise.resolve([])
    },
  }, 0)
  await expired.get(['g'])
  await expired.get(['g'])
  equal(expiredCalls, 2)
})

let vocab = loadVocab([
  machineDoc,
  kernelDoc,
  docDoc,
  edgeDoc,
  fileDoc,
  gitDoc,
  codeDoc,
], [kernelKeywords, edgeKeywords])
let g = graph({ vocab, storage: ram(vocab) })
let repository = mint(), module = fileOf(repository, 'a.ts')
let symbol = identityEid('symbol', [module, 'fail'])
await g.apply([
  { entity: { eid: repository }, repository: { common: '/repo/.git' } },
  {
    entity: { eid: module },
    file: { root: repository, path: 'a.ts' },
    module: { blob: 'old' },
  },
  {
    entity: { eid: symbol },
    symbol: { module, name: 'fail', kind: 'function', line: 1 },
  },
])
let catalog = catalogAt(
  'http://catalog.test',
  (url, init) => ask(g, new Request(url, init)),
)
let places = [
  { path: 'vendor/dep.ts', function: 'fail' },
  { path: 'a.ts', function: 'fail' },
  { path: 'a.ts', function: 'hidden' },
  { path: 'a.ts', function: 'Object.fail' },
  { path: 'a.ts', function: 'fail', line: -1 },
  { path: 'web/app.js', function: 'fail' },
]
let blobs = new Map([['a.ts', 'old'], ['vendor/dep.ts', 'vendor']])
let first = await resolveFrames(catalog, repository, blobs, places)

test('frames resolve only cataloged exports whose blobs match the failing commit', () => {
  equal(first, [
    { app: false },
    { app: true, module, symbol },
    { app: true, module },
    { app: true, module },
    { app: true, module },
    { app: false },
  ])
})

let changed = await resolveFrames(
  catalog,
  repository,
  new Map([['a.ts', 'new']]),
  places,
)
test('a blob mismatch prevents module and symbol attribution', () => {
  equal(changed[1], { app: true })
})
let missing = await resolveFrames(
  { get: () => Promise.resolve([]) },
  repository,
  blobs,
  places,
)
test('an unavailable catalog preserves application classification', () => {
  equal(missing[1], { app: true })
})

// A catalog in cutover may retain old observations beside qualified ones.
let lookup = (rows: unknown, status = 200) =>
  catalogRepository(
    'http://catalog.test',
    '/repo/.git',
    (_url, _init) =>
      Promise.resolve(new Response(JSON.stringify(rows), { status })),
  )
test('catalog attribution ignores unplaced history and requires one filesystem', async () => {
  equal(
    await lookup([{
      entity: { eid: 'old' },
      repository: { common: '/repo/.git' },
    }]),
    undefined,
  )
  equal(
    await lookup([
      { entity: { eid: 'old' }, repository: { common: '/repo/.git' } },
      {
        entity: { eid: 'new' },
        repository: { common: '/repo/.git', workspace: 'one' },
      },
    ]),
    'new',
  )
  equal(
    await lookup([
      {
        entity: { eid: 'one' },
        repository: { common: '/repo/.git', workspace: 'one' },
      },
      {
        entity: { eid: 'two' },
        repository: { common: '/repo/.git', workspace: 'two' },
      },
    ]),
    undefined,
  )
})
test('unavailable catalog cannot recursively fail error ingestion', async () => {
  equal(await lookup([], 500), undefined)
  equal(
    await catalogRepository(
      'http://catalog.test',
      '/repo/.git',
      () => Promise.reject(Error('offline')),
    ),
    undefined,
  )
})

// Many immutable spool records can carry the same frames. Their optional
// enrichment shares one serving-graph request, then refreshes context later.
let repositoryAsked: string[] = []
let repositoryClock = 0
let repositoryAnswer = Promise.withResolvers<Response>()
let repositoryLookup = (await import('./source.ts')).repositoryCatalog(
  'http://catalog.test',
  ((url: string | URL | Request) => {
    repositoryAsked.push(String(url))
    return repositoryAnswer.promise
  }) as typeof fetch,
  () => repositoryClock,
)
let repositoryBurst = Promise.all(
  Array.from({ length: 100 }, () => repositoryLookup('/repo/.git')),
)
repositoryAnswer.resolve(
  Response.json([{
    entity: { eid: 'qualified' },
    repository: { common: '/repo/.git', workspace: 'one' },
  }]),
)
let repositoryBurstAnswer = await repositoryBurst
let repositoryLater = await repositoryLookup('/repo/.git')
test('a burst of error frames shares a narrow repository attribution lookup', () => {
  equal(repositoryBurstAnswer, Array(100).fill('qualified'))
  equal(repositoryLater, 'qualified')
  equal(repositoryAsked.length, 1)
  let query = new URL(repositoryAsked[0]).searchParams.get('q')!
  equal(query.includes('.repository.common='), true)
})
let refreshCalls = 0, refreshTime = 0
let refreshLookup = (await import('./source.ts')).repositoryCatalog(
  'http://catalog.test',
  (() => {
    refreshCalls++
    return Promise.resolve(Response.json([]))
  }) as typeof fetch,
  () => refreshTime,
)
await refreshLookup('/missing')
await refreshLookup('/missing')
refreshTime = 60_000
await refreshLookup('/missing')
test('unknown repository placement is bounded but not remembered forever', () =>
  equal(refreshCalls, 2))
