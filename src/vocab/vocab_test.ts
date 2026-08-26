// The vocabulary's value-level guard: types.ts (a GENERATED file) must say
// exactly what src/vocab/fixture.json records — both are written together
// by `deno task codegen`, so a hand edit to either drifts and fails here.
// The byte-level stale check against the manifests is `deno task codegen
// --check`, wired into `deno task check`; this test holds the semantic
// line inside the fast tier.
import { assertEquals } from '@std/assert'
import { capture } from './fixture.ts'
import * as types from '../types.ts'

let fixture = JSON.parse(
  Deno.readTextFileSync(new URL('./fixture.json', import.meta.url)),
)

Deno.test('types.ts matches the vocabulary fixture', () => {
  assertEquals(capture(types), fixture)
})
