// The deploy history's pure seams: how Wrangler's JSON joins uploads to
// commits, where a data boundary is, and which version a rollback may land on.
import { assert, assertEquals, assertThrows } from '@std/assert'
import { Refused } from './accounts.ts'
import {
  boundaries,
  type Commit,
  commitsIn,
  type Deploy,
  type Deployment,
  deploysIn,
  marksIn,
  rollbackTarget,
  rowsIn,
  table,
  type Version,
} from './deploys.ts'

let at = (n: number) => new Date(n * 1000).toISOString()
let commit = (n: number): Commit => ({
  sha: String(n).repeat(40),
  at: at(n),
  subject: `change ${n}`,
})
let version = (n: number, message?: string): Version => ({
  id: `v${n}`,
  metadata: { created_on: at(n + 0.5) },
  annotations: message ? { 'workers/message': message } : {},
})
let deployment = (n: number, ...ids: string[]): Deployment => ({
  id: `d${n}`,
  created_on: at(n),
  versions: ids.map((id) => ({ version_id: id, percentage: 100 / ids.length })),
})
let deploy = (
  n: number,
  marks: string[],
  over: Partial<Deploy> = {},
): Deploy => ({
  id: `v${n}`,
  created: at(n),
  first: at(n),
  last: at(n),
  commit: commit(n),
  estimated: false,
  marks,
  live: 0,
  boundary: [],
  ...over,
})

Deno.test('Wrangler JSON joins uploads to named commits and the latest traffic deployment', () => {
  let versions = rowsIn<Version>(
    JSON.parse(JSON.stringify([
      version(1, `${commit(1).sha} change 1`),
      version(2),
      version(3, 'abcdef12 commit absent locally'),
    ])),
    'versions',
  )
  let history = rowsIn<Deployment>({
    result: { deployments: [deployment(8, 'v1', 'v2'), deployment(4, 'v1')] },
  }, 'deployments')
  let log = commitsIn(
    [commit(2), commit(1)].map((c) => `${c.sha}\t${c.at}\t${c.subject}`).join(
      '\n',
    ),
  )
  let rows = deploysIn(versions, history, log)
  assertEquals(
    rows.map((r) => [r.id, r.commit?.sha, r.estimated, r.first, r.live]),
    [
      ['v3', 'abcdef12', false, undefined, 0],
      ['v2', commit(2).sha, true, at(8), 50],
      ['v1', commit(1).sha, false, at(4), 50],
    ],
  )
  assertEquals(rows[2].last, at(8))
  assertEquals(rowsIn({ result: { items: versions } }, 'versions'), versions)
  assertThrows(() => rowsIn({ success: false }, 'versions'), Error, 'JSON')
  let shown = table(rows)
  assert(shown.includes('22222222~'))
  assert(shown.includes('(never deployed)'))
  assert(shown.includes('50%'))
})

Deno.test('migration markers are read from MARKS declarations, including the first pass', () => {
  let source = `
    export let MARK = 'yak/store/packages/1'
    export const HANDLED = 'yak/store/handle/5'
    export let UNUSED = 'yak/store/unused/6'
    // export let MARKS = [UNUSED]
    export let MARKS = [MARK, HANDLED,]
  `
  assertEquals(marksIn(source), ['yak/store/packages/1', 'yak/store/handle/5'])
  assertEquals(marksIn("export let MARK = 'yak/store/packages/1'"), [
    'yak/store/packages/1',
  ])
  assertEquals(
    marksIn(source.replace('MARK, HANDLED,', 'MARK, MISSING,')),
    null,
  )
  assertEquals(marksIn('export let MARKS = generated()'), null)
})

Deno.test('explicit rollback boundaries exclude status markers and fail closed', () => {
  let source = `
    export let MARK = 'yak/store/packages/1'
    export let REFUSED = 'yak/store/refused/6'
    export let MARKS = [MARK, REFUSED]
    export let BOUNDARIES = [MARK]
  `
  assertEquals(marksIn(source), ['yak/store/packages/1'])
  assertEquals(
    marksIn(source.replace('BOUNDARIES = [MARK]', 'BOUNDARIES = []')),
    [],
  )
  for (
    let expression of [
      'generated()',
      '[MISSING]',
      '[MARK].concat([REFUSED])',
      '[...MARKS]',
    ]
  ) {
    assertEquals(
      marksIn(
        source.replace('BOUNDARIES = [MARK]', `BOUNDARIES = ${expression}`),
      ),
      null,
    )
  }
  assertEquals(
    marksIn(source.replace('MARKS = [MARK, REFUSED]', 'MARKS = generated()')),
    ['yak/store/packages/1'],
  )
  assertEquals(marksIn(source.replace('export let BOUNDARIES = [MARK]', '')), [
    'yak/store/packages/1',
    'yak/store/refused/6',
  ])
})

