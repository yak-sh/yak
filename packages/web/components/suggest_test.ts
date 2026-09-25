import { assertEquals } from '@std/assert'
import { type Hit } from '../types.ts'
import * as suggest from './suggest.ts'

let hit = (num: number, title: string): Hit => ({
  eid: String(num),
  num,
  kind: 'task',
  title,
  snip: '',
  open: String(num),
})

Deno.test('entity suggestions label a hit by human id and title', () => {
  assertEquals(suggest.label(hit(123, 'Older')), 'T-123 — Older')
  assertEquals(suggest.label(hit(456, '')), 'T-456 — task')
})
