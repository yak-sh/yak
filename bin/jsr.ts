#!/usr/bin/env -S deno run --allow-read --allow-net=api.jsr.io --allow-env=JSR_TOKEN
// bin/jsr — the @yaks/* package PAGES on jsr.io, written from this repo.
//
// `deno publish` uploads code; it never touches a package's page. JSR's config
// reference (https://jsr.io/docs/package-configuration) has no `description`
// and no `runtimeCompat` key — both live behind the Settings tab or the API,
// which is why every published @yaks/* package still reads
// `"description":"","runtimeCompat":{}`. This is that Settings tab, run from
// the workspace, so the page says what the repo already knows.
//
//   deno task jsr                    # dry run: every page, what would move
//   deno task jsr @yaks/graph        # one package
//   deno task jsr --apply            # write it
//   deno task jsr --apply --create   # and mint the pages JSR has no row for
//
// Reading is anonymous. Writing needs a JSR personal access token in
// JSR_TOKEN, minted at https://jsr.io/account/tokens.
//
// PATCH takes ONE field per request — the API's UpdatePackageRequest is a
// oneOf (https://api.jsr.io/.well-known/openapi) — so an edit here is a field
// and a value, and a package with three stale fields is three requests.
import { configs } from './release.ts'

export let API = 'https://api.jsr.io'
export let TOKENS = 'https://jsr.io/account/tokens'

// The one repository every @yaks/* package is cut from. Spelled out rather
// than read from `git remote`, because a workspace is a repository and asking
// git would buy a --allow-run for an answer that cannot differ per package.
export let REPO = { owner: 'yak-sh', name: 'yak' }

// JSR's UpdatePackageRequest caps a description at `^.{0,250}$` — 250
// characters, and `.` does not match a newline.
export let DESC_MAX = 250

export type Repo = { owner: string; name: string }

export type Compat = {
  browser?: boolean
  deno?: boolean
  node?: boolean
  workerd?: boolean
  bun?: boolean
}

// The fields of JSR's Package that this repo owns. The rest of the row —
// score, the counts, the dates, isArchived, readmeSource — belongs to JSR or
// to a human, and is never written from here.
export type Details = {
  description: string
  githubRepository: Repo | null
  runtimeCompat: Compat
}

export let BLANK: Details = {
  description: '',
  githubRepository: null,
  runtimeCompat: {},
}

