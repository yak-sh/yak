// One backend declaration yields the byte store shared by artifact writers
// and readers. Text properties keep their separate SQL store.
import { fileBlobs } from './file.ts'
import { type Bucket, objectBlobs } from './object.ts'
import { type Blobs, memoryBlobs } from './store.ts'

/** A byte store, as a graph's configuration names one. */
export type Backend =
  | { via: 'sqlite' }
  | { via: 'file'; dir: string }
  | {
    via: 'object'
    bucket: Pick<Bucket, 'head' | 'get' | 'put'>
    prefix?: string
  }

/** The default binary store: beside a file-backed graph, or in memory. */
export let artifactsAt = (path: string): Blobs =>
  path == ':memory:'
    ? memoryBlobs()
    : fileBlobs(path.slice(0, path.lastIndexOf('/') + 1) + 'images')

/** Build the backend named by a config, or explain why it cannot serve. */
export let backend = (
  said: Backend,
  host: { blobs: Blobs },
): { store?: Blobs; waiting?: string } => {
  if (said.via == 'sqlite') return { store: host.blobs }
  if (said.via == 'file') {
    return said.dir
      ? { store: fileBlobs(said.dir) }
      : { waiting: 'a file store needs `dir`' }
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
