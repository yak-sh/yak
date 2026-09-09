// The names, against git's own — see ./harness.ts for where the constants came
// from.

import { assertEquals } from '@std/assert'
import { bin, framed, hex, oid, oid256 } from './oid.ts'
import {
  HELLO,
  HELLO_OID,
  HELLO_OID256,
  X,
  X_OID,
  X_OID256,
} from './harness.ts'

let utf8 = new TextEncoder()

Deno.test('a blob is named by its header and its bytes', async () => {
  assertEquals(await oid('blob', utf8.encode(HELLO)), HELLO_OID)
  assertEquals(await oid('blob', utf8.encode(X)), X_OID)
})

Deno.test('the same blob has a SHA-256 name too', async () => {
  assertEquals(await oid256('blob', utf8.encode(HELLO)), HELLO_OID256)
  assertEquals(await oid256('blob', utf8.encode(X)), X_OID256)
})

Deno.test('the header is the type, the size, and a NUL', () => {
  assertEquals(
    new TextDecoder().decode(framed('blob', utf8.encode(HELLO))),
    'blob 6\0hello\n',
  )
})

Deno.test('hex and bytes are the same id both ways', () => {
  assertEquals(hex(bin(HELLO_OID)), HELLO_OID)
  assertEquals(bin(HELLO_OID).length, 20)
  assertEquals(bin(HELLO_OID256).length, 32)
})
