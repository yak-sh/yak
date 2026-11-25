// Local source checks cover the change: its lint, its raw bytes, the
// public API of each package it touches as JSR's publisher reads it (slow
// types: an export without its declared type), and the types of what it
// reaches. Runtime tests follow consumers. Main CI checks every module's
// types, and every package's public API, after the push.

import type { Survey } from '@yaks/testing/deps'
import { types } from './check-types.ts'
import { formatting } from '@yaks/git/land'
import config from '../deno.json' with { type: 'json' }

let code = (path: string) => /\.[mc]?[jt]sx?$/.test(path)
// The workspace member a path is in, by the layout package.json's workspaces
// name; bin/publish.ts dry-runs those that publish.
let member = (path: string) =>
  path.match(/^(?:packages|workers)\/[^/]+(?=\/)/)?.[0]
let formatted = (path: string) =>
  /\.(?:[mc]?[jt]sx?|jsonc?|md|markdown|ya?ml|css|scss|html)$/.test(path)

/** A check: its name, deno's arguments, and what it adds to the
 * environment. */
export type Check = {
  name: string
  args: string[]
  env?: Record<string, string>
}

/** Format, lint and byte-check existing changed files, and dry-run the
 * publish of each package they are in. */
export let checks = (changed: string[]): Check[] => {
  let fmt = changed.filter(formatted)
  let lint = changed.filter(code)
  // The workspace's own config, named: a yaks app's package.json is a config
  // to Deno too, and found beside a file it would replace the workspace's.
  let options = ['--config', 'deno.json', '--permit-no-files']
  let members = [...new Set(changed.flatMap((path) => member(path) ?? []))]
  return [
    ...fmt.length
      ? [{
        name: 'format',
        args: formatting(fmt, config),
      }]
      : [],
    ...lint.length
      ? [{ name: 'lint', args: ['lint', ...options, ...lint] }]
      : [],
    ...changed.length
      ? [{
        name: 'bytes',
        args: ['run', '--allow-read', 'bin/check-bytes.ts', ...changed],
      }]
      : [],
    ...members.length
      ? [{
        name: 'publish',
        args: [
          'run',
          '-A',
          'bin/publish.ts',
          '--dry-run',
          '--allow-dirty',
          ...members,
        ],
      }]
      : [],
  ]
}

/** A check's effect boundary. Tests supply this with controlled results. */
export let command = async (
  { name, args, env }: Check,
): Promise<boolean> => {
  let result = await new Deno.Command(Deno.execPath(), {
    args,
    env,
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

/** Lint the change and check the types of what it reaches, after
 * formatting. */
export let check = async (
  changed: string[],
  run = command,
  typed = (
    changed: string[],
    snapshot?: Promise<Survey | undefined>,
  ) => types(changed, (args) => run({ name: 'types', args }), snapshot),
  snapshot?: Promise<Survey | undefined>,
) =>
  (await Promise.all([
    ...checks(changed).filter((c) => c.name != 'format').map((c) => run(c)),
    typed(changed, snapshot),
  ])).every(Boolean)
