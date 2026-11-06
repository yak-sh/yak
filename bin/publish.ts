// JSR publication uses the npm workspace's membership and each package's
// package.json, the one manifest its name, version and exports are written in.
// `deno publish` reads them from the member's deno.json, so a publish writes
// them there for its run and puts each deno.json back after: kept in deno.json,
// they would be a second exports table Deno resolves through.
//
// `deno publish` skips a version JSR already has, so a publish is given every
// member and publishes what the release names (packages/cli/release.json),
// whether it moved or not. A package JSR does not have and the release does
// not name stays out, or it would take a place in the scope nothing asked
// for, and so does any member that publishes nothing and names one of those:
// Deno resolves every dependency a member's package.json names. A dry run
// (`--dry-run`, the source check) is given every member, so it checks every
// package's public API as one workspace.
import { matchesGlob } from 'node:path'
import config from '../deno.json' with { type: 'json' }
import pinned from '../packages/cli/release.json' with { type: 'json' }
import { members } from '@yaks/cli/dependencies'
import { publishing } from './release.ts'

let root = new URL('../', import.meta.url).pathname

type Member = { dir: string; name?: string; deps: string[] }

/** The members a publish leaves out: each package in `held`, and each member
 * that is not a package the release names and depends on one left out.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(out([
 *   { dir: 'a', name: '@yaks/a', deps: [] },
 *   { dir: 'w', deps: ['@yaks/a', '@yaks/b'] },
 *   { dir: 'b', name: '@yaks/b', deps: ['@yaks/t'] },
 *   { dir: 't', name: '@yaks/t', deps: [] },
 * ], new Set(['@yaks/a']), { '@yaks/b': '1.0.0' }), ['a', 'w'])
 * ```
 */
export let out = (
  all: Member[],
  held: Set<string>,
  release: Readonly<Record<string, string>>,
): string[] => {
  let gone = new Set(all.filter((m) => held.has(m.name ?? '')))
  let names = () => new Set([...gone].map((m) => m.name))
  for (let grew = true; grew;) {
    grew = false
    let left = names()
    for (let m of all) {
      if (gone.has(m) || Object.hasOwn(release, m.name ?? '')) continue
      if (!m.deps.some((dep) => left.has(dep))) continue
      gone.add(m)
      grew = true
    }
  }
  return all.filter((m) => gone.has(m)).map((m) => m.dir)
}

type Config = {
  publish?: false | { exclude?: string[] }
  [key: string]: unknown
}

/** A member's deno.json as `deno publish` reads it: its JSR options, and its
 * package.json's name, version, license, description and the exports its
 * publish does not exclude.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let pkg = { name: '@yaks/a', version: '1.0.0', license: 'MIT', description: 'A.', type: 'module', exports: { '.': './mod.ts', './testing': './testing.ts' } }
 * let publish = { exclude: ['testing.ts'] }
 * assertEquals(
 *   jsr(pkg, { publish }),
 *   { publish, name: '@yaks/a', version: '1.0.0', license: 'MIT', description: 'A.', exports: { '.': './mod.ts' } },
 * )
 * ```
 */
export let jsr = (pkg: Record<string, unknown>, config: Config): Config => {
  let exclude = (config.publish || {}).exclude ?? []
  let shipped = (file: unknown) =>
    !exclude.some((glob) =>
      matchesGlob(String(file).replace(/^\.\//, ''), glob.replace(/^\.\//, ''))
    )
  let exports = pkg.exports
  return {
    ...config,
    name: pkg.name,
    version: pkg.version,
    license: pkg.license,
    description: pkg.description,
    exports: typeof exports == 'string' ? exports : Object.fromEntries(
      Object.entries(exports ?? {}).filter(([, file]) => shipped(file)),
    ),
  }
}

// Write each member's deno.json as `deno publish` reads it, and return how to
// put every one back.
let written = async (dirs: string[]) => {
  let kept = new Map<string, string>()
  for (let dir of dirs) {
    let path = `${root}${dir}/deno.json`
    let text = await Deno.readTextFile(path).catch(() => null)
    if (text == null) continue
    kept.set(path, text)
    let pkg = JSON.parse(await Deno.readTextFile(`${root}${dir}/package.json`))
    await Deno.writeTextFile(path, JSON.stringify(jsr(pkg, JSON.parse(text))))
  }
  return () =>
    Promise.all([...kept].map(([path, text]) => Deno.writeTextFile(path, text)))
}

let member = (dir: string): Member => {
  let pkg = JSON.parse(Deno.readTextFileSync(`${root}${dir}/package.json`))
  let deps = ['dependencies', 'devDependencies', 'optionalDependencies']
    .flatMap((group) => Object.keys(pkg[group] ?? {}))
  return { dir, name: pkg.name, deps }
}

let dirty = async () => {
  let { stdout } = await new Deno.Command('git', {
    args: ['status', '--porcelain'],
    cwd: root,
    stdout: 'piped',
  }).output()
  return stdout.length > 0
}

if (import.meta.main) {
  let all = members().map(member)
  let held = new Set(
    (await publishing(root)).map((p) => p.name)
      .filter((name) => !Object.hasOwn(pinned, name)),
  )
  let left = Deno.args.includes('--dry-run') ? [] : out(all, held, pinned)
  let dirs = all.filter((m) => !left.includes(m.dir)).map((m) => m.dir)
  // `deno publish` sees the deno.json files written below as uncommitted, so
  // the tree is checked here, before they are, and the publish allows them.
  if (!Deno.args.includes('--allow-dirty') && await dirty()) {
    throw new Error('uncommitted changes: publish a clean tree')
  }
  let restore = await written(dirs)
  let path = await Deno.makeTempFile({
    dir: root,
    prefix: '.publish-',
    suffix: '.json',
  })
  try {
    await Deno.writeTextFile(
      path,
      JSON.stringify({
        ...config,
        nodeModulesDir: 'none',
        workspace: dirs.map((dir) => `./${dir}`),
      }),
    )
    let status = await new Deno.Command(Deno.execPath(), {
      args: [
        'publish',
        '--config',
        path,
        '--allow-dirty',
        ...Deno.args.filter((arg) => arg != '--allow-dirty'),
      ],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn().status
    Deno.exitCode = status.code
  } finally {
    await Deno.remove(path)
    await restore()
  }
}
