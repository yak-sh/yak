import { equal, test } from './mod.ts'
import { discover, find } from './find.ts'

let dir = Deno.makeTempDirSync({ prefix: 'yaks-find-' })
let files = {
  'module.ts': [
    '/**',
    ' * ```tsx',
    ' * await import("./fence.tsx")',
    ' * ```',
    ' * ```ts ignore',
    ' * await import("./ignored.ts")',
    ' * ```',
    ' */',
    '/// await import("./line.ts")',
    '// / await import("./skipped.ts")',
  ].join('\n'),
  'skipped.ts': '// / skipped()',
  'guide.md': '```ts\nawait import("./guide.ts")\n```',
  'ignored.md': '```ts ignore\nignored()\n```',
  'data.md': '```json\n{}\n```',
  'plain.ts': 'export let value = 1',
  'unit_test.ts': '/// a test module is not an example page',
}
for (let [file, source] of Object.entries(files)) {
  Deno.writeTextFileSync(`${dir}/${file}`, source)
}
let found = await discover([dir])
let names = await find([dir])

test('discovery retains the same runnable pages and shares their parsed examples', () => {
  equal(names, { tests: found.tests, pages: found.pages })
  equal(found.tests, [`${dir}/unit_test.ts`])
  equal(
    found.pages,
    ['guide.md', 'module.ts', 'skipped.ts'].map((p) => `${dir}/${p}`),
  )
  equal([...found.parsed!.keys()], found.pages)
  equal(found.parsed!.get(`${dir}/module.ts`), {
    fenced: [{
      line: 2,
      skip: false,
      lang: 'tsx',
      code: 'await import("./fence.tsx")',
    }],
    lines: [
      {
        line: 9,
        skip: false,
        code: 'await import("./line.ts")',
        op: undefined,
      },
      {
        line: 10,
        skip: true,
        code: 'await import("./skipped.ts")',
        op: undefined,
      },
    ],
  })
})

test('a page keeps what it was scanned for until its status changes, and a store keeps pages a run did not walk', async () => {
  let store = `${dir}/.pages.json`
  let page = `${dir}/guide.md`
  let s = Deno.statSync(page)
  let status = [s.ino, s.size, s.mtime!.getTime(), s.ctime!.getTime()]
  let kept = { fenced: [], lines: [{ line: 1, skip: false, code: 'kept()' }] }
  Deno.writeTextFileSync(
    store,
    JSON.stringify({
      [page]: [...status, kept],
      'elsewhere/a.ts': [0, 0, 0, 0, 0],
    }),
  )
  equal((await discover([dir], store)).parsed!.get(page), kept)
  let held = JSON.parse(Deno.readTextFileSync(store))
  equal([held[page][4], held['elsewhere/a.ts']], [kept, [0, 0, 0, 0, 0]])
  Deno.writeTextFileSync(page, '```ts\nchanged()\n```')
  equal(
    (await discover([dir], store)).parsed!.get(page)!.fenced[0].code,
    'changed()',
  )
})
