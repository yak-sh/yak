/// <reference lib="deno.ns" />
// The runtime returns ArrayBuffer BLOBs; the storage interface returns bytes.
import { binaryCases, binaryVocab } from '../sqlite/binary_cases.ts'
import { storage } from './store.ts'
import { durable } from './testing.ts'

binaryCases(() => {
  let s = storage(durable(), binaryVocab)
  s.install()
  return s
})
