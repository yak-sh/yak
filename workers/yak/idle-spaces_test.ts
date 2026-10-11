import { assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { IDLE, idleSpaces, type Row } from './idle-spaces.ts'

let now = Date.parse('2026-10-11T12:00:00Z')
let at = (age: number) => new Date(now - age).toISOString()
let old = { created: { at: at(IDLE) } }
let fixture = (): Row[] => [
  { entity: { eid: 'space' }, space: { slug: 'probe' }, ...old },
  { entity: { eid: 'app' }, app: { space: 'space' }, ...old },
  {
    entity: { eid: 'seat' },
    member: { space: 'space', person: 'bot' },
    ...old,
  },
  { entity: { eid: 'bot' }, email: { address: 'probe@bot.yak.sh' } },
]
let selected = (edit: (rows: Row[]) => void = () => {}) => {
  let rows = fixture()
  edit(rows)
  return idleSpaces(rows, now)
}

test('only an unpublished test space with seven days of recorded inactivity goes', () => {
  assertEquals(selected(), ['space'])
  for (let i of [0, 1, 2]) {
    assertEquals(selected((rows) => rows[i].updated = { at: at(IDLE - 1) }), [])
    assertEquals(selected((rows) => delete rows[i].created), [])
  }
  assertEquals(selected((rows) => rows[1].published = { name: 'probe' }), [])
  assertEquals(selected((rows) => rows.splice(2, 1)), [])
  for (let address of ['admin@bot.yak.sh', 'person@example.com', '']) {
    assertEquals(selected((rows) => rows[3].email = { address }), [])
  }
  assertEquals(
    selected((rows) =>
      rows.push({
        entity: { eid: 'human' },
        email: { address: 'person@example.com' },
      }, {
        entity: { eid: 'seat2' },
        member: { space: 'space', person: 'human' },
        ...old,
      })
    ),
    [],
  )
  assertEquals(
    selected((rows) =>
      rows.push({
        entity: { eid: 'grant' },
        grant: { app: 'app', person: 'unknown' },
        ...old,
      })
    ),
    [],
  )
})

test('readings count activity, while storage and lifetime totals do not', () => {
  for (
    let key of [
      'requests',
      'ws_messages',
      'ws_hibernated',
      'rows_read',
      'rows_written',
      'emails',
      'builds',
      'models',
      'realtime',
      'seconds',
    ]
  ) {
    assertEquals(
      selected((rows) => rows[0].meter = { [key]: 1, at: at(0) }),
      [],
    )
    assertEquals(selected((rows) => rows[0].meter = { [key]: 1 }), [])
  }
  assertEquals(
    selected((rows) =>
      rows[0].meter = {
        requests: 1,
        at: at(IDLE),
      }
    ),
    ['space'],
  )
  assertEquals(
    selected((rows) =>
      rows[0].meter = {
        requests: 0,
        bytes: 123,
        files: 456,
        built: 99,
        at: at(0),
      }
    ),
    ['space'],
  )
})

test('platform and reviewer spaces survive whatever their members', () => {
  for (
    let slug of [
      'yak',
      'admin',
      'yourname',
      'claude-review',
      'claude-review-2',
      'chata',
      'chatb',
    ]
  ) assertEquals(selected((rows) => rows[0].space = { slug }), [])
})
