import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { nextDue, safeUrl } from './model.js'

test('recurring care stays in the target month at a month end', () => {
  assertEquals(nextDue('2027-01-31', 1), '2027-02-28')
  assertEquals(nextDue('2028-01-31', 1), '2028-02-29')
  assertEquals(nextDue('2026-10-31', 3), '2027-01-31')
  assertEquals(nextDue('2026-10-26', 0), '')
})

test('a document link cannot run a script', () => {
  assertEquals(safeUrl('javascript:alert(1)'), '')
  assertEquals(
    safeUrl('https://example.org/manual.pdf'),
    'https://example.org/manual.pdf',
  )
})
