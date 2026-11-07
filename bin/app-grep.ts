#!/usr/bin/env -S deno run --allow-net=api.cloudflare.com --allow-read --allow-write --allow-env=HOME,XDG_CACHE_HOME --allow-run=op,rg
// bin/app-grep — ripgrep over every yaks app's files, live and kept.
//
//   deno task app-grep [rg flags] PATTERN [sha/<sha> | space/.releases/...]
//
// Each match prints as `sha/<sha>:line: text` for an app's bytes, or as the
// key it matched under for anything else. A path after the pattern narrows the
// search, as it would for rg.
//
// An app's files are objects in the R2 bucket yak-blobs, stored once for the
// whole bucket under their SHA-256 at `sha/<sha>` (workers/yak/versions.ts
// `addressed`). A release's index, `<space>/.releases/<app eid>/<uuid>.json`,
// names which sha each path is, and `<space>/.declarations/<app eid>/` holds
// the words each deploy declared (declaration.ts); a draft's paths are the
// directory's `written` rows (written.ts), and every version's are its
// `deploy.files`. So a sha match is code that a draft, a release or a kept
// version holds. The rest of the bucket is not an app's code: what people
// uploaded (`<space>/.apps/<app eid>/blobs/`), the registry packages apps
// depend on (`__packages/`, shared.ts), and the objects under `git/`
// (gitobj.ts), which name the same bytes again.
//
// It reads production and never writes to it: the token is 1Password's
// "cloudflare user read-only", and the only calls are listings and gets. The
// copies live under ~/.cache/yak-apps and are kept between runs. Each run
// lists only what it mirrors, at once: `sha/` as sixteen listings, one per
// first hex digit, and each space's `.releases/` and `.declarations/`. A
// listing of the whole bucket, uploads and packages included, took 31 s of
// serial pages on its own. A run then gets only the keys whose etag moved (a
// sha's never does), removes every copy of a key the bucket no longer has,
// and hands the rest to rg.

