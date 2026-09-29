// The runner as a person runs it: a process of its own over a directory of
// test modules and pages, its record of passes kept in the directory.
import { equal, match, ok, test } from './mod.ts'

let MAIN = new URL('./main.ts', import.meta.url).pathname
let TESTING = new URL('./mod.ts', import.meta.url).href

// A directory holding `files` (`@yaks/testing` in them naming this package),
// and runs of the runner over it, from this run's directory (the checkout)
// so its config resolves.
let fixture = async (files: Record<string, string>) => {
  let dir = await Deno.makeTempDir({ prefix: 'yaks-testing-' })
  let write = async (name: string, text: string) => {
    let path = `${dir}/${name}`
    await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
    await Deno.writeTextFile(path, text.replaceAll('@yaks/testing', TESTING))
  }
  for (let [name, text] of Object.entries(files)) await write(name, text)
  let run = async (...args: string[]) => {
    let out = await new Deno.Command(Deno.execPath(), {
      args: ['run', '-A', MAIN, ...args, dir],
      env: { XDG_CACHE_HOME: `${dir}/.cache`, NO_COLOR: '1' },
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    let text = new TextDecoder().decode(out.stdout) +
      new TextDecoder().decode(out.stderr)
    // Each test's name, and how it went.
    let said = Object.fromEntries(
      [...text.matchAll(/^(.+?) \.\.\. (ok|FAILED|ignored) /gm)]
        .map(([, name, how]) => [name.replace(`${dir}/`, ''), how]),
    )
    return { code: out.code, text, said }
  }
  return {
    run,
    write,
    [Symbol.asyncDispose]: () => Deno.remove(dir, { recursive: true }),
  }
}

test('every test runs and says how it went; a module that cannot load fails as one', async () => {
  await using dir = await fixture({
    'a_test.ts': `import { equal, test } from '@yaks/testing'
test('adds', () => equal(1 + 1, 2))
test('fails', () => equal(1 + 1, 3))
test('later', () => {}, { skip: true })`,
    'b_test.ts': `import './missing.ts'`,
    'c_test.ts': `import { suite } from '@yaks/testing'
suite('sum', ({ it, ok }) => it('holds', () => ok(true)))`,
  })
  let { code, said, text } = await dir.run()
  equal(code, 1)
  equal(said, {
    'adds': 'ok',
    'fails': 'FAILED',
    'later': 'ignored',
    'b_test.ts loads': 'FAILED',
    'sum › holds': 'ok',
  })
  match(text, /2 passed \| 2 failed \| 1 ignored/)
})

test('the examples beside the code run: fences, and a module’s doctests', async () => {
  await using dir = await fixture({
    'README.md': "# m\n\n```ts\nimport { twice } from './m.ts'\n" +
      "if (twice(2) != 4) throw new Error('no')\n```\n\n" +
      '```ts ignore\nnever()\n```\n',
    'm.ts': [
      '/**',
      ' * ```ts',
      ' * if (twice(1) != 2) throw new Error("unimported")',
      ' * ```',
      ' */',
      'export let twice = (n: number) => n * 2',
      '/// let n = 3',
      '/// twice(n) -> 6',
      '/// ({ a: twice(1), b: 0 }) ~> { a: 2 }',
      '/// twice(1)',
      '///   -> 3',
      "/// JSON.parse('{') throws 'JSON'",
      '// / later() -> 1',
    ].join('\n'),
  })
  let { said } = await dir.run()
  equal(said, {
    'README.md:3': 'ok',
    'm.ts:2': 'ok',
    'm.ts:8 twice(n) -> 6': 'ok',
    'm.ts:9 ({ a: twice(1), b: 0 }) ~> { a: 2 }': 'ok',
    'm.ts:10 twice(1)': 'FAILED',
    "m.ts:12 JSON.parse('{') throws 'JSON'": 'ok',
    'm.ts:13 later() -> 1': 'ignored',
  })
})

test('a file that passed is left out until what it depends on changes', async () => {
  await using dir = await fixture({
    'a_test.ts': `import { test } from '@yaks/testing'
import { one } from './one.ts'
test('a', () => one)`,
    'b_test.ts': `import { test } from '@yaks/testing'
let data = new URL('./data.json', import.meta.url)
test('b', () => Deno.readTextFile(data))`,
    'one.ts': 'export let one = 1',
    'data.json': '{}',
  })
  equal(Object.keys((await dir.run()).said), ['a', 'b'])
  let again = await dir.run()
  equal(again.said, {})
  match(again.text, /2 unchanged since they passed/)
  await dir.write('one.ts', 'export let one = 2')
  equal(Object.keys((await dir.run()).said), ['a'])
  await dir.write('data.json', '[]')
  equal(Object.keys((await dir.run()).said), ['b'])
  equal(Object.keys((await dir.run('--all')).said), ['a', 'b'])
})

test('tags pick tests, and a test that never ends fails alone', async () => {
  await using dir = await fixture({
    'a_test.ts': `import { test } from '@yaks/testing'
test('hangs', () => new Promise(() => {}), { tags: ['slow'] })
test('after', () => {}, { tags: ['slow'] })
test('untagged', () => {})`,
  })
  let { code, said, text } = await dir.run('--tag=slow', '--timeout=50')
  equal(code, 1)
  equal(said, { hangs: 'FAILED', after: 'ok' })
  ok(text.includes('did not end within 50ms'))
  // A run that picked by tag ran only some, so nothing is recorded.
  equal(Object.keys((await dir.run('--timeout=50')).said).length, 3)
})
