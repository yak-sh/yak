// The link surround decided purely (anchor): become an <a>, dedupe, demote.
import { anchor } from './ui.tsx'
import { assertEquals } from '@std/assert'

let CASES: [string, Parameters<typeof anchor>, ReturnType<typeof anchor>][] = [
  ['no href: plain tag', ['div', undefined, undefined], { tag: 'div' }],
  ['no href under a link: still plain', ['div', undefined, '/T-1'], {
    tag: 'div',
  }],
  ['href, no surround: <a>, tag joins the class list', [
    'div',
    '/T-1',
    undefined,
  ], { tag: 'a', cls: 'div', href: '/T-1' }],
  ['same href inside: dropped (the dedupe)', ['span', '/T-1', '/T-1'], {
    tag: 'span',
  }],
  ['different href inside: tag kept, demoted to JS', ['span', '/T-2', '/T-1'], {
    tag: 'span',
    demote: '/T-2',
  }],
]

Deno.test('anchor', () => {
  for (let [name, args, want] of CASES) {
    assertEquals(anchor(...args), want, name)
  }
})