let ACCOUNT = '0f9613dfd3f0451df0bd0f12a1372ea3' // workers/yak/wrangler.toml
let BUCKET = 'yak-blobs' // the BLOBS binding in workers/yak/wrangler.toml
let TOKEN = 'op://Yak Shaving LLC/cloudflare user read-only/credential'
let API =
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/r2/buckets/${BUCKET}`

let cache = Deno.env.get('XDG_CACHE_HOME') ?? `${Deno.env.get('HOME')}/.cache`
export let MIRROR = `${cache}/yak-apps`
let FILES = `${MIRROR}/files`
let ETAGS = `${MIRROR}/etags.json`
// How many calls a run has open at once.
let WIDTH = 16

export type Obj = { key: string; etag: string }
export type Etags = Record<string, string>

let HEX = [...'0123456789abcdef']

// What a run lists, given the bucket's top-level prefixes (`jeff/`, `sha/`):
// the kept bytes, and each space's release indexes and declarations. A
// top-level prefix that is not a space is the platform's.
export let prefixes = (top: string[]) => [
  ...HEX.map((h) => `sha/${h}`),
  ...top.filter((p) => !/^(\.|sha\/|git\/|__packages\/)/.test(p))
    .flatMap((space) => [`${space}.releases/`, `${space}.declarations/`]),
]

// Bytes a kept version names.
export let isKept = (key: string) => /^sha\/[0-9a-f]{64}$/.test(key)

// A key that names a place under the mirror, never above it.
export let isPlace = (key: string) =>
  !key.split('/').some((p) => p == '' || p == '.' || p == '..')

// The keys a run gets: new since the last run, or moved. A kept key's bytes
// never move, so a copy of it on disk is all it needs; any other copy is right
// while the etag it was got at is the bucket's.
export let stale = (objs: Obj[], had: Etags, held: Set<string>) =>
  objs.filter((o) => isKept(o.key) ? !held.has(o.key) : had[o.key] != o.etag)

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

// The API answers 429 past its pace (1,200 calls in five minutes), which a
// cold mirror of every app outruns: a throttled call says so, waits as long as
// it is told, or a doubling pause, and asks again.
let get = async (auth: string, path: string) => {
  let res: Response
  for (let tries = 0;; tries++) {
    res = await fetch(`${API}${path}`, {
      headers: { authorization: `Bearer ${auth}` },
    })
    if (res.status != 429 || tries == 10) break
    await res.body?.cancel()
    let told = Number(res.headers.get('retry-after'))
    let wait = told > 0 ? told * 1000 : Math.min(60_000, 1000 * 2 ** tries)
    console.error(`app-grep: throttled, asking again in ${wait / 1000} s`)
    await new Promise((go) => setTimeout(go, wait))
  }
  if (!res.ok) {
    throw new Error(
      `GET ${path}: ${res.status} ${(await res.text()).slice(0, 300)}`,
    )
  }
  return res
}

// Runs `go` on every item, `n` at a time.
let pooled = async <T>(items: T[], n: number, go: (t: T) => Promise<void>) => {
  let todo = [...items]
  let work = async () => {
    for (let t; (t = todo.pop()) !== undefined;) await go(t)
  }
  await Promise.all(Array.from({ length: n }, work))
}

// The objects under a prefix, and the prefixes a delimiter folds them into.
let listing = async (auth: string, prefix: string, delimiter = '') => {
  let objs: Obj[] = []
  let folded: string[] = []
  let cursor = ''
  do {
    let q = new URLSearchParams({ per_page: '1000' })
    if (prefix) q.set('prefix', prefix)
    if (delimiter) q.set('delimiter', delimiter)
    if (cursor) q.set('cursor', cursor)
    let page = await (await get(auth, `/objects?${q}`)).json()
    objs.push(...page.result.map(({ key, etag }: Obj) => ({ key, etag })))
    folded.push(...page.result_info?.delimited ?? [])
    cursor = page.result_info?.is_truncated ? page.result_info.cursor : ''
  } while (cursor)
  return { objs, folded }
}

let listed = async (auth: string) => {
  let { folded } = await listing(auth, '', '/')
  let objs: Obj[] = []
  await pooled(prefixes(folded), WIDTH, async (p) => {
    objs.push(...(await listing(auth, p)).objs)
  })
  return objs.filter((o) =>
    o.key.startsWith('sha/') ? isKept(o.key) : isPlace(o.key)
  )
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

// Every copy on disk, by its key.
let copies = async function* (root: string, at = ''): AsyncGenerator<string> {
  for await (let e of Deno.readDir(`${root}/${at}`)) {
    let key = at ? `${at}/${e.name}` : e.name
    if (e.isDirectory) yield* copies(root, key)
    else yield key
  }
}

// Removes a copy, and each directory above it left empty.
let removed = async (key: string) => {
  await Deno.remove(`${FILES}/${key}`)
  for (let at = key; (at = at.slice(0, at.lastIndexOf('/')));) {
    if (await Deno.remove(`${FILES}/${at}`).then(() => false, () => true)) {
      break
    }
  }
}

// Brings the copies up to the bucket: removes every copy no listing names,
// then gets what is stale. A key that fails is never recorded at its new etag,
// so the next run tries it again.
let synced = async () => {
  let auth = await token()
  let had = read()
  let held = new Set<string>()
  let [objs] = await Promise.all([
    listed(auth),
    (async () => {
      for await (let key of copies(FILES)) held.add(key)
    })(),
  ])
  let named = new Set(objs.map((o) => o.key))
  let dropped = [...held].filter((key) => !named.has(key))
  for (let key of dropped) await removed(key)
  for (let key in had) if (!named.has(key) || isKept(key)) delete had[key]
  let todo = stale(objs, had, held)
  let failed = 0
  await pooled(todo, WIDTH, async (o) => {
    try {
      await copied(auth, o)
      if (!isKept(o.key)) had[o.key] = o.etag
    } catch (e) {
      failed++
      console.error(`app-grep: ${o.key}: ${e instanceof Error ? e.message : e}`)
    }
  })
  Deno.writeTextFileSync(ETAGS, JSON.stringify(had))
  console.error(
    `app-grep: ${objs.length} files, ${todo.length - failed} fetched, ` +
      `${dropped.length} removed${failed ? `, ${failed} failed` : ''}`,
  )
}

let main = async () => {
  if (!Deno.args.length) {
    console.error(
      'usage: deno task app-grep [rg flags] PATTERN [sha/<sha> | path...]',
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
