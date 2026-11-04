// Local source checks cover the change: its lint, its raw bytes, the
// workspace's public APIs when it touches a package, the Worker's generated
// content when it touches a source of it, and the types of what it reaches. Runtime tests
// follow consumers. Main CI checks every module's types after the push.

import { publishing } from './release.ts'
import { types } from './check-types.ts'

let code = (path: string) => /\.[mc]?[jt]sx?$/.test(path)
// What workers/yak/gen.ts reads or writes: the Worker's words and config, the
// plugin it packs, and every workspace manifest, whose exports load.ts lists.
let generated = (path: string) =>
  /^(?:workers\/yak|plugins\/yaks\.app)\/|(?:^|\/)deno\.json$/.test(path)
let formatted = (path: string) =>
  /\.(?:[mc]?[jt]sx?|jsonc?|md|markdown|ya?ml|css|scss|html)$/.test(path)

export type Check = { name: string; args: string[] }

/** Format, lint and byte-check existing changed files, and, when the change
 * touches a package in `configs`, check every package's public API as one
 * workspace: a package checked alone cannot see the cycle its new import
 * closes with another (`Circular package dependency detected`), which
 * publishing the workspace refuses. A change to what workers/yak/content.ts,
 * load.ts or plugins/yaks.app is generated from checks they are fresh, and
 * fails naming `deno task content`. */
export let checks = (changed: string[], configs: string[] = []): Check[] => {
  let fmt = changed.filter(formatted)
  let lint = changed.filter(code)
  let touched = configs.some((config) => {
    let dir = config.replace(/^\.\//, '').replace(/deno\.json$/, '')
    return changed.some((path) => path.startsWith(dir))
  })
  return [
    ...fmt.length
      ? [{ name: 'format', args: ['fmt', '--permit-no-files', ...fmt] }]
      : [],
    ...lint.length
      ? [{ name: 'lint', args: ['lint', '--permit-no-files', ...lint] }]
      : [],
    ...changed.length
      ? [{
        name: 'bytes',
        args: ['run', '--allow-read', 'bin/check-bytes.ts', ...changed],
      }]
      : [],
    ...changed.some(generated)
      ? [{
        name: 'content',
        args: [
          'run',
          '--allow-read',
          '--allow-write',
          '--allow-env',
          '--allow-run=deno',
          'workers/yak/gen.ts',
          '--check',
        ],
      }]
      : [],
    ...touched
      ? [{
        name: 'publish',
        args: ['publish', '--dry-run', '--allow-dirty', '--no-check'],
      }]
      : [],
  ]
}

/** A check's effect boundary. Tests supply this with controlled results. */
export let command = async ({ name, args }: Check): Promise<boolean> => {
  let result = await new Deno.Command(Deno.execPath(), {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    console.error(`FAILED ${name}`)
    console.error(new TextDecoder().decode(result.stdout))
    console.error(new TextDecoder().decode(result.stderr))
  }
  return result.success
}

/** Format before selecting: the files' keys must describe the bytes tested. */
export let format = async (
  changed: string[],
  run = command,
): Promise<string[]> => {
  let files = (await Promise.all(
    changed.map(async (path) =>
      await Deno.stat(path).then((s) => s.isFile, () => false) ? [path] : []
    ),
  )).flat()
  let fmt = checks(files).find((c) => c.name == 'format')
  if (fmt && !await run(fmt)) throw new Error('Formatting failed')
  return files
}

/** Lint the change, check its packages' public APIs and the types of what it
 * reaches, after formatting. */
export let check = async (
  changed: string[],
  run = command,
  packages = publishing,
  typed = (changed: string[]) =>
    types(changed, (args) => run({ name: 'types', args })),
) =>
  (await Promise.all([
    ...checks(changed, (await packages()).map((p) => p.config))
      .filter((c) => c.name != 'format').map(run),
    typed(changed),
  ])).every(Boolean)
