#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-run --allow-net=api.jsr.io
// bin/release — publish what changed, so a fix in one package ships at once.
//
// A release publishes the packages whose published files changed since the
// newest version JSR holds of them, and a package JSR does not have yet only
// once something the release publishes imports it. Each moves to the release's
// version; every other package is written at the version JSR holds, so a
// publish that stopped partway leaves nothing behind that a later release
// counts as changed. `deno publish` writes an import of a sibling as
// `jsr:@yaks/x@^<its version>`, so a package left where it is already
// resolves a sibling the release moves: a dependent moves too only when the
// release takes a package it imports past that range (0.2.x to 0.3.0).
//
//   bin/release.ts plan          # what the next patch release would publish, and why
//   bin/release.ts plan 0.3.0    # what that release would publish
//   bin/release.ts 0.2.18        # write the versions, commit, land and tag
//
// It writes the versions and every package a CLI of the release may load, at
// the version it loads (`LIST`, which @yaks/cli ships), commits them in the
// linked worktree it runs in, and lands that commit the way `yak land` does
// (@yaks/git/land): main moves and is pushed only under the shared checkout's
// land lock, so a release never races a landing. It tags the commit that
// landed once origin holds it, and does not publish.
// It refuses to cut a release while a package it would publish has no page on
// jsr.io (`unlisted`): CI publishes under GitHub's identity, which JSR accepts
// only for a package that exists and is linked to this repository, so such a
// package would stop the publish partway, and a version cannot be unpublished.
// Pushing the tag is the deliberate act that starts a publish:
//
//   git push origin v0.2.18

import { matchesGlob } from 'node:path'
import { newest, read, REPO, row } from './jsr.ts'
import { versioned, versions } from './release-packages.ts'
import { members } from '@yaks/cli/dependencies'
import { land } from '@yaks/git/land'
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

/** The package that ships `LIST`. */
export let CARRIER = '@yaks/cli'

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

/** A member as a release weighs it: whether JSR has a page for it, the newest
 * version JSR holds of it, whether its published files changed since that
 * version (none held counts as changed), and the members it imports. */
export type Member = {
  name: string
  published: boolean
  held: string | null
  changed: boolean
  deps: string[]
}

let numbers = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number)

/** Whether `^from`, the range `deno publish` writes for an import of a sibling
 * at `from`, takes `to`: the same numbers up to and including the first that
 * is not zero.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(caret('0.2.17', '0.2.25'), true)
 * assertEquals(caret('0.2.17', '0.3.0'), false)
 * assertEquals(caret('1.2.0', '1.9.0'), true)
 * assertEquals(caret('0.0.3', '0.0.4'), false)
 * ```
 */
export let caret = (from: string, to: string) => {
  let [a, b] = [numbers(from), numbers(to)]
  let lead = a.findIndex((n) => n != 0)
  return a.slice(0, lead < 0 ? 3 : lead + 1).every((n, i) => n == b[i])
}

/** The patch release after the newest of `versions`.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(following(['0.2.17', '0.2.24', '0.2.9']), '0.2.25')
 * ```
 */
export let following = (versions: string[]) => {
  let [x, y, z] = versions.map(numbers).reduce((a, b) => {
    let i = a.findIndex((n, i) => n != b[i])
    return i < 0 || a[i] > b[i] ? a : b
  })
  return `${x}.${y}.${z + 1}`
}

/** The packages a release at `version` publishes: the published ones that
 * changed, `carrier` with them (it ships the release's list and the pages a
 * fresh install serves, which every release rewrites), a published one
 * importing a package it moves past the range that import was published with,
 * and an unpublished one only once a package it publishes imports it.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let m = (name: string, deps: string[], changed = false, published = true) =>
 *   ({ name, held: published ? '0.1.0' : null, published, changed, deps })
 * let all = [
 *   m('sqlite', [], true),
 *   m('cli', ['sqlite']),
 *   m('fp', []),
 *   m('voice', ['fp'], true, false),
 * ]
 * assertEquals(pick(all, '0.1.1'), ['sqlite'])
 * assertEquals(pick(all, '0.2.0'), ['cli', 'sqlite'])
 * assertEquals(pick(all, '0.1.1', 'fp'), ['fp', 'sqlite'])
 * assertEquals(pick([m('fp', [])], '0.1.1', 'fp'), [])
 * assertEquals(pick([
 *   m('mail', ['resend'], true),
 *   m('resend', [], true, false),
 * ], '0.1.1'), ['mail', 'resend'])
 * ```
 */
