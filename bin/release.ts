#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run=git,pnpm --allow-net=api.jsr.io
// bin/release — publish what changed, so a fix in one package ships at once.
//
// A release publishes the packages that changed since their published version,
// every published package that depends on one of those, and a package JSR does
// not have yet only once something the release publishes imports it. Each
// moves to the release's version; every other package keeps the version JSR
// already has. `deno publish` writes an import of a sibling as
// `jsr:@yaks/x@^<its version>`, so a package it publishes resolves both the
// siblings that move with it and the ones that stay.
//
//   bin/release.ts plan      # what a release would publish today, and why
//   bin/release.ts 0.2.18    # write the versions, commit and tag
//
// It writes the versions and every package a CLI of the release may load, at
// the version it loads (`LIST`, which @yaks/cli ships), then commits and tags:
// it does not push, and it does not publish.
// It refuses to cut a release while a package it would publish has no page on
// jsr.io (`unlisted`): CI publishes under GitHub's identity, which JSR accepts
// only for a package that exists and is linked to this repository, so such a
// package would stop the publish partway, and a version cannot be unpublished.
// Pushing the tag is the deliberate act that starts a publish:
//
//   git push origin main v0.2.18

import { matchesGlob } from 'node:path'
import { has, read, REPO } from './jsr.ts'
import { versioned, versions } from './release-packages.ts'
import { members } from '@yaks/cli/dependencies'
export { versioned } from './release-packages.ts'

// The first top-level `"version"` line of a manifest. A regex rather than
// JSON.parse/stringify because a rewrite must move one field and leave every
// other byte — key order, comments' absence, trailing newline — alone.
export let VERSION = /^(\s*"version"\s*:\s*")([^"]*)(")/m

/// bump('{\n  "version": "0.0.0"\n}', '0.1.0') -> '{\n  "version": "0.1.0"\n}'
/// bump('{\n  "name": "x"\n}', '0.1.0') -> '{\n  "name": "x"\n}'
export let bump = (json: string, version: string) =>
  json.replace(VERSION, `$1${version}$3`)

/// semver('0.1.0') -> true
/// semver('0.1.0-rc.1') -> true
/// semver('v0.1.0') -> false
/// semver('0.1') -> false
export let semver = (v: string) => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)

// Workspace members with JSR options (a deno.json); npm-only members have none.
export let configs = async (root = '.') => {
  let out: string[] = []
  for (let member of members(root)) {
    let path = `${root}/${member}/deno.json`.replace('/./', '/')
    if (await Deno.stat(path).then(() => true, () => false)) out.push(path)
  }
  return out
}

/** Runtime package metadata beside its JSR-only options. */
export let manifest = async (path: string) => ({
  ...JSON.parse(await Deno.readTextFile(path)),
  ...JSON.parse(
    await Deno.readTextFile(path.replace(/deno\.json$/, 'package.json')),
  ),
})

// The members `deno publish` publishes: a name, and no `"publish": false`.
export let publishing = async (
  root = '.',
): Promise<{ name: string; config: string }[]> => {
  let out: { name: string; config: string }[] = []
  for (let path of await configs(root)) {
    let config = await manifest(path)
    if (config.name && config.publish !== false) {
      out.push({ name: config.name, config: path })
    }
  }
  return out
}

// Where a release records every package it is made of, at its version, so a
// CLI from JSR loads each plugin at that version and exempts them from Deno's
// day-long wait (packages/cli/release.ts).
export let LIST = 'packages/cli/release.json'

/// list(new Map([['@yaks/web', '0.2.18'], ['@yaks/cli', '0.2.18']])) -> '{\n  "@yaks/cli": "0.2.18",\n  "@yaks/web": "0.2.18"\n}\n'
export let list = (at: Map<string, string>) =>
  JSON.stringify(
    Object.fromEntries([...at].toSorted(([a], [b]) => a < b ? -1 : 1)),
    null,
    2,
  ) + '\n'

/** The packages named that jsr.io has no page for. */
export let unlisted = async (
  names: string[],
  get: typeof fetch = fetch,
): Promise<string[]> => {
  let pages = await Promise.all(names.map((name) => read(get, name)))
  return names.filter((_, i) => pages[i] == null)
}

