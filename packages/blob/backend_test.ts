import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Backend, backend } from './backend.ts'
import { memoryBlobs } from './store.ts'

let waiting = (said: unknown) => backend(said as Backend, {}).waiting

test('a store nobody can build says why', () => {
  // A composed host refuses to start on it, naming what is missing.
  assertEquals(waiting({ via: 'file' }), 'a file store needs `dir`')
  assertEquals(
    waiting({ via: 'file', dir: '/b' }),
    'a file store needs a host with files',
  )
  assertEquals(waiting({ via: 'bucket' }), 'no store called "bucket"')
  assertEquals(
    waiting({ via: 'sqlite' }),
    'a SQLite store needs a host that keeps one',
  )
  let blobs = memoryBlobs()
  assertEquals(backend({ via: 'sqlite' }, { blobs }).store, blobs)
})
