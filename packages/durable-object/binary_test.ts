/// <reference lib="deno.ns" />
// The runtime returns ArrayBuffer BLOBs; the storage interface returns bytes.
import { binaryCases, binaryVocab } from '../sqlite/binary_cases.ts'
import { storage } from './store.ts'
import { durable } from './testing.ts'

binaryCases(() => {
  let s = storage(durable(), binaryVocab)
  s.install()
  // Prepare the read plan with the adapter fixture; transaction visibility
  // still patches and reads its changed bytes inside the measured test.
  s.read('.document')
  return s
})
