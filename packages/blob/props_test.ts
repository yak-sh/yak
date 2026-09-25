import { assertEquals } from '@std/assert'
import { bodies, isBody } from './props.ts'
import { blog, plain } from './testing.ts'

Deno.test('the body properties are the ones declaring store: blob', () => {
  assertEquals(bodies(blog), [{ comp: 'post', prop: 'body' }])
  assertEquals(isBody(blog.prop('post', 'body')), true)
  assertEquals(isBody(blog.prop('post', 'title')), false)
  assertEquals(isBody(blog.prop('nope', 'nope')), false)
})

Deno.test('a body property is an ordinary text property to the meta-model', () => {
  let body = blog.prop('post', 'body')!
  assertEquals([body.category, body.scalar, body.affinity], [
    'scalar',
    'text',
    'text',
  ])
  // and it is writable, validated and routed like any other text property
  assertEquals(blog.comp('post')!.writable.includes('body'), true)
  assertEquals(blog.check('post', { body: 'a long essay' }), [])
  assertEquals(blog.route('body'), { comp: 'post', prop: 'body' })
})

Deno.test('a vocabulary loaded without the keyword declares no bodies', () => {
  // The loader carries only what somebody registered, so a `store` nobody asked
  // for is invisible — and this package is then a no-op, not a surprise.
  assertEquals(bodies(plain), [])
})
