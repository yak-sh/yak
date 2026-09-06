/// <reference lib="deno.ns" />
// The seed's own reading (seed.ts): which files are one, the order they are
// read in, the entry a bad file names, and the entry a refused batch is blamed
// on. The end-to-end proof — a deploy seeding a store and a redeploy seeding
// nothing — is mcp_test.ts.
import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { type Applying, asked, load, loaded, seedy, sow, sown } from './seed.ts'

let file = (path: string, bundles: unknown[]) => ({
  path,
  text: JSON.stringify(bundles),
})

let one = (alias: string, title: string) => ({
  entity: { eid: alias },
  doc: { title },
})

// Every batch the door was handed, and what it said about each.
let door = (no: (b: Bundle[]) => string | null = () => null) => {
  let asked: { batch: Bundle[]; check: boolean }[] = []
  let apply: Applying = (batch, check) => {
    asked.push({ batch, check })
    return Promise.resolve(no(batch))
  }
  return { asked, apply }
}

Deno.test('a seed file is seed.json, or a *.json under seed/', () => {
  for (
    let path of ['seed.json', 'seed/01.json', 'seed/deep/more.json']
  ) assert(seedy(path), path)
  for (
    let path of [
      'index.html',
      'vocab.json',
      'tools.json',
      'seeds.json',
      'seed/notes.md',
      'data/seed.json',
    ]
  ) assertEquals(seedy(path), false, path)
})

Deno.test('the bundles are read in filename order, the file and folder as one', () => {
  let all = sown([
    { path: 'index.html', text: '<h1>hi</h1>' },
    file('seed/02-menu.json', [one('$soup', 'Soup')]),
    file('seed.json', [one('$a', 'A'), one('$b', 'B')]),
    file('seed/01-places.json', [one('$here', 'Here')]),
  ])
  assertEquals(all.map((s) => [s.file, s.index]), [
    ['seed.json', 0],
    ['seed.json', 1],
    ['seed/01-places.json', 0],
    ['seed/02-menu.json', 0],
  ])
})

Deno.test('an alias minted in one file is the batch the next one joins', async () => {
  let { asked, apply } = door()
  await sow([
    file('seed/01-places.json', [one('$here', 'Here')]),
    file('seed/02-menu.json', [{
      entity: { eid: '$soup' },
      doc: { title: 'Soup' },
      comment: { target: '$here' },
    }]),
  ], apply)
  // ONE batch, so `$here` resolves where `$soup` names it.
  assertEquals(asked.length, 1)
  assertEquals(asked[0].check, false)
  assertEquals(asked[0].batch.length, 2)
  assertEquals(asked[0].batch[1].comment, { target: '$here' })
})

// The other caller of the same reading: store_load, which names its files by a
// path instead of by `seedy` (T-34392).
Deno.test('a load path names one file, or the data under a folder', () => {
  for (
    let [path, file] of [
      ['data/cities.json', 'data/cities.json'],
      ['data', 'data/cities.json'],
      ['data/', 'data/one.json'],
      ['/data', 'data/deep/two.json'],
      ['data', 'data/cities.csv'],
      ['data/cities.csv', 'data/cities.csv'],
    ]
  ) assert(asked(path, file), `${path} ← ${file}`)
  for (
    let [path, file] of [
      ['data', 'data.json'],
      ['data', 'other/cities.json'],
      ['data', 'data/notes.md'],
      ['data/cities.json', 'data/towns.json'],
      ['', 'data/cities.json'],
    ]
  ) assertEquals(asked(path, file), false, `${path} ← ${file}`)
})

Deno.test('a load is one batch too, whatever chose the files', async () => {
  let { asked: got, apply } = door()
  let all = await load(
    loaded([
      file('data/02-menu.json', [{
        entity: { eid: '$soup' },
        comment: { target: '$here' },
      }]),
      file('data/01-places.json', [one('$here', 'Here')]),
    ]),
    apply,
  )
  assertEquals(all.map((s) => [s.file, s.index]), [
    ['data/01-places.json', 0],
    ['data/02-menu.json', 0],
  ])
  assertEquals(got.length, 1)
  assertEquals(got[0].check, false)
  assertEquals(got[0].batch.length, 2)
})

// A spreadsheet is read the same way and takes its place in the same order —
// what one row becomes is csv.ts's, and csv_test.ts holds that.
Deno.test('a CSV among the files is rows of the component `as` names', () => {
  let all = loaded([
    { path: 'data/02-menu.csv', text: 'id,serves\nsoup,4\n' },
    file('data/01-places.json', [one('$here', 'Here')]),
  ], { as: 'recipe', cols: { serves: 'number' } })
  assertEquals(all.map((s) => [s.file, s.index]), [
    ['data/01-places.json', 0],
    ['data/02-menu.csv', 0],
  ])
  assertEquals(all[1].bundle, {
    entity: { eid: '$data/02-menu.csv:0' },
    alias: { name: 'soup' },
    recipe: { serves: 4 },
  })
})

Deno.test('an app with no seed writes nothing at all', async () => {
  let { asked, apply } = door()
  assertEquals(
    await sow([{ path: 'index.html', text: '<h1>hi</h1>' }], apply),
    [],
  )
  assertEquals(asked.length, 0)
})

Deno.test('a file that is not JSON, or not a list of bundles, names itself', () => {
  let why = (files: { path: string; text: string }[]) =>
    assertThrows(() => sown(files), Error).message
  assert(
    why([{ path: 'seed/02.json', text: '{oops' }]).startsWith(
      'seed/02.json is not JSON',
    ),
  )
  assertEquals(
    why([{ path: 'seed.json', text: '{"doc":{}}' }]).startsWith(
      'seed.json is not a list',
    ),
    true,
  )
  assert(
    why([file('seed/03.json', [one('$a', 'A'), 7])]).startsWith(
      'seed/03.json[1] is not a bundle',
    ),
  )
})

Deno.test('a refused bundle is named by its file and index', async () => {
  let SAID = 'unknown column: recipe.serving — recipe declares serves'
  // The store refuses whatever batch carries the fifth bundle — the second of
  // the second file — and says the same thing every time, which is what the
  // narrowing reads.
  let { asked, apply } = door((batch) =>
    batch.some((b) => JSON.stringify(b).includes('"bad"')) ? SAID : null
  )
  let why = (await assertRejects(
    () =>
      sow([
        file('seed.json', [one('$a', 'A'), one('$b', 'B'), one('$c', 'C')]),
        file(
          'seed/02.json',
          [one('$d', 'D'), one('$bad', 'bad'), one('$e', 'E')],
        ),
      ], apply),
    Error,
  )).message
  assertEquals(why, `seed/02.json[1] was refused: ${SAID}`)
  // The write itself, then the narrowing — every ask after the first is a
  // check that writes nothing.
  assertEquals(asked[0].check, false)
  assert(asked.slice(1).every((a) => a.check), 'the narrowing never writes')
  // And it is a binary search, not a walk: six bundles cost far fewer than six.
  assert(asked.length <= 5, `${asked.length} asks`)
})
