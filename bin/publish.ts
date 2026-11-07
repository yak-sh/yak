// JSR publication uses the npm workspace's membership and each package's
// package.json, the one manifest its name, version and exports are written in.
// `deno publish` reads them from the member's deno.json, so each invocation
// projects its own temporary workspace. Source manifests never change while
// other checks read them, and concurrent publishers share nothing writable.
//
// `deno publish` skips a version JSR already has, so a publish is given every
// member and publishes what the release names (packages/cli/release.json),
// whether it moved or not. A package JSR does not have and the release does
// not name stays out, or the publish would stop at a package with no page,
// and so does any member that publishes nothing and names one of those:
// Deno resolves every dependency a member's package.json names. A dry run
// (`--dry-run`, the source check) is given every member, so it checks every
// package's public API as one workspace. Member directories named after the
// flags are each published alone, within that whole workspace: what
// `deno task test` dry-runs for the packages a change touches
// (./test-checks.ts), a second or so each, where every package takes four.
//
// A publish ships, in @yaks/cli's `made/`, the canvas a fresh `yak init`
// serves (@yaks/web/canvas `prepare`), made here from the release's own
// checkout, so a person's `yak serve` answers with it instead of bundling the
// canvas from JSR (@yaks/cli/page `ahead`). It ships, in
// @yaks/cli's `exports.json`, the subpaths every member publishes, so a CLI
// from JSR loads a config's facets as one module graph (@yaks/cli/release
// `shipped`).
import { matchesGlob } from 'node:path'
import { cp } from 'node:fs/promises'
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

/** Run against an independent publication workspace, removed even if the
 * publisher fails. Both source files and generated manifests belong to that
 * invocation, so neither a publisher nor its cleanup can change another run.
 */
export let project = async <T>(
  source: string,
  dirs: string[],
  run: (root: string) => Promise<T>,
): Promise<T> => {
  let target = await Deno.makeTempDir({ prefix: 'yaks-publish-' })
  try {
    let copy = (path: string) =>
      cp(`${source}/${path}`, `${target}/${path}`, {
        recursive: true,
        filter: (path) =>
          !['node_modules', '.git', '.wrangler'].includes(
            path.split('/').at(-1)!,
          ),
      })
    await Promise.all(
      ['package.json', 'deno.lock', '.gitignore', ...dirs].map(copy),
    )
    for (let dir of dirs) {
      let path = `${target}/${dir}/deno.json`
      let text = await Deno.readTextFile(path).catch((error) => {
        if (error instanceof Deno.errors.NotFound) return null
        throw error
      })
      if (text == null) continue
      let pkg = JSON.parse(
        await Deno.readTextFile(`${target}/${dir}/package.json`),
      )
      await Deno.writeTextFile(path, JSON.stringify(jsr(pkg, JSON.parse(text))))
    }
    let config = JSON.parse(await Deno.readTextFile(`${source}/deno.json`))
    await Deno.writeTextFile(
      `${target}/deno.json`,
      JSON.stringify({
        ...config,
        nodeModulesDir: 'none',
        workspace: dirs.map((dir) => `./${dir}`),
      }),
    )
    return await run(target)
  } finally {
    await Deno.remove(target, { recursive: true })
  }
}

/** The subpaths each member of a publication workspace at `root` publishes,
 * by name, read from the deno.json `project` wrote: what @yaks/cli's
 * exports.json ships (packages/cli/release.ts `shipped`). */
export let shipping = async (
  root: string,
  dirs: string[],
): Promise<Record<string, string[]>> => {
  let configs = await Promise.all(
    dirs.map((dir) =>
      Deno.readTextFile(`${root}/${dir}/deno.json`).then(JSON.parse, () => null)
    ),
  )
  return Object.fromEntries(
    configs.filter((c) => c?.name).toSorted((a, b) => a.name < b.name ? -1 : 1)
      .map((c) => [
        c.name,
        typeof c.exports == 'string' ? ['.'] : Object.keys(c.exports ?? {}),
      ]),
  )
}

/** Whether a member's own deno.json lets it publish: `deno publish` refuses
 * one with `publish: false`, and has no manifest to project without one. */
let publishes = (m: Member) => {
  let text = (() => {
    try {
      return Deno.readTextFileSync(`${root}${m.dir}/deno.json`)
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return null
      throw error
    }
  })()
  return m.name != null && text != null && JSON.parse(text).publish !== false
}

let member = (dir: string): Member => {
  let pkg = JSON.parse(Deno.readTextFileSync(`${root}${dir}/package.json`))
  let deps = ['dependencies', 'devDependencies', 'optionalDependencies']
    .flatMap((group) => Object.keys(pkg[group] ?? {}))
  return { dir, name: pkg.name, deps }
}

/** `deno publish` with the projected config at `config`. Run alone, it
 * answers in the terminal, where a publish asks to authorize; beside others,
 * each answer is kept until all are done, so none interleave. */
let publish = (config: string, args: string[], piped = false) =>
  new Deno.Command(Deno.execPath(), {
    args: ['publish', '--config', config, ...args],
    // Keep the source checkout's Git cleanliness and provenance checks.
    cwd: root,
    stdin: piped ? 'null' : 'inherit',
    stdout: piped ? 'piped' : 'inherit',
    stderr: piped ? 'piped' : 'inherit',
  })

/** Publish each named member that publishes alone, in the whole workspace. */
let alone = async (all: Member[], named: string[], flags: string[]) => {
  let each = all.filter((m) => named.includes(m.dir) && publishes(m))
  if (!each.length) return 0
  return await project(root, all.map((m) => m.dir), async (target) => {
    let runs = await Promise.all(
      each.map((m) =>
        publish(`${target}/${m.dir}/deno.json`, flags, true).output()
      ),
    )
    for (let run of runs) {
      await Deno.stdout.write(run.stdout)
      await Deno.stderr.write(run.stderr)
    }
    return runs.every((run) => run.success) ? 0 : 1
  })
}

/** Publish the release, or dry-run every member. */
let whole = async (all: Member[], flags: string[]) => {
  let dry = flags.includes('--dry-run')
  let held = new Set(
    (await publishing(root)).map((p) => p.name)
      .filter((name) => !Object.hasOwn(pinned, name)),
  )
  let left = dry ? [] : out(all, held, pinned)
  let dirs = all.filter((m) => !left.includes(m.dir)).map((m) => m.dir)
  return await project(root, dirs, async (target) => {
    if (!dry && dirs.includes('packages/cli')) {
      let [canvas, { STARTER }] = await Promise.all([
        import('@yaks/web/canvas'),
        import('../packages/cli/init.ts'),
      ])
      await canvas.prepare(
        new URL(`file://${target}/packages/cli/made/`),
        STARTER,
      )
      await Deno.writeTextFile(
        `${target}/packages/cli/exports.json`,
        JSON.stringify(await shipping(target, dirs), null, 2) + '\n',
      )
    }
    let status = await publish(`${target}/deno.json`, flags).spawn().status
    return status.code
  })
}

if (import.meta.main) {
  let all = members().map(member)
  let flags = Deno.args.filter((arg) => arg.startsWith('-'))
  let named = Deno.args.filter((arg) => !arg.startsWith('-'))
  Deno.exitCode = named.length
    ? await alone(all, named, flags)
    : await whole(all, flags)
}
