import { equal, test } from '@yaks/testing'
import './testing.ts'
import { start } from './terminal-route.ts'

test('CLI entity routes use bare prefixes, including the inspect reading', () => {
  equal(start('#a83446de17'), '/a83446de17')
  equal(start('#a83446de17', true), '/a83446de17?v=Debug')
  equal(start('T-42'), '/T-42')
})
