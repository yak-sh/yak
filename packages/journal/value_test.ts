/// <reference lib="deno.ns" />
import { equal, test } from '@yaks/testing'
import { dec, enc } from './value.ts'

test('journal values retain bytes including empty arrays and offset views', () => {
  let bytes = new Uint8Array([17, 0, 255, 128, 17]).subarray(1, 4)
  equal(dec(enc(bytes)), new Uint8Array([0, 255, 128]))
  equal(dec(enc(new Uint8Array())), new Uint8Array())
})

test('journal binary encoding cannot collide with ordinary JSON values', () => {
  for (
    let value of ['binary:AP+A', { 0: 0, 1: 255, 2: 128 }, { binary: 'AP+A' }, [
      0,
      255,
      128,
    ], null]
  ) {
    equal(dec(enc(value)), value)
  }
})
