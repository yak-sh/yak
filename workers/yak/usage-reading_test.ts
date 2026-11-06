import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { App, Meter, Space } from './directory.ts'
import { measured } from './usage.ts'

let NOW = new Date('2026-09-15T12:00:00Z')

let held = (slug: string, files: number | null) => ({
  space: {
    eid: `$${slug}`,
    slug,
    meter: files == null ? null : { month: '2026-09', files },
  } as Space,
  apps: [] as App[],
})

let refusedList = new Error('list: refused')
let files = new Map([['jeff/a/photo', 20]])

let reading: Parameters<typeof measured>[1] = {
  sizesOf: ({ slug }) =>
    slug == 'ada' ? Promise.reject(refusedList) : Promise.resolve(files),
  counts: null,
  month: '2026-09',
  now: NOW,
}

// The stored figure came from the prior sweep; its next listing fails.
let previous = await measured([held('ada', null)], {
  ...reading,
  sizesOf: () => Promise.resolve(new Map([['ada/a/photo', 70]])),
})
let failed = held('ada', (previous.entities[0].meter as Meter).files ?? null)
let next = held('jeff', null)
let spaces = [failed, next]

test('a space whose files cannot be listed keeps its figure, and the rest are read', async () => {
  let { entities, refused } = await measured([failed], reading)
  assertEquals(
    entities.map((e) => [e.entity.eid, (e.meter as Meter).files]),
    [['$ada', 70]],
  )
  assertEquals(refused.map((e) => (e as Error).message), ['list: refused'])
})

test('a space after a failed file listing is still measured', async () => {
  let { entities, refused } = await measured(spaces, reading)
  assertEquals(entities.map((e) => [e.entity.eid, (e.meter as Meter).files]), [[
    '$ada',
    70,
  ], ['$jeff', 20]])
  assertEquals(refused, [refusedList])
})
