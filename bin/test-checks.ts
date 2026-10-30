// Local source checks cover the change; runtime tests follow consumers.
// Main CI checks all consumer types after the push.

import { typecheck } from './test-typecheck.ts'

let code = (path: string) => /\.[mc]?[jt]sx?$/.test(path)
let formatted = (path: string) =>
  /\.(?:[mc]?[jt]sx?|jsonc?|md|markdown|ya?ml|css|scss|html)$/.test(path)

export type Check = { name: string; args: string[] }

/** Format, lint and type-check existing changed files. */
export let checks = (changed: string[]): Check[] => {
  let fmt = changed.filter(formatted)
  let lint = changed.filter(code)
  let types = [...new Set(changed.filter(code))]
  return [
    ...fmt.length ? [{ name: 'format', args: ['fmt', ...fmt] }] : [],
    ...lint.length ? [{ name: 'lint', args: ['lint', ...lint] }] : [],
    ...types.length
      ? [{
        name: 'types',
        args: ['check', '--quiet', '--frozen', '--doc', ...types],
      }]
      : [],
  ]
}

/** A check's effect boundary. Tests supply this with controlled results. */
let execute = async (
  { name, args }: Check,
  display = (text: string) => text,
): Promise<boolean> => {
  let result = await new Deno.Command(Deno.execPath(), {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    console.error(`FAILED ${name}`)
    console.error(display(new TextDecoder().decode(result.stdout)))
    console.error(display(new TextDecoder().decode(result.stderr)))
  }
  return result.success
}

/** Type checks reuse Deno's incremental program across worktrees. */
export let command = (check: Check): Promise<boolean> =>
  check.name == 'types' ? typecheck(check, execute) : execute(check)

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

/** Lint and type checks run alongside one another after formatting. */
export let check = async (
  changed: string[],
  run = command,
) =>
  (await Promise.all(
    checks(changed).filter((c) => c.name != 'format').map(run),
  )).every(Boolean)
