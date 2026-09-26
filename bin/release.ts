#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run=git --allow-net=api.jsr.io
// bin/release — one version across the whole @yaks/* family, in one commit.
//
// The packages are one library cut into thirty files' worth of doors; a
// consumer that pins @yaks/graph and @yaks/sqlite at different versions is
// pinning two halves of the same release. So there is no per-package version
// to reason about: every workspace member carrying a `version` moves together,
// and the tag `v<version>` is what CI publishes (.github/workflows/publish.yml).
//
// Versions are 0.0.0 today, which JSR reads as unreleased; the first release
// is `bin/release.ts 0.1.0`.
//
//   deno run --allow-read --allow-write --allow-run=git --allow-net=api.jsr.io \
//     bin/release.ts 0.1.0
//
// It writes the version, and the list of packages the release publishes
// (`LIST`, which @yaks/cli ships), then commits and tags — it does not push,
// and it does not publish.
// It refuses to cut a release while a package it would publish has no page on
// jsr.io (`unlisted`): CI publishes under GitHub's identity, which JSR accepts
// only for a package that exists and is linked to this repository, so such a
// package would stop the publish partway, and a version cannot be unpublished.
// Pushing the tag is the deliberate act that starts a publish:
//
//   git push origin main v0.1.0

import { read, REPO } from './jsr.ts'

// The first top-level `"version"` line of a deno.json. A regex rather than
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

// The workspace members that are publishable packages: a member with no
// deno.json (workers/yak is an npm-only member) has no version to move.
export let configs = async (root = '.') => {
  let { workspace = [] } = JSON.parse(
    await Deno.readTextFile(`${root}/deno.json`),
  )
  let out: string[] = []
  for (let member of workspace as string[]) {
    let path = `${root}/${member}/deno.json`.replace('/./', '/')
    if (await Deno.stat(path).then(() => true, () => false)) out.push(path)
  }
  return out
}

// The members `deno publish` publishes: a name, and no `"publish": false`.
let publishing = async (root = '.'): Promise<string[]> => {
  let out: string[] = []
  for (let path of await configs(root)) {
    let config = JSON.parse(await Deno.readTextFile(path))
    if (config.name && config.publish !== false) out.push(config.name)
  }
  return out
}

// Where a release records the packages it publishes, so whatever resolves it
// from JSR exempts them from Deno's day-long wait (packages/cli/release.ts).
export let LIST = 'packages/cli/release.json'

/// list(['@yaks/web', '@yaks/cli']) -> '[\n  "@yaks/cli",\n  "@yaks/web"\n]\n'
export let list = (names: string[]) =>
  JSON.stringify(names.toSorted(), null, 2) + '\n'

/** The packages a release would publish that jsr.io has no page for. */
export let unlisted = async (
  root = '.',
  get: typeof fetch = fetch,
): Promise<string[]> => {
  let names = await publishing(root)
  let pages = await Promise.all(names.map((name) => read(get, name)))
  return names.filter((_, i) => pages[i] == null)
}

let run = async (...args: string[]) => {
  let { code } = await new Deno.Command('git', { args }).spawn().status
  if (code) throw new Error(`git ${args.join(' ')} exited ${code}`)
}

export let release = async (version: string, root = '.') => {
  if (!semver(version)) {
    throw new Error(`not a version: ${version} (want 0.1.0)`)
  }
  let missing = await unlisted(root)
  if (missing.length) {
    throw new Error(
      `${missing.join(', ')}: no package on jsr.io yet. Create it there and ` +
        `link it to ${REPO.owner}/${REPO.name} in its settings, then release.`,
    )
  }
  let paths = await configs(root)
  for (let path of paths) {
    await Deno.writeTextFile(path, bump(await Deno.readTextFile(path), version))
  }
  await Deno.writeTextFile(`${root}/${LIST}`, list(await publishing(root)))
  await run('-C', root, 'add', ...paths, `${root}/${LIST}`)
  await run('-C', root, 'commit', '-m', `Release v${version}`)
  await run('-C', root, 'tag', `v${version}`)
  console.log(`v${version}: ${paths.length} packages, committed and tagged.`)
  console.log(`push it to publish:  git push origin main v${version}`)
}

if (import.meta.main) {
  let [version] = Deno.args
  if (!version) {
    console.error('usage: bin/release.ts <version>   e.g. 0.1.0')
    Deno.exit(2)
  }
  await release(version)
}
