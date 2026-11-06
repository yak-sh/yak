// JSR publication uses the npm workspace's membership and each package's JSR
// metadata, without making that metadata the runtime's import resolver.
//
// `deno publish` skips a version JSR already has, so a publish is given every
// member and publishes what the release names (packages/cli/release.json),
// whether it moved or not. A package JSR does not have and the release does
// not name stays out, or it would take a place in the scope nothing asked
// for, and so does any member that publishes nothing and names one of those:
// Deno resolves every dependency a member's package.json names. A dry run
// (`--dry-run`, the source check) is given every member, so it checks every
// package's public API as one workspace.
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

let member = (dir: string): Member => {
  let pkg = JSON.parse(Deno.readTextFileSync(`${root}${dir}/package.json`))
  let deps = ['dependencies', 'devDependencies', 'optionalDependencies']
    .flatMap((group) => Object.keys(pkg[group] ?? {}))
  return { dir, name: pkg.name, deps }
}

if (import.meta.main) {
  let all = members().map(member)
  let held = new Set(
    (await publishing(root)).map((p) => p.name)
      .filter((name) => !Object.hasOwn(pinned, name)),
  )
  let left = Deno.args.includes('--dry-run') ? [] : out(all, held, pinned)
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
        workspace: all.filter((m) => !left.includes(m.dir))
          .map((m) => `./${m.dir}`),
      }),
    )
    let status = await new Deno.Command(Deno.execPath(), {
      args: [
        'publish',
        '--config',
        path,
        ...Deno.args,
      ],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn().status
    Deno.exitCode = status.code
  } finally {
    await Deno.remove(path)
  }
}
