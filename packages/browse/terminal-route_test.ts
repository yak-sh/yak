import { equal, test } from '@yaks/testing'
import './testing.ts'
import { start } from './terminal-route.ts'

let eid = 'ac7184a3-f341-4697-a8a7-b4ea0984c0db'
test('CLI entity routes use bare prefixes, including the inspect reading', () => {
  equal(start('#a83446de17'), '/a83446de17')
  equal(start('#a83446de17', true), '/a83446de17?v=Debug')
  equal(start('T-42'), '/T-42')
})
test('every spelling of an id opens its entity, not a search', () => {
  for (
    let [what, path] of [
      [eid, `/${eid}`],
      ['#ac7184a3f3', '/ac7184a3f3'],
      ['ac7184a3', '/ac7184a3'],
      ['ac7184a3f3', '/ac7184a3f3'],
      ['S-12', '/S-12'],
      ['12', '/12'],
    ]
  ) equal(start(what), path)
  equal(start('facade'), '/?(facade)')
})