// A rollback is refused wherever the history cannot be read, so the file as it
// stands has to parse.
Deno.test('the migrations as they stand are a history deploys can read', async () => {
  let source = await Deno.readTextFile(
    new URL('../../workers/yak/migrate.ts', import.meta.url),
  )
  assert(marksIn(source)?.length, 'migrate.ts declares no readable history')
})

Deno.test('a gradual deploy can roll back to its prior version while that version still serves traffic', () => {
  let rows = deploysIn(
    [version(1, commit(1).sha), version(2, commit(2).sha)],
    [deployment(3, 'v1'), deployment(4, 'v1', 'v2')],
    [commit(1), commit(2)],
  ).map((r) => ({ ...r, marks: ['one'] }))
  assertEquals(rollbackTarget(boundaries(rows)).id, 'v1')
  rows = rows.map((r) => ({ ...r, prior: 50 }))
  assertThrows(
    () => rollbackTarget(boundaries(rows)),
    Refused,
    'name one version explicitly',
  )
})

Deno.test('boundaries survive rollback and unserved uploads do not move data', () => {
  let rows = boundaries([
    deploy(4, ['one', 'two', 'three'], { first: undefined, last: undefined }),
    deploy(3, ['one', 'two']),
    deploy(2, ['one'], { live: 100, last: at(5) }),
    deploy(1, ['one']),
  ])
  assertEquals(rows.map((r) => r.boundary), [[], ['two'], [], ['one']])
  assertEquals(rows[3].refusal, 'no rollback: data moved (two)')
  assertEquals(rows[2].refusal, 'no rollback: data moved (two)')
  assertEquals(rows[1].refusal, undefined)
  assertEquals(rows[0].refusal, 'no rollback: version never deployed')
  assert(table(rows).includes('── data boundary: two'))
  assert(
    table(rows).includes('one (at or before the first retained deployment)'),
  )
  assertEquals(rollbackTarget(rows).id, 'v3')
  assertThrows(() => rollbackTarget(rows, 'v1'), Refused, 'data moved')
  assertThrows(() => rollbackTarget(rows, 'v'), Refused, 'names 4')
})

Deno.test('later code that drops a served marker remains unsafe despite a newer upload time', () => {
  let rows = boundaries([
    deploy(4, ['one'], { live: 100 }),
    deploy(3, ['one', 'two']),
    deploy(2, ['one', 'two']),
    deploy(1, ['one']),
  ])
  assertEquals(rows[0].refusal, 'no rollback: data moved (two)')
  assertEquals(rows[1].boundary, [])
  assertEquals(rows[2].boundary, ['two'])
  assertEquals(rows[2].refusal, undefined)
})

Deno.test('rollback fails closed for unknown migration sources or time-inferred commits', () => {
  for (let over of [{ marks: null }, { estimated: true }]) {
    let rows = boundaries([deploy(2, ['one'], over), deploy(1, ['one'])])
    assert(rows.every((r) => r.refusal?.startsWith('no rollback:')))
    assertThrows(() => rollbackTarget(rows, 'v1'), Refused)
  }
  assertEquals(boundaries([deploy(1, [])])[0].refusal, undefined)
  assertEquals(rollbackTarget(boundaries([deploy(1, [])]), 'v1').id, 'v1')
})

Deno.test('main history keeps a data boundary after Wrangler ages its deployment out', () => {
  let rows = [deploy(9, ['one'], { live: 100 }), deploy(8, ['one'])]
  let guarded = boundaries(rows, ['one', 'two'])
  assertEquals(guarded.map((r) => r.refusal), [
    'no rollback: data moved (two)',
    'no rollback: data moved (two)',
  ])
  assertThrows(() => rollbackTarget(guarded), Refused, 'data moved')
  assert(boundaries(rows, null).every((r) => r.refusal?.includes('unknown')))
})
