#!/usr/bin/env -S deno run -A
// bin/pack-releases — once: every release index in yak-blobs written again
// with the texts a deploy now packs into it (workers/yak/release.ts `packed`),
// so an idle app's first view reads one object rather than the index and then
// its page (T-143062). A packed index names every path, key and sha it named
// before; code that predates `text` reads it as it read the old one.
//
//   deno run -A bin/pack-releases.ts [--write]
//
// Without --write it says what it would write. Wrangler's own sign-in is the
// token, asked of `wrangler auth token` again when it runs out.
import type { Objects } from '@yaks/blob'
import { packed } from '../workers/yak/release.ts'
import { decode, encode, type Index } from '../workers/yak/release_index.ts'

let ACCOUNT = '0f9613dfd3f0451df0bd0f12a1372ea3'
let API =
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/yak-blobs`
let write = Deno.args.includes('--write')

let auth = ''
let signed = async () => {
  let out = await new Deno.Command('npx', {
    args: ['wrangler', 'auth', 'token'],
    cwd: new URL('../workers/yak/', import.meta.url),
    stderr: 'null',
  }).output()
  auth = new TextDecoder().decode(out.stdout).trim().split('\n').at(-1)!
}

let call = async (path: string, init: RequestInit = {}): Promise<Response> => {
  for (let tries = 0;; tries++) {
    let res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${auth}` },
    })
    if (res.status == 401 && tries < 2) {
      await res.body?.cancel()
      await signed()
      continue
    }
    if ((res.status == 429 || res.status >= 500) && tries < 10) {
      await res.body?.cancel()
      let told = Number(res.headers.get('retry-after'))
      let wait = told > 0 ? told * 1000 : Math.min(60_000, 1000 * 2 ** tries)
      await new Promise((go) => setTimeout(go, wait))
      continue
    }
    return res
  }
}

let object = (key: string) => `/objects/${encodeURIComponent(key)}`
let read = async (key: string) => {
  let res = await call(object(key))
  if (res.status == 404) {
    await res.body?.cancel()
    return null
  }
  if (!res.ok) throw new Error(`GET ${key}: ${res.status} ${await res.text()}`)
  return new Uint8Array(await res.arrayBuffer())
}
let bucket = { read } as unknown as Objects

let indexes = async () => {
  let keys: string[] = []
  let cursor = ''
  do {
    let q = `?per_page=1000${cursor && `&cursor=${encodeURIComponent(cursor)}`}`
    let res = await call(`/objects${q}`)
    if (!res.ok) throw new Error(`list: ${res.status} ${await res.text()}`)
    let page = await res.json()
    keys.push(...page.result.map((o: { key: string }) => o.key))
    cursor = page.result_info?.is_truncated ? page.result_info.cursor : ''
  } while (cursor)
  return keys.filter((key) =>
    /^[^/]+\/\.releases\/[^/]+\/[^/]+\.json$/.test(key)
  )
}

// The packed index names what the old one did, and each text is the bytes
// at its key.
let same = (was: Index, now: Index) =>
  Object.keys(was).length == Object.keys(now).length &&
  Object.entries(was).every(([path, file]) =>
    now[path]?.key == file.key && now[path]?.sha == file.sha
  )

await signed()
let keys = await indexes()
console.log(`${keys.length} release indexes`)
let tally = { packed: 0, unchanged: 0, missing: 0, texts: 0, bytes: 0 }
let next = 0
let run = async () => {
  while (next < keys.length) {
    let key = keys[next++]
    let bytes = await read(key)
    if (!bytes) {
      tally.missing++
      continue
    }
    let was = decode(bytes)
    let plain = Object.fromEntries(
      Object.entries(was).map(([path, { key, sha }]) => [path, { key, sha }]),
    )
    let now = await packed(bucket, plain)
    let out = encode(now)
    if (new TextDecoder().decode(out) == new TextDecoder().decode(bytes)) {
      tally.unchanged++
      continue
    }
    if (!same(was, now)) {
      throw new Error(`${key}: the packed index moved a path`)
    }
    let texts = Object.values(now).filter((file) => file.text != null)
    tally.packed++
    tally.texts += texts.length
    tally.bytes += out.byteLength - bytes.byteLength
    if (!write) continue
    let res = await call(object(key), { method: 'PUT', body: out })
    if (!res.ok) {
      throw new Error(`PUT ${key}: ${res.status} ${await res.text()}`)
    }
    await res.body?.cancel()
    let back = await read(key)
    if (!back || !same(was, decode(back))) {
      throw new Error(`${key}: reread differs`)
    }
  }
}
await Promise.all(Array.from({ length: 4 }, run))
console.log(write ? 'wrote' : 'would write', tally)