/** A member as a release weighs it: whether JSR has a page for it, whether it
 * changed since the version JSR holds (a version JSR lacks, as after a publish
 * that stopped partway, counts as changed), and the members it imports. */
export type Member = {
  name: string
  version: string
  published: boolean
  changed: boolean
  deps: string[]
}

/** The packages a release publishes: the published ones that changed, every
 * published one importing a package it publishes, and an unpublished one only
 * once a package it publishes imports it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let m = (name: string, deps: string[], changed = false, published = true) =>
 *   ({ name, version: '0.1.0', published, changed, deps })
 * assertEquals(pick([
 *   m('sqlite', [], true),
 *   m('cli', ['sqlite']),
 *   m('fp', []),
 *   m('voice', ['fp'], true, false),
 * ]), ['cli', 'sqlite'])
 * assertEquals(pick([
 *   m('mail', ['resend'], true),
 *   m('resend', [], true, false),
 * ]), ['mail', 'resend'])
 * ```
 */
export let pick = (all: Member[]): string[] => {
  let out = new Set(
    all.filter((m) => m.published && m.changed).map((m) => m.name),
  )
  let pulls = (m: Member) =>
    m.published
      ? m.deps.some((dep) => out.has(dep))
      : all.some((r) => out.has(r.name) && r.deps.includes(m.name))
  for (let grew = true; grew;) {
    grew = false
    for (let m of all) {
      if (out.has(m.name) || !pulls(m)) continue
      out.add(m.name)
      grew = true
    }
  }
  return [...out].toSorted()
}

/** Whether a changed file is one `deno publish` uploads. The manifests are not
 * weighed here: a release rewrites their versions (see `bare`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(uploaded('mod.ts', ['**\/*_test.ts']), true)
 * assertEquals(uploaded('sqlite_test.ts', ['**\/*_test.ts']), false)
 * assertEquals(uploaded('fixtures/a.db', ['fixtures/']), false)
 * assertEquals(uploaded('package.json', []), false)
 * ```
 */