export let pick = (
  all: Member[],
  version: string,
  carrier = CARRIER,
): string[] => {
  let out = new Set(
    all.filter((m) => m.published && m.changed).map((m) => m.name),
  )
  if (out.size && all.some((m) => m.name == carrier)) out.add(carrier)
  let held = new Map(all.map((m) => [m.name, m.held]))
  let past = (dep: string) => {
    let at = held.get(dep)
    return out.has(dep) && at != null && !caret(at, version)
  }
  let pulls = (m: Member) =>
    m.published
      ? m.deps.some(past)
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

// Whether a member's published files moved since the release that tagged
// `version`. A version no tag names is weighed as changed.
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

/** Every publishing member, weighed against JSR and the tag of the newest
 * version JSR holds of it. */
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
      let page = await row(get, name)
      let held = page && newest(page)
      return {
        name,
        published: page != null,
        held,
        changed: held == null ||
          await moved(root, dir, held, config.publish?.exclude ?? [], names),
        deps: Object.keys(config.dependencies ?? {}).filter((d) =>
          names.has(d)
        ),
      }
    }),
  )
}

/** What a release at `version` would publish today, said as lines: by
 * default the patch release after the newest version JSR holds. */
export let plan = async (
  root = '.',
  get: typeof fetch = fetch,
  version?: string,
) => {
  let all = await weigh(root, get)
  version ??= following(all.flatMap((m) => m.held ?? []))
  let picked = new Set(pick(all, version))
  let fresh = all.filter((m) => picked.has(m.name) && !m.published)
  let held = all.filter((m) => !m.published && !picked.has(m.name))
  let say = (ms: Member[]) => ms.map((m) => m.name).join(' ') || 'none'
  return [
    `v${version} publishes ${picked.size}: ${[...picked].join(' ')}`,
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
  let picked = pick(all, version)
  if (!picked.length) throw new Error('nothing changed since the last release')
  let missing = await unlisted(picked)
  if (missing.length) {
    throw new Error(
      `${missing.join(', ')}: no package on jsr.io yet. Create it there ` +
        `(deno task jsr --apply --create ${missing.join(' ')}) and link it ` +
        `to ${REPO.owner}/${REPO.name} in its settings, then release.`,
    )
  }
  let [dir, common] = (await git(
    root,
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
    '--git-common-dir',
  ) ?? '').trim().split('\n')
  if (dir == common) {
    throw new Error(
      'release from a linked worktree: main moves only by landing',
    )
  }
  let at = new Map(all.flatMap((m) => m.held ? [[m.name, m.held]] : []))
  for (let name of picked) at.set(name, version)
  let paths = await versions(root, at)
  await Deno.writeTextFile(`${root}/${LIST}`, list(at))
  await run('-C', root, 'add', ...paths, `${root}/${LIST}`)
  await run('-C', root, 'commit', '-m', `Release v${version}`)
  let landed = await landing(root)
  await run('-C', root, 'tag', `v${version}`, landed)
  console.log(`v${version}: ${picked.length} packages, landed and tagged.`)
  console.log(`push the tag to publish:  git push origin v${version}`)
}

// Land the release commit, rebasing as often as main moves under it: a
// version bump has no tests to re-run. Returns the sha main holds, once its
// upstream holds it too, so a tag never names a commit origin lacks.
let landing = async (root: string) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    let outcome = await land({ cwd: root })
    if ('diverged' in outcome) {
      if (outcome.conflict) {
        throw new Error(
          'the release commit conflicts with main: resolve it, ' +
            '`git rebase --continue`, then release again',
        )
      }
      continue
    }
    let sent = await git(
      outcome.root,
      'merge-base',
      '--is-ancestor',
      outcome.landed,
      'HEAD@{u}',
    )
    if (sent == null) {
      throw new Error(
        `${outcome.landed} landed but did not reach main's upstream: ` +
          'land again to publish it, then tag it',
      )
    }
    return outcome.landed
  }
  throw new Error('main kept moving through three landing attempts')
}

if (import.meta.main) {
  let [version, at] = Deno.args
  if (version == 'plan') {
    if (at && !semver(at)) throw new Error(`not a version: ${at} (want 0.1.0)`)
    for (let line of await plan('.', fetch, at)) console.log(line)
  } else if (version) {
    await release(version)
  } else {
    console.error(
      'usage: bin/release.ts plan [version] | <version>   e.g. 0.2.18',
    )
    Deno.exit(2)
  }
}
