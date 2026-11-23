// One backend declaration yields the byte store shared by artifact writers
// and readers. Text properties keep their separate SQL store.
//
// The stores a runtime may lack come from its host: a directory store is
// `host.files` (@yaks/blob/file `fileBlobs`, given by a box), so a Worker or a
// browser tab that loads this module never loads the filesystem.
import { type Bucket, objectBlobs } from './object.ts'
import type { Blobs } from './store.ts'

/** A byte store, as a graph's configuration names one. */
export type Backend =
  | { via: 'sqlite' }
  | { via: 'file'; dir: string }
  | {
    via: 'object'
    bucket: Pick<Bucket, 'head' | 'get' | 'put' | 'delete'>
    prefix?: string
  }

/** Build the backend named by a config, or explain why it cannot serve. */
export let backend = (
  said: Backend,
  host: { blobs?: Blobs; files?: (dir: string) => Blobs },
): { store?: Blobs; waiting?: string } => {
  if (said.via == 'sqlite') {
    return host.blobs
      ? { store: host.blobs }
      : { waiting: 'a SQLite store needs a host that keeps one' }
  }
  if (said.via == 'file') {
    if (!said.dir) return { waiting: 'a file store needs `dir`' }
    return host.files
      ? { store: host.files(said.dir) }
      : { waiting: 'a file store needs a host with files' }
  }
  if (said.via == 'object') {
    return said.bucket
      ? { store: objectBlobs(said.bucket, said.prefix) }
      : { waiting: 'an object store needs `bucket`' }
  }
  return {
    waiting: `no store called ${JSON.stringify((said as Backend).via)}`,
  }
}
