import { assertEquals } from '@std/assert'
import { bodies, isBody } from './columns.ts'
import { blog, plain } from './harness.ts'

Deno.test('the body columns are the ones declaring store: blob', () => {
  assertEquals(bodies(blog), [{ comp: 'post', prop: 'body' }])
  assertEquals(isBody(blog.column('post', 'body')), true)
  assertEquals(isBody(blog.column('post', 'title')), false)
  assertEquals(isBody(blog.column('nope', 'nope')), false)
})

Deno.test('a body column is an ordinary text column to the meta-model', () => {
  let body = blog.column('post', 'body')!
  assertEquals([body.category, body.scalar, body.affinity], [
    'scalar',
    'text',
    'text',
  ])
  // and it is writable, validated and routed like any other text column
  assertEquals(blog.comp('post')!.writable.includes('body'), true)
  assertEquals(blog.check('post', { body: 'a long essay' }), [])
  assertEquals(blog.route('body'), { comp: 'post', prop: 'body' })
})

Deno.test('a vocabulary loaded without the keyword declares no bodies', () => {
  // The loader carries only what somebody registered, so a `store` nobody asked
  // for is invisible — and this package is then a no-op, not a surprise.
  assertEquals(bodies(plain), [])
})
