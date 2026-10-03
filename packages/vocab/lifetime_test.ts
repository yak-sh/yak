// What a component says about its own state, read off a declaration.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  durableOf,
  expireOf,
  kept,
  lives,
  loadVocab,
  ms,
  paceOf,
  said,
  saved,
  saveOf,
  syncOf,
} from './mod.ts'

test('a declaration answers with its word, or with the default', () => {
  assertEquals(said('peers'), 'peers')
  assertEquals(said('none'), 'none')
  assertEquals(said(undefined), 'server')
  assertEquals(said('sideways'), 'server')
  assertEquals(kept('5s'), '5s')
  assertEquals(kept(undefined), 'forever')
})

test('saved relay values expose their query independently of their pace', () => {
  let v = loadVocab({
    $defs: {
      position: {
        component: true,
        sync: 'peers',
        durable: 'forever',
        pace: '100ms',
        save: '!position | .updated.at<="30s ago"',
        properties: { x: { type: 'number' } },
      },
      cursor: { component: true, sync: 'peers', durable: 'connection' },
    },
  })
  assertEquals([paceOf(v, 'position'), saveOf(v, 'position')], [
    100,
    '!position | .updated.at<="30s ago"',
  ])
  assertEquals(v.comp('position')?.save, '!position | .updated.at<="30s ago"')
  assertEquals([saveOf(v, 'cursor'), saveOf(v, 'ghost')], [null, null])
  assertEquals(saved('.position.x>5'), '.position.x>5')
  assertEquals(saved(' .position '), ' .position ')
  assertEquals(saved('hello'), 'hello')
})

test('save refuses absent, blank and duration declarations', () => {
  for (
    let save of [
      undefined,
      30,
      '',
      ' ',
      '0s',
      '30s',
      '-1s',
      '+5s',
      ' 30s ',
      '9'.repeat(400) + 's',
    ]
  ) {
    assertEquals(saved(save), null)
  }
})

test('a duration is milliseconds; a boundary is not a span', () => {
  assertEquals(ms('250ms'), 250)
  assertEquals(ms('5s'), 5000)
  assertEquals(ms('2m'), 120_000)
  assertEquals(ms('1.5h'), 5_400_000)
  assertEquals(ms('forever'), null)
  assertEquals(ms('connection'), null)
  assertEquals(ms('soon'), null)
  assertEquals([lives('forever'), lives('connection'), lives('5s')], [
    true,
    true,
    true,
  ])
  assertEquals(lives('soon'), false)
})

test('a component that says nothing syncs to the server, forever', () => {
  let v = loadVocab({
    $defs: {
      task: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
      presence: {
        component: true,
        type: 'object',
        sync: 'peers',
        durable: 'connection',
        pace: '100ms',
        properties: { x: { type: 'number' } },
      },
    },
  })
  assertEquals([syncOf(v, 'task'), durableOf(v, 'task')], ['server', 'forever'])
  assertEquals([syncOf(v, 'presence'), durableOf(v, 'presence')], [
    'peers',
    'connection',
  ])
  assertEquals([paceOf(v, 'presence'), paceOf(v, 'task')], [100, null])
  // A component this vocabulary never heard of answers like an undeclared one.
  assertEquals(
    [syncOf(v, 'ghost'), durableOf(v, 'ghost'), paceOf(v, 'ghost')],
    [
      'server',
      'forever',
      null,
    ],
  )
})

test('expire is a query for any stored component; absent expires nothing', () => {
  let query = '.run.state=done,failed .run.at<="7d ago"'
  let v = loadVocab({
    $defs: {
      run: {
        component: true,
        expire: query,
        properties: { state: { type: 'string' }, at: { type: 'string' } },
      },
      item: { component: true },
    },
  })
  assertEquals(expireOf(v, 'run'), query)
  assertEquals(expireOf(v, 'item'), null)
  assertEquals(expireOf(v, 'ghost'), null)
})
