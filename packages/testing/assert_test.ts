// A failing assertion fails at once with the difference shown, whatever it
// compares: DOM nodes show as their markup, and a cycle as `[Circular]`.
import { assertEquals } from '@std/assert'
import { equal, match, test, throws } from '@yaks/testing'
import { parseHTML } from 'linkedom'

let page = parseHTML(
  `<html><body>${
    '<p><a href="/x">yaks.app</a> words</p>'.repeat(20)
  }</body></html>`,
).document
let links = [...page.querySelectorAll('a')]

let fails = (check: () => unknown, ...shows: string[]) => async () => {
  let error = await throws(check, 'Values are not equal')
  for (let part of shows) {
    equal((error as Error).message.includes(part), true, part)
  }
}

test(
  'equal over DOM nodes fails showing their markup',
  fails(() => equal(links.slice(0, 1), []), '<a href="/x">yaks.app</a>'),
)

test(
  'match over a DOM node fails showing its markup',
  fails(() => match({ link: links[0] }, { link: null }), 'yaks.app</a>'),
)

test(
  'equal over a cyclic value fails showing the cycle',
  fails(() => {
    let loop: Record<string, unknown> = { n: 1 }
    loop.self = loop
    equal(loop, { n: 2 })
  }, 'Circular'),
)

test('equal over nodes alike in markup says so', () => {
  let other = parseHTML('<a href="/x">yaks.app</a>').document.firstChild
  return throws(() => equal(other, links[0]), 'show alike')
})

test('equal passes over the same nodes', () => {
  equal(links, [...page.querySelectorAll('a')])
})

// `assertEquals` formats through inspection. A linkedom node inspects as its
// markup, so a failure on a large page names the element instead of walking
// the document.
test('assertEquals over a linkedom node fails showing its markup', async () => {
  let markup = '<textarea name="say"></textarea>'
  let wide = parseHTML(
    `<html><body>${'<div><p>x</p></div>'.repeat(2000)}${markup}</body></html>`,
  ).document
  let field = wide.querySelector('[name=say]')!
  let read = (name: string) => {
    let show = Reflect.get(field, Symbol.for(name))
    return typeof show == 'function' ? show.call(field) : show
  }
  equal(read('Deno.customInspect'), markup)
  equal(read('nodejs.util.inspect.custom'), markup)
  let error = await throws(
    () => assertEquals(field, null),
    'Values are not equal',
  )
  let message = (error as Error).message
  equal(message.includes(markup), true)
  equal(message.includes('ownerDocument'), false)
})
