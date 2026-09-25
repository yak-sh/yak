// An alias is a key entity of its own: find() and aliasNames() read the name
// off it and land on the entity it points at.
import './testing.ts'
import { assertEquals } from '@std/assert'
import { aliasNames, find, type Row } from './client.ts'

let row = (eid: string, comps: Row['comps'], num = 0): Row => ({
  eid,
  num,
  kind: '',
  comps,
})
let all = [
  row('t', { task: {}, doc: { title: 'Scribe desk' } }, 7),
  row('k', { key: { of: 't', value: 'scribe-desk' }, alias: {} }),
  // a key of another kind is not a name
  row('x', { key: { of: 't', value: 'not-a-name' } }),
]

Deno.test('an alias names the entity its key points at', () => {
  assertEquals(find(all, 'scribe-desk')?.eid, 't')
  assertEquals(find(all, 'T-7')?.eid, 't')
  assertEquals(find(all, 'not-a-name'), undefined)
  assertEquals(find(all.slice(1), 'scribe-desk'), undefined) // target unloaded
  assertEquals(aliasNames(all), new Map([['t', 'scribe-desk']]))
})
