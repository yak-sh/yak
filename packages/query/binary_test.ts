/// <reference lib="deno.ns" />
import { equal, test, throws } from '@yaks/testing'
import { binaryOperand } from './binary.ts'

test('binary operands accept padded and unpadded base64', () => {
  equal(binaryOperand('AP+A'), new Uint8Array([0, 255, 128]))
  equal(binaryOperand('AA=='), new Uint8Array([0]))
  equal(binaryOperand('AA'), new Uint8Array([0]))
  equal(binaryOperand(''), new Uint8Array())
})

test('binary operands refuse malformed or lossy base64', async () => {
  for (
    let value of [
      '?',
      'A',
      'AA=',
      'AA===',
      'AA==x',
      'A A=',
      'AB==',
      'AAB=',
      '_w==',
    ]
  ) {
    await throws(() => binaryOperand(value))
  }
})