export let uploaded = (file: string, exclude: string[]): boolean =>
  !MANIFESTS.includes(file) &&
  !exclude.some((glob) => {
    let g = glob.replace(/^\.\//, '')
    return g.endsWith('/') ? file.startsWith(g) : matchesGlob(file, g)
  })

let MANIFESTS = ['package.json', 'deno.json']

/** A manifest without what a release writes into it: its own version and the
 * versions of the members it depends on. Two manifests that differ only there
 * publish the same package.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let at = (version: string) => ({ name: '@yaks/a', version, dependencies: { '@yaks/b': version, yaml: '^2' } })
 * let names = new Set(['@yaks/a', '@yaks/b'])
 * assertEquals(bare(at('0.1.0'), names), bare(at('0.2.0'), names))
 * ```
 */
export let bare = (manifest: Record<string, unknown>, names: Set<string>) =>
  JSON.stringify(
    versioned(
      { ...manifest, version: '' },
      new Map([...names].map((name) => [name, ''])),
    ),
  )

let run = async (...args: string[]) => {
  let { code } = await new Deno.Command('git', { args }).spawn().status
  if (code) throw new Error(`git ${args.join(' ')} exited ${code}`)
}

let git = async (root: string, ...args: string[]) => {
  let { code, stdout } = await new Deno.Command('git', {
    args: ['-C', root, ...args],
    stdout: 'piped',
    stderr: 'null',
  }).output()
  return code ? null : new TextDecoder().decode(stdout)
}

// Whether a member's published files moved since the release that tagged its
// version. A version no tag names is weighed as changed.
let moved = async (
  root: string,
  dir: string,
  version: string,
  exclude: string[],
  names: Set<string>,
) => {
  let tag = `v${version}`
  let files = await git(
    root,
    'diff',
    '--name-only',
    '--no-renames',
    tag,
    'HEAD',
    '--',
    dir,
  )
  if (files == null) return true
  for (let path of files.split('\n').filter(Boolean)) {
    let file = path.slice(dir.length + 1)
    if (uploaded(file, exclude)) return true
    if (!MANIFESTS.includes(file)) continue
    let then = await git(root, 'show', `${tag}:${path}`)
    let now = await git(root, 'show', `HEAD:${path}`)
    if (then == null || now == null) return true
    if (bare(JSON.parse(then), names) != bare(JSON.parse(now), names)) {
      return true
    }
  }
  return false
}

/** Every publishing member, weighed against JSR and the tag of its version. */
export let weigh = async (
  root = '.',
  get: typeof fetch = fetch,
): Promise<Member[]> => {
  let all = await Promise.all(
    members(root).map(async (dir) => {
      let path = `${root}/${dir}/deno.json`
      if (!await Deno.stat(path).then(() => true, () => false)) return []
      let config = await manifest(path)
      return config.name && config.publish !== false ? [{ dir, config }] : []
    }),
  )
  let names = new Set(all.flat().map((m) => m.config.name as string))
  return await Promise.all(
    all.flat().map(async ({ dir, config }) => {
      let name = config.name as string
      let version = config.version as string
      let [page, held] = await Promise.all([
        read(get, name),
        has(get, name, version),
      ])
      return {
        name,
        version,
        published: page != null,
        changed: !held ||
          await moved(
            root,
            dir,
            version,
            config.publish?.exclude ?? [],
            names,
          ),
        deps: Object.keys(config.dependencies ?? {}).filter((d) =>
          names.has(d)
        ),
      }
    }),
  )
}

/** What a release would publish today, said as lines. */
export let plan = async (root = '.', get: typeof fetch = fetch) => {
  let all = await weigh(root, get)
  let picked = new Set(pick(all))
  let fresh = all.filter((m) => picked.has(m.name) && !m.published)
  let held = all.filter((m) => !m.published && !picked.has(m.name))
  let say = (ms: Member[]) => ms.map((m) => m.name).join(' ') || 'none'
  return [
    `publishes ${picked.size}: ${[...picked].join(' ')}`,
    `new on JSR: ${say(fresh)}`,
    `kept at their published version: ${
      say(all.filter((m) => m.published && !picked.has(m.name)))
    }`,
    `not published until something released imports it: ${say(held)}`,
    `the scope then holds ${
      all.filter((m) => m.published).length + fresh.length
    } packages`,
  ]
}

export let release = async (version: string, root = '.') => {
  if (!semver(version)) {
    throw new Error(`not a version: ${version} (want 0.1.0)`)
  }
  if (await git(root, 'rev-parse', '--verify', '--quiet', `v${version}`)) {
    throw new Error(`v${version} is already a release`)
  }
  let all = await weigh(root)
  let picked = pick(all)
  if (!picked.length) throw new Error('nothing changed since the last release')
  let missing = await unlisted(picked)
  if (missing.length) {
    throw new Error(
      `${missing.join(', ')}: no package on jsr.io yet. Create it there ` +
        `(deno task jsr --apply --create ${missing.join(' ')}) and link it ` +
        `to ${REPO.owner}/${REPO.name} in its settings, then release.`,
    )
  }
  let next = new Map(picked.map((name) => [name, version]))
  let paths = await versions(root, next)
  let loads = new Map(
    all.filter((m) => m.published).map((m) => [m.name, m.version]),
  )
  for (let [name, at] of next) loads.set(name, at)
  await Deno.writeTextFile(`${root}/${LIST}`, list(loads))
  await run('-C', root, 'add', ...paths, `${root}/${LIST}`)
  await run('-C', root, 'commit', '-m', `Release v${version}`)
  await run('-C', root, 'tag', `v${version}`)
  console.log(`v${version}: ${picked.length} packages, committed and tagged.`)
  console.log(`push it to publish:  git push origin main v${version}`)
}

if (import.meta.main) {
  let [version] = Deno.args
  if (version == 'plan') {
    for (let line of await plan()) console.log(line)
  } else if (version) {
    await release(version)
  } else {
    console.error('usage: bin/release.ts plan | <version>   e.g. 0.2.18')
    Deno.exit(2)
  }
}
