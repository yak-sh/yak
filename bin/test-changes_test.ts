import { equal, test } from '@yaks/testing'
import { changes, edits } from './test-changes.ts'

let changed = async (branch: string) => {
  let called: string[][] = []
  let run = (args: string[]) => {
    called.push(args)
    return Promise.resolve(
      args[0] == 'branch'
        ? `${branch}\n`
        : args[0] == 'merge-base' || args[0] == 'rev-parse'
        ? 'base-sha\n'
        : args[0] == 'diff'
        ? 'changed.ts\0renamed.ts\0'
        : 'new.ts\0changed.ts\0',
    )
  }
  let files = await changes({ run })
  return { files, called }
}
let branch = await changed('topic')
let main = await changed('main')

test('branch selection includes committed, working and untracked changes once', () => {
  equal(branch.files, ['changed.ts', 'renamed.ts', 'new.ts'])
  equal(branch.called[1], ['merge-base', 'main', 'HEAD'])
  equal(branch.called[2], [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    'base-sha',
  ])
})

test('main selects the latest commit and working changes', () => {
  equal(main.called[1], ['rev-parse', 'HEAD^'])
  equal(main.called[2], [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    'base-sha',
  ])
})

test('a copied checkout uses the supplied base without consulting local refs', async () => {
  let calls: string[][] = []
  let run = (args: string[]) => {
    calls.push(args)
    return Promise.resolve('')
  }
  let comparison = { run, at: 'HEAD' }
  await changes(comparison)
  await edits(comparison)
  equal(calls, [
    ['diff', '--name-only', '--no-renames', '-z', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
    ['diff', '--name-only', '--no-renames', '-z', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ])
})

let before = "import { x } from './x.ts'\nexport let a = () => x\nlet b = 2"
let edited = (after: string, source = before) =>
  edits({
    run: ([arg]) =>
      Promise.resolve(arg == 'diff' ? 'm.ts\0' : arg == 'show' ? source : ''),
    at: 'HEAD',
    read: () => Promise.resolve(after),
  })
let named = async (after: string) =>
  Object.fromEntries(
    Object.entries(await edited(after)).map((
      [path, { names }],
    ) => [path, names]),
  )

test('test selection names the declarations whose runtime code changed', async () => {
  equal(
    await named(
      "import {\n  type A,\n  x,\n} from './x.ts'\n/** docs */\n" +
        'export let a = () => x + 1\nlet b = 2',
    ),
    { 'm.ts': ['a'] },
  )
  equal(await named(before.replace('let b = 2', '')), { 'm.ts': ['b'] })
})

test('an import edit changes what says the names it binds', async () => {
  equal(await named(before.replace('./x.ts', './y.ts')), { 'm.ts': ['a'] })
  equal(await named(before.replace('{ x }', '{ y as x }')), { 'm.ts': ['a'] })
  equal(await named("import { y } from './y.ts'\n" + before), { 'm.ts': [] })
  equal(await named(before + '\nconsole.log(x)'), { 'm.ts': ['*'] })
  equal(
    await named(before.replace('./x.ts', './y.ts') + '\nconsole.log(x)'),
    { 'm.ts': ['*', 'a'] },
  )
})

test('a top-level call or an import for its effect changes the whole module', async () => {
  equal(await named(before + '\na()'), { 'm.ts': ['*'] })
  equal(await named("import './y.ts'\n" + before), { 'm.ts': ['*'] })
})

test('a comment and a type-only edit leave runtime declarations alone', async () => {
  equal(
    await named("import type { T } from './t.ts'\n/** docs */\n" + before),
    { 'm.ts': [] },
  )
})

test('an edit confined to a typed function body preserves its callable type', async () => {
  let typed = 'export let amount = (x: number): number => x'
  equal((await edited(typed + ' + 1', typed))['m.ts'], {
    names: ['amount'],
    bodies: true,
  })
  equal(
    (await edited(typed.replace('(x: number)', '(x: string)'), typed))['m.ts']
      .bodies,
    false,
  )
  equal(
    (await edited(typed + ' as never\nexport type T = string', typed))['m.ts']
      .bodies,
    false,
  )
  equal(
    (await edited(typed + " + (void import('./globals.ts'), 1)", typed))['m.ts']
      .bodies,
    false,
  )
  equal(
    (await edited(before.replace('=> x', '=> x + 1')))['m.ts'].bodies,
    false,
  )
})

test('deployment comments leave the test bindings alone and binding edits reach their consumers', async () => {
  let path = 'workers/yak/wrangler.toml'
  let original =
    '[[ratelimits]]\nname = "SIGNIN_RATE"\nsimple = { limit = 5, period = 60 }'
  let compared = async (text: string) =>
    (await edits({
      paths: [path],
      at: 'HEAD',
      run: () => Promise.resolve(original),
      read: () => Promise.resolve(text),
    }))[path].names
  equal(await compared('# A credential used by a deploy\n' + original), [])
  equal(await compared(original.replace('limit = 5', 'limit = 2')), ['*'])
  equal(await compared('[[ratelimits]'), ['*'])
})
