#!/usr/bin/env -S deno run --allow-net=api.cloudflare.com --allow-read --allow-write --allow-env=HOME,XDG_CACHE_HOME --allow-run=op,rg
// bin/app-grep — ripgrep over the current files of every yaks app.
//
//   deno task app-grep [rg flags] PATTERN [space/app/...]
//
// Each match prints as `space/app/path:line: text`. A path after the pattern
// narrows the search to one space or app, as it would for rg.
//
// An app's files are objects in the R2 bucket yak-blobs, keyed
// `<space>/<app>/<path>` (workers/yak/files.ts `prefixOf`, `keyed`). The bucket
// holds two more things, and neither is code: what people uploaded, at
// `<space>/<app>/blobs/<sha>` (apps.ts `blobKey`), and the platform's own
// content-addressed bytes, one segment under `sha/` and `git/` (versions.ts,
// gitobj.ts). Only the files are copied.
//
// It reads production and never writes to it: the token is 1Password's
// "cloudflare user read-only", and the only calls are a listing and a get. The
// copies live under ~/.cache/yak-apps and are kept between runs. Each run
// lists the bucket, gets only the keys whose etag moved, removes the copy of a
// key the bucket no longer has, and hands the rest to rg.

let ACCOUNT = '0f9613dfd3f0451df0bd0f12a1372ea3' // workers/yak/wrangler.toml
let BUCKET = 'yak-blobs' // the BLOBS binding in workers/yak/wrangler.toml
let TOKEN = 'op://Yak Shaving LLC/cloudflare user read-only/credential'
let API =
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}`

let cache = Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`
export let MIRROR = `${cache}/yak-apps`
let FILES = `${MIRROR}/files`
let ETAGS = `${MIRROR}/etags.json`

export type Obj = { key: string; etag: string }
export type Etags = Record<string, string>

let UPLOAD = /^blobs\/[0-9a-f]{64}$/

// An app's file: a space, an app and a path that names a place on disk, and
// not something a person uploaded.
export let isFile = (key: string) => {
  let parts = key.split('/')
  return parts.length >= 3 &&
    !parts.some((p) => p == '' || p == '.' || p == '..') &&
    !UPLOAD.test(parts.slice(2).join('/'))
}

// The keys a run gets: new since the last run, or moved.
export let stale = (objs: Obj[], had: Etags) =>
  objs.filter((o) => had[o.key] != o.etag)

// The copies whose key the bucket no longer has.
export let gone = (objs: Obj[], had: Etags) => {
  let now = new Set(objs.map((o) => o.key))
  return Object.keys(had).filter((k) => !now.has(k))
}

// rg separates a match's fields with NUL (`--field-match-separator`), so a
// path holding a colon cannot be misread; the answer reads `path:line: text`.
export let shown = (line: string) => {
  let f = line.split('\0')
  return f.length < 3 ? f.join(':') : `${f.slice(0, -1).join(':')}: ${f.at(-1)}`
}

let token = async () => {
  let out = await new Deno.Command('op', { args: ['read', TOKEN] }).output()
  if (!out.success) throw new Error(`op read failed: ${TOKEN}`)
  return new TextDecoder().decode(out.stdout).trim()
}

let get = async (auth: string, path: string) => {
  let res = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${auth}` },
  })
  if (!res.ok) {
    throw new Error(
      `GET ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`,
    )
  }
  return res
}

let listed = async (auth: string) => {
  let objs: Obj[] = []
  let cursor = ''
  do {
    let q = `?per_page=1000${cursor && `&cursor=${encodeURIComponent(cursor)}`}`
    let page = await (await get(auth, `/objects${q}`)).json()
    objs.push(...page.result.map(({ key, etag }: Obj) => ({ key, etag })))
    cursor = page.result_info?.is_truncated ? page.result_info.cursor : ''
  } while (cursor)
  return objs.filter((o) => isFile(o.key))
}

let copied = async (auth: string, o: Obj) => {
  let res = await get(auth, `/objects/${encodeURIComponent(o.key)}`)
  let path = `${FILES}/${o.key}`
  await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await Deno.writeFile(path, new Uint8Array(await res.arrayBuffer()))
}

let read = (): Etags => {
  try {
    return JSON.parse(Deno.readTextFileSync(ETAGS))
  } catch {
    return {}
  }
}

// Brings the copies up to the bucket. A key that fails is never recorded at
// its new etag, so the next run tries it again.
let synced = async () => {
  let auth = await token()
  let had = read()
  let objs = await listed(auth)
  let todo = stale(objs, had)
  let failed = 0
  let work = async () => {
    for (let o; (o = todo.pop());) {
      try {
        await copied(auth, o)
        had[o.key] = o.etag
      } catch (e) {
        failed++
        console.error(
          `app-grep: ${o.key}: ${e instanceof Error ? e.message : e}`,
        )
      }
    }
  }
  let fetched = todo.length
  await Promise.all(Array.from({ length: 8 }, work))
  let dropped = gone(objs, had)
  for (let key of dropped) {
    await Deno.remove(`${FILES}/${key}`).catch(() => {})
    delete had[key]
  }
  Deno.writeTextFileSync(ETAGS, JSON.stringify(had))
  console.error(
    `app-grep: ${objs.length} files, ${fetched - failed} fetched, ` +
      `${dropped.length} removed${failed ? `, ${failed} failed` : ''}`,
  )
}

let main = async () => {
  if (!Deno.args.length) {
    console.error(
      'usage: deno task app-grep [rg flags] PATTERN [space/app/...]',
    )
    Deno.exit(2)
  }
  await Deno.mkdir(FILES, { recursive: true })
  await synced()
  let rg = new Deno.Command('rg', {
    args: [
      '--no-heading',
      '--with-filename',
      '--line-number',
      '--hidden',
      '--no-ignore',
      '--color=never',
      '--field-match-separator=\\x00',
      ...Deno.args,
    ],
    cwd: FILES,
    stdin: 'null',
    stdout: 'piped',
  }).spawn()
  let rest = ''
  for await (let chunk of rg.stdout.pipeThrough(new TextDecoderStream())) {
    let lines = (rest + chunk).split('\n')
    rest = lines.pop() ?? ''
    for (let line of lines) console.log(shown(line))
  }
  if (rest) console.log(shown(rest))
  Deno.exit((await rg.status).code)
}

if (import.meta.main) await main()
