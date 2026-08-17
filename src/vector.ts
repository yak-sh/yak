// The SQLite vector-search extension: select the prebuilt binary for this
// process, load it into a connection, and keep its persisted ANN data in step
// with the derived embedding table. SQLite triggers mark writes dirty; clearing
// that mark only after quantization makes an interrupted rebuild retry at boot.
//
// SERVER-ONLY, and importing this module must run NOTHING — no Deno API, no
// disk. It once detected the platform and `await import`ed the binary at top
// level; because embed.ts pulled this into the client bundle, that ran in the
// browser (where `Deno` is undefined) and crashed the canvas. The binary now
// resolves lazily inside loadVector, and twin.ts carries the pieces the client
// shares so nothing drags this loader across the wire (T-19451).

import type { DatabaseSync } from './sqlite.ts'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

export let DIM = 384

// One prebuilt package per platform, keyed the way `Deno.build` spells it. The
// values are the deno.json import-map aliases — the one list of binaries — so
// import.meta.resolve turns each into a file path against the same map.
type Binary = { path: string }
let aliases: Record<string, string> = {
  'linux-x86_64': '@sqlite-vector-linux-x86_64',
  'linux-aarch64': '@sqlite-vector-linux-aarch64',
  'darwin-x86_64': '@sqlite-vector-darwin-x86_64',
  'darwin-aarch64': '@sqlite-vector-darwin-aarch64',
  'windows-x86_64': '@sqlite-vector-windows-x86_64',
}

// Resolve and load this platform's binary once, on first use. createRequire is
// synchronous — loadVector runs inside the synchronous open(), so the path must
// be in hand without awaiting a dynamic import.
let require = createRequire(import.meta.url)
let binary: Binary | undefined
let load = (): Binary => {
  if (binary) return binary
  let platform = `${Deno.build.os}-${Deno.build.arch}`
  let alias = aliases[platform]
  if (!alias) throw new Error(`SQLite Vector has no binary for ${platform}`)
  // require() hands back the CJS module.exports directly (`{ path }`); the
  // `.default` is only there under ESM interop. Accept either.
  let m = require(fileURLToPath(import.meta.resolve(alias)))
  return binary = (m.default ?? m) as Binary
}

export let loadVector = (db: DatabaseSync) =>
  db.loadExtension(load().path)

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
