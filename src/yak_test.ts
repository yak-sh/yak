// The owner plugin's verbs at their pure seam: what one refuses before it
// touches an account or the network. The rest of a verb is the wire
// (yaks_api_test.ts) and the account rule (yaks_account_test.ts); what is left
// here is the argv a person actually types, and that the rule survived the
// move onto the `yak` plugin seam.
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Ctx } from '@yaks/cli'
import { known, owner, verbs } from './yak.ts'
import { envOf, Refused } from './yaks_account.ts'
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
} from './yak_deploys.ts'

let verb = (name: string) => verbs.find((v) => v.name == name)!

let ctx = (args: string[]): Ctx => ({
  host: 'yaks.test',
  word: '',
  args,
  json: false,
  help: false,
  ask: () => Promise.resolve({}),
  reads: { file: () => '', stdin: () => '' },
  out: () => {},
  note: () => {},
  plugins: [owner],
})

let ran = (name: string, args: string[]) =>
  Promise.resolve(verb(name).run(ctx(args)))

// The fee is the PLATFORM's (workers/yak/sell.ts `fees`), so reading it or
// moving it is a named act — never something a default or a throwaway arrives
// at. Both refusals land before any account is read, so a typo costs nothing.
Deno.test('the fee verb refuses a rate nobody named as the owner', async () => {
  await assertRejects(() => ran('fee', ['250']), Refused, '--owner')
  await assertRejects(() => ran('fee', []), Refused)
})

Deno.test('the fee verb refuses anything but whole basis points', async () => {
  for (let no of ['2.5', '-5', 'lots', '2,50']) {
    await assertRejects(
      () => ran('fee', [no, '--owner']),
      Error,
      'basis points',
    )
  }
})

// Signing in AS somebody is the same named act, and it is refused before a
// letter goes anywhere.
Deno.test('login refuses a non-test address that nobody named as the owner', async () => {
  await assertRejects(
    () => ran('login', ['you@example.com']),
    Refused,
    '--owner',
  )
})

// The plugin sits first, so these two words mean what this box means by them
// — and the bearer half of each is still reachable, by what it is handed.
Deno.test('the account verbs are the ones this box adds', () => {
  let names = verbs.map((v) => v.name)
  for (let want of ['test', 'whoami', 'accounts', 'login', 'use', 'logout']) {
    assert(names.includes(want), `${want} is missing from ${names.join(' ')}`)
  }
  for (let want of ['link', 'delete', 'fee', 'query', 'tool']) {
    assert(names.includes(want), `${want} is missing from ${names.join(' ')}`)
  }
})

Deno.test('operations require the named owner before reading credentials or running commands', async () => {
  for (let name of ['deploys', 'errors', 'tail', 'rollback', 'revert']) {
    assert(verb(name))
    await assertRejects(() => ran(name, []), Refused, '--owner')
    await assertRejects(() => ran(name, ['--owner=false']), Refused, '--owner')
    await assertRejects(() => ran(name, ['--owner', '--unknown']), Error)
  }
  await assertRejects(() => ran('revert', ['--owner', 'HEAD']), Error, '<sha>')
  await assertRejects(
    () => ran('errors', ['--owner', '--since']),
    Error,
    '--since',
  )
})

// The address nobody wrote down is asked of the platform ONCE and kept
// (T-35376). What the file becomes is yaks_account.ts `recorded`; what is
// here is the asking: a temp `.env` and a fake platform, so no box's own file
// moves.
let legacy = { address: '', session: 'legacy.token', name: 'owner' }
let filed = async (answer: (session: string) => Promise<string>) => {
  let path = Deno.makeTempFileSync()
  Deno.writeTextFileSync(path, 'YAKS_SESSION=legacy.token\n')
  Deno.env.set('YAKS_ENV', path)
  try {
    let at = await known(legacy, answer)
    return { at, env: envOf(Deno.readTextFileSync(path)) }
  } finally {
    Deno.env.delete('YAKS_ENV')
    Deno.removeSync(path)
  }
}

Deno.test('an account with no address asks the platform once, and the answer is kept', async () => {
  let asked: string[] = []
  let { at, env } = await filed((s) => {
    asked.push(s)
    return Promise.resolve('jeff@yak.sh')
  })
  assertEquals(asked, ['legacy.token'])
  assertEquals([at.address, at.name], ['jeff@yak.sh', 'jeff'])
  assertEquals(env.YAKS_ADDRESS_JEFF_YAK_SH, 'jeff@yak.sh')
  assertEquals(env.YAKS_SESSION, undefined)
  // An address already written down asks nobody.
  let mine = { ...legacy, address: 'x@bot.yak.sh' }
  assertEquals(await known(mine, () => Promise.reject('asked anyway')), mine)
  // And a platform that cannot say leaves the account as it was and writes
  // nothing — however it failed to say it.
  for (let no of [() => Promise.resolve(''), () => Promise.reject('down')]) {
    assertEquals(await known(legacy, no), legacy)
  }
})

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

Deno.test('every current data pass is visible to deploy history as a boundary', async () => {
  let source = await Deno.readTextFile(
    new URL('../workers/yak/migrate.ts', import.meta.url),
  )
  let declared = marksIn(source)
  assertEquals(declared, [
    'yak/store/packages/1',
    'yak/store/home/2',
    'yak/store/former/3',
    'yak/store/serves/4',
    'yak/store/handle/5',
  ])
  assertEquals(
    declared,
    marksIn(source.replace(/^export let BOUNDARIES = .*$/m, '')),
  )
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
