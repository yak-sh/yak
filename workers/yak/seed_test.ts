/// <reference lib="deno.ns" />
// The seed's own reading (seed.ts): which files are one, the order they are
// read in, the entry a bad file names, and the entry a refused batch is blamed
// on. The end-to-end proof — a deploy seeding a store and a redeploy seeding
// nothing — is mcp_test.ts.
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import type { Bundle } from '@yaks/graph'
import {
  type Applying,
  asked,
  load,
  loaded,
  loadParts,
  PART,
  parts,
  seedy,
  sow,
  type Sown,
  sown,
  STINT,
} from './seed.ts'
import { fits, ROOM } from './writes.ts'

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

Deno.test('a seed file is seed.json or seed.yml, or one under seed/', () => {
  for (
    let path of [
      'seed.json',
      'seed.yml',
      'seed/01.json',
      'seed/01.yml',
      'seed/deep/more.json',
    ]
  ) assert(seedy(path), path)
  for (
    let path of [
      'index.html',
      'vocab.json',
      'worker.js',
      'seeds.json',
      'seed/notes.md',
      'seed/rows.csv',
      'data/seed.json',
    ]
  ) assertEquals(seedy(path), false, path)
})

// YAML is the warm path and JSON keeps working, because YAML reads it
// (@yaks/yaml, M-34605): one seed may be written either way, and a folder may
// hold both.
Deno.test('a seed written in YAML is the same seed', () => {
  let all = sown([
    {
      path: 'seed.yml',
      text: '- entity: {eid: $a}\n  doc:\n    title: A\n',
    },
    file('seed/01-places.json', [one('$here', 'Here')]),
  ])
  assertEquals(all.map((s) => [s.file, s.bundle]), [
    ['seed.yml', one('$a', 'A')],
    ['seed/01-places.json', one('$here', 'Here')],
  ])
})

Deno.test('a seed that is neither is refused in its own name', () => {
  assertThrows(
    () => sown([{ path: 'seed.yml', text: 'a:\n - b\n  c: d\n' }]),
    Error,
    'seed.yml is not YAML',
  )
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
  // One batch, so `$here` resolves where `$soup` names it.
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
  ], { as: 'recipe', props: { serves: 'number' } })
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

// One batch is one transaction, so a load is cut where a batch would outgrow
// what a store writes at once: every bundle once, in order, and no part more
// than PART bundles or more bytes than the store's write log keeps.
Deno.test('a load is cut into parts a store writes whole', () => {
  let rows = (n: number, body = ''): Sown[] =>
    Array.from({ length: n }, (_, index) => ({
      file: 'data/rows.json',
      index,
      bundle: { entity: { eid: `$${index}` }, doc: { title: 'row', body } },
    }))
  let cut = (all: Sown[]) => {
    let them = parts(all)
    assertEquals(them.flat(), all)
    for (let part of them) {
      assert(part.length <= PART)
      assert(
        part.length == 1 || fits(JSON.stringify(part.map((s) => s.bundle))),
      )
    }
    return them.length
  }
  assertEquals(cut([]), 0)
  assertEquals(cut(rows(PART)), 1)
  assertEquals(cut(rows(PART + 1)), 2)
  assertEquals(cut(rows(3, 'x'.repeat(ROOM * 0.4))), 2)
  assertEquals(cut(rows(2, 'x'.repeat(ROOM))), 2)
})

// A load of several parts, as one call writes it: each part its own batch, in
// order, from where the caller said to start.
let three = [
  [{ file: 'a.json', index: 0, bundle: one('$a', 'A') }],
  [{ file: 'a.json', index: 1, bundle: one('$b', 'B') }],
  [{ file: 'a.json', index: 2, bundle: one('$c', 'C') }],
]
let titles = (batches: { batch: Bundle[]; check: boolean }[]) =>
  batches.filter((b) => !b.check).map((b) =>
    b.batch.map((x) => (x.doc as { title: string }).title).join()
  )

Deno.test('a load of several parts is written a part per batch', async () => {
  let { asked, apply } = door()
  let { wrote, last } = await loadParts(three, 1, apply)
  assertEquals(titles(asked), ['A', 'B', 'C'])
  assertEquals([wrote.length, last], [3, 3])
  let again = door()
  assertEquals((await loadParts(three, 2, again.apply)).last, 3)
  assertEquals(titles(again.asked), ['B', 'C'])
})

Deno.test('a refused part says what was written and where to go on', async () => {
  let { asked, apply } = door((b) =>
    b.some((x) => x.entity.eid == '$b') ? 'no B' : null
  )
  let why = (await assertRejects(() => loadParts(three, 1, apply), Error))
    .message
  assertStringIncludes(why, 'a.json[1] was refused: no B')
  assertStringIncludes(why, 'part 1 of 3 (1 of its entities) went in')
  assertStringIncludes(why, 'part: 2 goes on')
  assertEquals(titles(asked), ['A', 'B'])
})

Deno.test('a call stops between parts once its stint is spent', async () => {
  let { asked, apply } = door()
  let clock = [0, STINT + 1]
  let { last } = await loadParts(three, 1, apply, () => clock.shift() ?? 1e9)
  assertEquals(last, 1)
  assertEquals(titles(asked), ['A'])
})

Deno.test('a seed bigger than one part refuses and writes nothing', async () => {
  let { asked, apply } = door()
  let seed = file(
    'seed.json',
    Array.from({ length: PART + 1 }, (_, i) => one(`$${i}`, `${i}`)),
  )
  assertStringIncludes(
    (await assertRejects(() => sow([seed], apply), Error)).message,
    `the seed holds ${PART + 1} entities`,
  )
  assertEquals(asked.length, 0)
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
  let SAID = 'unknown property: recipe.serving — recipe has serves (number)'
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
