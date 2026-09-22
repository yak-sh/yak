import { assert } from '@std/assert'
import { mint, minted } from './mint.ts'

Deno.test('a minted eid is a v4 uuid, and each one is its own', () => {
  let a = mint()
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(a),
    a,
  )
  assert(a != mint())
})

Deno.test('a generated id is told from a name somebody chose', () => {
  assert(minted(mint()))
  assert(minted('a'.repeat(40))) // a content address
  assert(!minted('lemon-cake'))
})
