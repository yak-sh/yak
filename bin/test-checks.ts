// Local source checks cover the change: its lint, its raw bytes, the
// Worker's generated content when it touches a source of it and what the
// generator read and loaded as it last passed changed since (`kept`), the
// public API of each package it touches as JSR's publisher reads it (slow
// types: an export without its declared type), and the types of what it
// reaches. Runtime tests follow consumers. Main CI checks every module's
// types, and every package's public API, after the push.

import { createHash } from 'node:crypto'
import {
  note,
  passed,
  READS,
  recall,
  remember,
  STORE,
  type Survey,
} from '@yaks/testing/deps'
import { type Prepared, types } from './check-types.ts'
import { cache } from '@yaks/testing/kept'
import { OBSERVED } from './test-observe.ts'
import { formatting } from '@yaks/git/land'
import config from '../deno.json' with { type: 'json' }

let code = (path: string) => /\.[mc]?[jt]sx?$/.test(path)
// What workers/yak/gen.ts reads or writes: the Worker's words and config, the
// plugin it packs, every workspace manifest, whose exports load.ts lists, and
// every vocab.json, whose words the components page prints.
let generated = (path: string) =>
  /^(?:workers\/yak|plugins\/yaks\.app)\/|(?:^|\/)(?:deno|package|vocab)\.json$/
    .test(path)
// The workspace member a path is in, by the layout package.json's workspaces
// name; bin/publish.ts dry-runs those that publish.
let member = (path: string) =>
  path.match(/^(?:packages|workers)\/[^/]+(?=\/)/)?.[0]
let formatted = (path: string) =>
  /\.(?:[mc]?[jt]sx?|jsonc?|md|markdown|ya?ml|css|scss|html)$/.test(path)

/** A check: its name, deno's arguments, and what it adds to the
 * environment. One that `keeps` a script, whose verdict follows from what the
 * script reads and loads, is run again only once one of those changed
 * (`kept`). */
export type Check = {
  name: string
  args: string[]
  env?: Record<string, string>
  keeps?: string
}

/** Format, lint and byte-check existing changed files, and dry-run the
 * publish of each package they are in. A change to what
 * workers/yak/content.ts, load.ts or plugins/yaks.app is generated from checks
 * they are fresh, and fails naming `deno task content`. */
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
        args: [
          ...formatting([], config),
          '--config',
          'deno.json',
          ...fmt,
        ],
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
          '--no-check',
          ...members,
        ],
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
        keeps: 'workers/yak/gen.ts',
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

let OBSERVER = new URL('./test-observe.ts', import.meta.url).pathname

/** What a kept check's verdict follows from, as the survey read it: the
 * runtime, the config and locks, and each path it read or loaded. */
let inputs = async (s: Survey, read: string[]) =>
  createHash('sha256').update(
    [
      Deno.version.deno,
      ...await Promise.all(
        ['deno.json', 'deno.lock', 'pnpm-lock.yaml', ...read].map(async (p) =>
          `${p} ${await s.bytes(p)}`
        ),
      ),
    ].join('\n'),
  ).digest('hex')

/**
 * Runs a check that `keeps` a script only when what it read and loaded as it
 * last passed (./test-observe.ts) holds something else now, by the survey
 * `snapshot`; one that passes is kept by what it read this time. Its pass
 * and reads are kept with the tests' (@yaks/testing's `remember` and
 * `note`), under the script and its arguments.
 */
export let kept = async (
  c: Check,
  run = command,
  snapshot?: Promise<Survey | undefined>,
  stores = { passes: STORE, reads: READS },
): Promise<boolean> => {
  let s = c.keeps && await snapshot
  if (!c.keeps || !s) return await run(c)
  let name = c.args.slice(c.args.indexOf(c.keeps)).join(' ')
  let before = recall(stores.reads)[name]
  if (before && passed(stores.passes).has(await inputs(s, before))) return true
  // Beside the stores: a check may write only outside `/dev`, where a run's
  // scratch directory lies.
  let out = await Deno.makeTempFile({
    dir: `${cache}/yak`,
    prefix: 'observed-',
  })
  try {
    let ok = await run({
      ...c,
      args: ['run', '--preload', OBSERVER, ...c.args.slice(1)],
      env: { ...c.env, [OBSERVED]: out },
    })
    let read = ok && await Deno.readTextFile(out).then(JSON.parse, () => {})
    if (read) {
      read = [...new Set([c.keeps, ...read])].sort()
      remember([await inputs(s, read)], stores.passes)
      note({ [name]: read }, stores.reads)
    }
    return ok
  } finally {
    await Deno.remove(out).catch(() => {})
  }
}

/** Lint the change and check the types of what it reaches, after
 * formatting. */
export let check = async (
  changed: string[],
  run = command,
  typed = (
    changed: string[],
    prepared: Prepared,
    snapshot?: Promise<Survey | undefined>,
  ) =>
    types(changed, (args) => run({ name: 'types', args }), prepared, snapshot),
  prepared: Prepared = [],
  snapshot?: Promise<Survey | undefined>,
) =>
  (await Promise.all([
    ...checks(changed).filter((c) => c.name != 'format')
      .map((c) => kept(c, run, snapshot)),
    typed(changed, prepared, snapshot),
  ])).every(Boolean)
