import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import {
  confirmedTag,
  migrationMetadata,
  retiredName,
} from './app_migrations.ts'

let history = [
  { tag: 'v1', new_sqlite_classes: ['Room'] },
  { tag: 'v2', renamed_classes: [{ from: 'Room', to: 'Chat' }] },
  { tag: 'v3', deleted_classes: ['Chat'] },
]

test('app migrations: a first upload carries every step without config tags', () => {
  let before = structuredClone(history)
  assertEquals(migrationMetadata(history), {
    new_tag: 'v3',
    steps: [
      { new_sqlite_classes: ['Room'] },
      { renamed_classes: [{ from: 'Room', to: 'Chat' }] },
      { renamed_classes: [{ from: 'Chat', to: retiredName('v3', 'Chat') }] },
    ],
  })
  assertEquals(history, before)
})

test('app migrations: only unapplied steps are sent on a redeploy', () => {
  assertEquals(migrationMetadata(history, 'v1'), {
    old_tag: 'v1',
    new_tag: 'v3',
    steps: [
      { renamed_classes: [{ from: 'Room', to: 'Chat' }] },
      { renamed_classes: [{ from: 'Chat', to: retiredName('v3', 'Chat') }] },
    ],
  })
  assertEquals(migrationMetadata(history, 'v3'), undefined)
  assertEquals(migrationMetadata([]), undefined)
  assertEquals(migrationMetadata(undefined), undefined)
})

test('a retired class can be recreated without overwriting its saved namespace', () => {
  let migrations = [
    { tag: 'v1', new_sqlite_classes: ['Room'] },
    { tag: 'v2', deleted_classes: ['Room'] },
    { tag: 'v3', new_sqlite_classes: ['Room'] },
  ]
  assertEquals(migrationMetadata(migrations, 'v1'), {
    old_tag: 'v1',
    new_tag: 'v3',
    steps: [
      { renamed_classes: [{ from: 'Room', to: retiredName('v2', 'Room') }] },
      { new_sqlite_classes: ['Room'] },
    ],
  })
  let confirmed = confirmedTag('v2', 'a0000000-0000-4000-8000-000000000001')
  assertEquals(migrationMetadata(migrations, confirmed), {
    old_tag: confirmed,
    new_tag: 'v3',
    steps: [{ new_sqlite_classes: ['Room'] }],
  })
})

test('app migrations: unknown deployed history is refused before replay', () => {
  for (let current of ['removed-tag', 'v4', 'tag\nwith\rbreaks']) {
    let error = assertThrows(() => migrationMetadata(history, current), Error)
    assertEquals(
      error.message,
      `refused migrations: deployed tag ${JSON.stringify(current)} is ` +
        'missing from config; keep previously applied tags and append new migrations',
    )
    assertEquals(error.message.split(/[\r\n]/).length, 1)
  }
})

test('app migrations: tags identify one step each', () => {
  for (let tag of [undefined, null, '', ' ', 7]) {
    assertThrows(
      () => migrationMetadata([{ tag }]),
      Error,
      'refused migrations[0].tag: expected a nonempty migration tag',
    )
  }
  assertThrows(
    () => migrationMetadata([{ tag: 'v1' }, { tag: 'v1' }], 'v1'),
    Error,
    'refused migrations[1].tag: "v1" is repeated; each migration needs its own tag',
  )
})

test('app migrations: migration operations pass through unchanged', () => {
  let step = { new_classes: ['Room'], future_operation: { argument: ['Room'] } }
  assertEquals(migrationMetadata([{ tag: 'v1', ...step }]), {
    new_tag: 'v1',
    steps: [step],
  })
})
