import { assert, assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { sha256 } from '@yaks/graph'
import manifest from './vocab.json' with { type: 'json' }
import { atelier, type Generator } from './atelier.ts'
import { collection } from './collection.ts'
import { fingerprint, type Job } from './model.ts'
import { memory } from '../printbound/storefront_fixture.ts'

let alice = {
  person: '00000000-0000-4000-8000-000000000001',
  via: '00000000-0000-4000-8000-000000000003',
}
let bob = { person: '00000000-0000-4000-8000-000000000002' }
let style = '00000000-0000-4000-8000-000000000004'
let input = {
  title: 'Ada and the river',
  prompt: 'Ada follows the river to a treehouse.',
  body:
    'Ada follows the river.\n\nAda finds a bridge.\n\nAda reaches the treehouse.',
  character: 'Ada has a striped hat.',
  style,
  age: '4-8',
  mode: 'story',
}
let fixture = async () => {
  let { db, g } = memory(manifest),
    failed = new Set<string>(),
    pending = new Set<string>(),
    drawn: string[] = []
  await db.apply([{
    entity: { eid: style },
    doc: { title: 'Woodcut' },
    coloring_style: {
      prompt_modifier: 'Carved outlines and open colorable regions.',
    },
  }])
  let generator: Generator = {
    request(job, prompt, refs) {
      return [{
        entity: { eid: crypto.randomUUID() },
        entry: { session: job, seq: 1 },
        content: { body: prompt + refs.map((r) => r.label).join('\n') },
      }]
    },
    async result(job) {
      if (pending.has(job)) return {}
      let [row] = await db.query(`.entity.eid=${job}&?page_job`) as Job[]
      if (failed.has(row.page_job.page)) {
        return { error: 'The artwork failed. Your other pages are kept.' }
      }
      drawn.push(row.page_job.page)
      return {
        artwork: { blob: sha256(job), hash: sha256(job), mime: 'image/png' },
      }
    },
  }
  let io = {
    generate: generator,
    puzzle: () =>
      Promise.resolve({
        blob: 'f'.repeat(64),
        hash: 'f'.repeat(64),
        mime: 'application/pdf',
      }),
  }
  return { db, g, io, failed, pending, drawn, desk: atelier(db, io) }
}

test('saved idea, story, style and guest identity survive reopening and bind on sign-in', async () => {
  let { db, io, desk } = await fixture(),
    row = await desk.save(input, { via: alice.via })
  let reopened = atelier(db, io)
  assertEquals(
    (await reopened.owned(row.entity.eid, alice)).doc.body,
    input.body,
  )
  await reopened.save({ ...input, id: row.entity.eid }, alice)
  await assertRejects(() => reopened.owned(row.entity.eid, bob))
  assertEquals((await reopened.shelf(bob)).length, 0)
})

test('bounded page jobs resume after interruption and keep completed artwork through a failed sibling', async () => {
  let f = await fixture(), book = await f.desk.save(input, alice)
  let pages = await f.desk.outline(book.entity.eid, alice)
  await f.desk.advance(book.entity.eid, alice)
  await f.desk.advance(book.entity.eid, alice)
  let running = await f.desk.pages(book)
  assertEquals(running.filter((p) => p.page_drawing).length, 2)
  f.failed.add(pages[1].entity.eid)
  let restarted = atelier(f.db, f.io)
  await restarted.advance(book.entity.eid, alice)
  let first = (await restarted.pages(book))[0].artwork
  assert(first)
  let result = await restarted.advance(book.entity.eid, alice)
  assertEquals(result.pages[0].artwork, first)
  assertEquals(
    result.pages[1].page_failed?.message,
    'The artwork failed. Your other pages are kept.',
  )
  assertEquals(result.complete, false)
  assertEquals(
    f.drawn.filter((page) => page === pages[0].entity.eid).length,
    1,
  )
  f.failed.clear()
  await restarted.retry(book.entity.eid, pages[1].entity.eid, alice)
  await restarted.advance(book.entity.eid, alice)
  let completed = await restarted.advance(book.entity.eid, alice)
  assertEquals(completed.complete, true)
  assertEquals(completed.pages[0].artwork, first)
})

test('reordering pages preserves their completed artwork and only changes print order', async () => {
  let f = await fixture(),
    book = await f.desk.save(input, alice),
    pages = await f.desk.outline(book.entity.eid, alice)
  for (let i = 0; i < 4; i++) await f.desk.advance(book.entity.eid, alice)
  let before = await f.desk.pages(book),
    firstInput = fingerprint(book, before[0])
  await f.desk.move(book.entity.eid, pages[0].entity.eid, 1, alice)
  let after = await f.desk.pages(book),
    moved = after.find((p) => p.entity.eid === pages[0].entity.eid)!
  assertEquals(after.map((p) => p.entity.eid), [
    pages[1].entity.eid,
    pages[0].entity.eid,
    pages[2].entity.eid,
  ])
  assertEquals(moved.artwork, before[0].artwork)
  assertEquals(fingerprint(book, moved), firstInput)
})

test('a toddler gets age-appropriate puzzles and another customer cannot change their pages', async () => {
  let f = await fixture(),
    book = await f.desk.save({ ...input, age: '2-4' }, alice)
  await f.desk.outline(book.entity.eid, alice)
  await assertRejects(() =>
    f.desk.addPuzzle(book.entity.eid, 'word_search', alice)
  )
  await f.desk.addPuzzle(book.entity.eid, 'maze', alice)
  let pages = await f.desk.pages(book)
  await assertRejects(() =>
    f.desk.edit(book.entity.eid, pages[0].entity.eid, {
      prompt: 'Other person',
    }, bob)
  )
  assertEquals(pages.at(-1)!.coloring_page.activity, 'maze')
})

test('gathering owned finished pages preserves bytes and rejects another customer', async () => {
  let f = await fixture(),
    source = await f.desk.save({ ...input, mode: 'free' }, alice)
  await f.desk.outline(source.entity.eid, alice)
  await f.desk.advance(source.entity.eid, alice)
  await f.desk.advance(source.entity.eid, alice)
  let [page] = await f.desk.pages(source)
  let target = await f.desk.save({ ...input, title: 'Gathered pages' }, alice)
  let gather = collection(f.db, f.desk)
  await gather.assemble(target, [page.entity.eid], alice)
  let [copy] = await f.desk.pages(target)
  assertEquals(copy.artwork?.blob, page.artwork?.blob)
  assertEquals(copy.artwork?.input, fingerprint(target, copy))
  assertEquals((await f.desk.advance(target.entity.eid, alice)).complete, true)
  assertEquals((await gather.list(bob)).length, 0)
  await assertRejects(() => gather.assemble(target, [page.entity.eid], bob))
})
