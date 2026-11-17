import { test } from '@yaks/testing'
import { assertEquals, assertThrows } from '@std/assert'
import { joined, line, parse, sub } from './mod.ts'

// Each case: a value put after `.space.slug=`, and the text written for it.
let cases: [string | number, string][] = [
  ['me', 'me'],
  [3, '3'],
  ['me)|(.member.person=x', '"me)|(.member.person=x"'],
  ['a&b', '"a&b"'],
  ['a,b', '"a,b"'],
  ['a b', '"a b"'],
  ['', '""'],
  ['-x', '"-x"'],
  ['x"y', '"x\\"y"'],
]

test('a value in a line is one operand', () => {
  for (let [v, text] of cases) {
    let l = line`.space.slug=${v}`
    assertEquals(l, `.space.slug=${text}`)
    let [pred] = (parse(l) as { clauses: { value: unknown }[] }).clauses
    assertEquals(pred.value, { kind: 'scalar', raw: String(v) })
  }
})

test('a list is one any-of value, and an empty one has no text', () => {
  assertEquals(line`.app=${['a', 'b,c']}`, '.app=a,"b,c"')
  assertThrows(() => line`.app=${[]}`, SyntaxError)
})

test('a missing value is refused rather than written', () => {
  // deno-lint-ignore no-explicit-any
  assertThrows(() => line`.app=${undefined as any}`, TypeError)
})

test('only sub splices a line, and joined groups each', () => {
  let mine = line`.member.person=${'p'}`
  assertEquals(line`.space&${sub(mine)}`, '.space&.member.person=p')
  let wide = line`.member.person=${'p'}|.space`
  assertEquals(line`.space&${wide}`, '.space&".member.person=p|.space"')
  assertEquals(joined([line`.a`, line`.b|.c`], '|'), '(.a)|(.b|.c)')
  assertEquals(joined([line`.a|.b`, line`.limit=1`], '&'), '(.a|.b)&.limit=1')
})
