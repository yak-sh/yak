import { assertEquals, assertThrows } from '@std/assert'
import { bundlesIn, CHUNK, chunks } from './apply.ts'

Deno.test('NDJSON is one bundle a line, and blank lines are nothing', () => {
  assertEquals(
    bundlesIn('{"entity":{"eid":"a"}}\n\n{"entity":{"eid":"b"}}\n'),
    [{ entity: { eid: 'a' } }, { entity: { eid: 'b' } }],
  )
  assertEquals(bundlesIn('  \n'), [])
})

Deno.test('a JSON array reads the same way', () => {
  assertEquals(bundlesIn('[{"a":1},{"b":2}]'), [{ a: 1 }, { b: 2 }])
  assertThrows(() => bundlesIn('[1'), Error)
})

Deno.test('a line that is not JSON is named by its number', () => {
  assertThrows(
    () => bundlesIn('{"a":1}\nnot json\n'),
    Error,
    'line 2 is not JSON',
  )
})

Deno.test('bundles go over in batches', () => {
  assertEquals(chunks([1, 2, 3], 2), [[1, 2], [3]])
  assertEquals(chunks([], 2), [])
  let many = Array.from({ length: CHUNK + 1 }, (_, i) => i)
  assertEquals(chunks(many).map((c) => c.length), [CHUNK, 1])
})