/// split('@yaks/graph') -> { scope: 'yaks', pkg: 'graph' }
/// split('@yaks/durable-object') -> { scope: 'yaks', pkg: 'durable-object' }
export let split = (name: string) => {
  let [, scope, pkg] = /^@([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(name) ?? []
  if (!pkg) throw new Error(`not a JSR package name: ${name}`)
  return { scope, pkg }
}

/// fits('a module for formatting strings') -> true
/// fits('x'.repeat(251)) -> false
/// fits('two\nlines') -> false
export let fits = (description: string) =>
  description.length <= DESC_MAX && !description.includes('\n')

// What the repo PROVES about a runtime, never what it hopes. A `browser.json`
// or `workers.json` beside a package's deno.json is the platform program
// bin/check-platform.ts typechecks in CI, so carrying one is a gate rather
// than a claim, and every package is checked and tested under Deno. Node and
// Bun stay absent on purpose: nothing here runs them, and JSR reads an absent
// key as "unknown support", which is the true answer.
//
// Grepping sources for `Deno.` is deliberately NOT the probe. Five
// browser-proven packages (blob, context, git, openai, session) mention it in
// a file outside their published mod.ts graph, so the grep would call them
// browser-hostile while CI compiles them for the browser every run.
/// compat({ browser: true, workers: false }) -> { deno: true, browser: true }
/// compat({ browser: false, workers: true }) -> { deno: true, workerd: true }
/// compat({ browser: false, workers: false }) -> { deno: true }
export let compat = (
  proof: { browser: boolean; workers: boolean },
): Compat => ({
  deno: true,
  ...(proof.browser ? { browser: true } : {}),
  ...(proof.workers ? { workerd: true } : {}),
})

// A package's page as the repo says it should read. The description is the
// package's own `description` in deno.json — JSR does not read that field, so
// carrying it here is the whole point.
export let want = (
  config: { name: string; description?: string },
  proof: { browser: boolean; workers: boolean },
): Details => {
  let description = config.description ?? ''
  if (!fits(description)) {
    throw new Error(
      `${config.name}: description must be one line of at most ${DESC_MAX} characters`,
    )
  }
  return { description, githubRepository: REPO, runtimeCompat: compat(proof) }
}

// The live row narrowed to the fields above: JSR answers githubRepository with
// an id and timestamps beside the owner and name, and may spell an unknown
// runtime as an explicit null, which means the same thing as leaving it out.
/// mine({ description: 'x', githubRepository: null, runtimeCompat: {} }) -> { description: 'x', githubRepository: null, runtimeCompat: {} }
export let mine = (page: Record<string, unknown>): Details => {
  let repo = page.githubRepository as Repo | null
  return {
    description: (page.description as string) ?? '',
    githubRepository: repo ? { owner: repo.owner, name: repo.name } : null,
    runtimeCompat: Object.fromEntries(
      Object.entries((page.runtimeCompat as Compat) ?? {})
        .filter(([, on]) => on != null),
    ),
  }
}

// Every value compared here is a string, a null, or ONE flat object of scalars
// (a repo, a compat), so sorting the top-level entries is the whole of it.
let canon = (value: unknown) =>
  value && typeof value == 'object'
    ? JSON.stringify(
      Object.entries(value).sort(([a], [b]) => a < b ? -1 : 1),
    )
    : JSON.stringify(value)

export type Edit = { field: keyof Details; value: unknown }

/// diff({ ...BLANK, description: 'a' }, BLANK) -> [{ field: 'description', value: 'a' }]
/// diff(BLANK, BLANK) -> []
export let diff = (want: Details, have: Details): Edit[] =>
  (Object.keys(want) as (keyof Details)[])
    .filter((field) => canon(want[field]) != canon(have[field]))
    .map((field) => ({ field, value: want[field] }))

export type Pkg = { name: string; dir: string; want: Details }

export type Plan = { name: string; have: Details | null; edits: Edit[] }

/// plan({ name: '@yaks/x', dir: '.', want: BLANK }, null) -> { name: '@yaks/x', have: null, edits: [] }
export let plan = (pkg: Pkg, have: Details | null): Plan => ({
  name: pkg.name,
  have,
  edits: diff(pkg.want, have ?? BLANK),
})

/// show('hi') -> '"hi"'
/// show('') -> 'none'
/// show(null) -> 'none'
/// show({ owner: 'yak-sh', name: 'yak' }) -> 'yak-sh/yak'
/// show({ deno: true, browser: true }) -> 'deno, browser'
/// show({}) -> 'none'
export let show = (value: unknown) => {
  if (value == null || value === '') return 'none'
  if (typeof value == 'string') return JSON.stringify(value)
  let fields = value as Record<string, unknown>
  if (typeof fields.owner == 'string') return `${fields.owner}/${fields.name}`
  let on = Object.keys(fields).filter((key) => fields[key])
  return on.length ? on.join(', ') : 'none'
}

// One package's verdict: a headline, then a line per field that moves, the
// page's current value on the left. `new` is a package JSR has no row for.
/// lines({ name: '@yaks/x', have: BLANK, edits: [] }) -> ['ok   @yaks/x']
export let lines = ({ name, have, edits }: Plan) => {
  let mark = !have ? 'new ' : edits.length ? 'set ' : 'ok  '
  let old = have ?? BLANK
  return [
    `${mark} ${name}`,
    ...edits.map((e) =>
      `       ${e.field}: ${show(old[e.field])} -> ${show(e.value)}`
    ),
  ]
}

// Every workspace member that is a JSR package. bin/release.ts already knows
// which members carry a deno.json; a member without a `name` (workers/yak is
// an npm-only member) has no package page.
export let packages = async (root = '.'): Promise<Pkg[]> => {
  let out: Pkg[] = []
  for (let path of await configs(root)) {
    let config = JSON.parse(await Deno.readTextFile(path))
    if (!config.name) continue
    let dir = path.slice(0, path.lastIndexOf('/'))
    out.push({
      name: config.name,
      dir,
      want: want(config, {
        browser: await there(`${dir}/browser.json`),
        workers: await there(`${dir}/workers.json`),
      }),
    })
  }
  return out
}

let there = (path: string) => Deno.stat(path).then(() => true, () => false)

export type Fetch = typeof fetch

let headers = (token?: string) => ({
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
})

let fail = async (what: string, res: Response) => {
  throw new Error(`${what}: ${res.status} ${(await res.text()).trim()}`)
}

// The page JSR holds, or null when the package has no row yet. Anonymous: GET
// is the one door here that needs no token.
export let read = async (get: Fetch, name: string) => {
  let { scope, pkg } = split(name)
  let res = await get(`${API}/scopes/${scope}/packages/${pkg}`)
  if (res.status == 404) return (await res.body?.cancel(), null)
  if (!res.ok) await fail(`GET ${name}`, res)
  return mine(await res.json())
}

// One field, one request — UpdatePackageRequest is a oneOf.
export let write = async (
  get: Fetch,
  token: string,
  name: string,
  edit: Edit,
) => {
  let { scope, pkg } = split(name)
  let res = await get(`${API}/scopes/${scope}/packages/${pkg}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ [edit.field]: edit.value }),
  })
  if (!res.ok) await fail(`PATCH ${name} ${edit.field}`, res)
  await res.body?.cancel()
}

// A scope may create 20 packages in a rolling 7 days
// (https://jsr.io/docs/quotas-and-limits); past that JSR answers 400 and the
// cure is a week or a word to quotas@jsr.io.
export let mint = async (get: Fetch, token: string, name: string) => {
  let { scope, pkg } = split(name)
  let res = await get(`${API}/scopes/${scope}/packages`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ package: pkg }),
  })
  if (!res.ok) await fail(`POST ${name}`, res)
  await res.body?.cancel()
}

export let main = async (args = Deno.args, get = fetch, root = '.') => {
  let apply = args.includes('--apply')
  let create = args.includes('--create')
  let named = args.filter((arg) => !arg.startsWith('-'))
  let token = Deno.env.get('JSR_TOKEN')
  if (apply && !token) {
    console.error(`JSR_TOKEN is not set. Mint one at ${TOKENS}.`)
    return 1
  }

  let all = await packages(root)
  let pkgs = named.length ? all.filter((pkg) => named.includes(pkg.name)) : all
  if (!pkgs.length) {
    console.error(`no workspace package named ${named.join(' ') || '(any)'}`)
    return 1
  }

  let plans = await Promise.all(
    pkgs.map(async (pkg) => plan(pkg, await read(get, pkg.name))),
  )
  for (let p of plans) for (let l of lines(p)) console.log(l)

  let fresh = plans.filter((p) => !p.have)
  let stale = plans.filter((p) => p.have && p.edits.length)
  console.log(
    `\n${plans.length} packages: ${stale.length} to update, ${fresh.length} not on JSR`,
  )
  if (!apply) {
    console.log(
      `dry run — pass --apply to write${
        fresh.length && !create ? ', --create to mint the missing pages' : ''
      }`,
    )
    return 0
  }

  let wrote = 0
  for (let p of [...stale, ...(create ? fresh : [])]) {
    if (!p.have) await mint(get, token!, p.name)
    for (let edit of p.edits) await write(get, token!, p.name, edit)
    console.log(`wrote ${p.name}`)
    wrote++
  }
  console.log(`${wrote} updated`)
  return 0
}

if (import.meta.main) Deno.exit(await main())
