import { assertEquals } from '@std/assert'
import { type Ent } from '../types.ts'
import * as suggest from './suggest.ts'

let ent = (num: number, title: string): Ent => ({
  eid: String(num),
  num,
  kind: 'task',
  doc: { eid: String(num), title, body: '' },
  refs: [],
  kids: [],
})

Deno.test('entity suggestions show, find, and prefer human ids', () => {
  let old = ent(123, 'Older')
  let fresh = ent(456, 'Mentions T-123')
  assertEquals(suggest.label(old), 'T-123 — Older')
  assertEquals(suggest.match('t-123', old), true)
  assertEquals(suggest.match('older', old), true)
  assertEquals(
    [old, fresh].filter((e) => suggest.match('T-123', e))
      .sort(suggest.order('T-123')),
    [old, fresh],
  )
})
