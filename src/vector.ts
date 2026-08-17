// The SQLite vector-search extension: select the prebuilt binary for this
// process, load it into a connection, and keep its persisted ANN data in step
// with the derived embedding table. SQLite triggers mark writes dirty; clearing
// that mark only after quantization makes an interrupted rebuild retry at boot.

import type { DatabaseSync } from './sqlite.ts'

export let DIM = 384

type Binary = { default: { path: string } }
let bins: Record<string, () => Promise<Binary>> = {
  'linux-x86_64': () => import('@sqlite-vector-linux-x86_64'),
  'linux-aarch64': () => import('@sqlite-vector-linux-aarch64'),
  'darwin-x86_64': () => import('@sqlite-vector-darwin-x86_64'),
  'darwin-aarch64': () => import('@sqlite-vector-darwin-aarch64'),
  'windows-x86_64': () => import('@sqlite-vector-windows-x86_64'),
}
let platform = `${Deno.build.os}-${Deno.build.arch}`
let binary = await (bins[platform]?.() ?? Promise.reject(
  new Error(`SQLite Vector has no binary for ${platform}`),
))

export let loadVector = (db: DatabaseSync) =>
  db.loadExtension(binary.default.path)

let count = (db: DatabaseSync) =>
  (db.prepare('select count(*) n from embedding').get() as { n: number }).n

export let refreshVector = (db: DatabaseSync) => {
  let row = db.prepare('select dirty from embedding_index where id = 1')
    .get() as { dirty: number } | undefined
  if (!row?.dirty) return 0
  let n = count(db)
  if (n) {
    db.prepare(
      "select vector_quantize('embedding','vec','qtype=TURBO4')",
    ).get()
    db.prepare("select vector_quantize_preload('embedding','vec')").get()
  }
  db.prepare('update embedding_index set dirty = 0 where id = 1').run()
  return n
}

export let initVector = (db: DatabaseSync) => {
  db.prepare(
    `select vector_init(
      'embedding', 'vec',
      'type=FLOAT32,dimension=${DIM},distance=COSINE'
    )`,
  ).get()
  let state = db.prepare('select id from embedding_index where id = 1').get()
  if (!state) {
    db.prepare('insert into embedding_index (id, dirty) values (1, 1)').run()
  }
  refreshVector(db)
}
