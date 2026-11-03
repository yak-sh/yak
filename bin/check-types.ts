// `deno task check:types [--all] [paths…]`: the types of source and of the
// code in its doc comments (`deno check --doc`). With no paths it checks what
// the branch and working changes reach: each changed module and each module
// importing one (`types`), as `deno task test` does on every run with no
// paths. The consumers past those are main's CI's: `deno task check` runs
// `--all`, every module, after the push. Raycast is a Node/React host
// with its own tsconfig, checked by check:raycast, so it is not among DIRS.
import { matchesGlob } from 'node:path'
import config from '../deno.json' with { type: 'json' }
import { survey } from '@yaks/testing/deps'
import { changes, git } from './test-changes.ts'

/** Where the checked modules live. */
export const DIRS = ['apps', 'bench', 'bin', 'packages', 'plugins', 'workers']

/** What a generator makes, gitignored, and the modules importing it: the
 * kernel's tests import the workspace source catalog, and the public client
 * the browser assets. */
export const MADE: Record<string, string[]> = {
  'bin/compiler-packages.ts': ['workers/yak/public/_compiler/packages.json'],
  'workers/yak/client-assets.ts': ['_draft.js', '_outbox.js', '_wire.js']
    .map((name) => `workers/yak/public/${name}`),
}

/// checked('packages/sql/render.ts') -> true
/// checked('raycast/src/index.tsx') -> false
/// checked('workers/yak/conform.ts') -> false
/// checked('packages/sql/README.md') -> false
/** Whether a path is a module `deno check` checks. */
export let checked = (path: string) =>
  /\.[mc]?[jt]sx?$/.test(path) &&
  DIRS.some((d) => path.startsWith(`${d}/`)) &&
  !config.exclude.some((p) => matchesGlob(path, p) || path.startsWith(`${p}/`))

/** The modules a change reaches: those changed and their importers. */
let reached = async (changed: string[]) => {
  let all = (await git(['ls-files', '-co', '--exclude-standard', ...DIRS]))
    .split('\n').filter(checked)
  let s = await survey(all)
  if (!s) {
    throw new Error(
      'Cannot say what the change reaches: dependency graph unavailable. ' +
        '`deno task check:types --all` checks every module.',
    )
  }
  let far = s.distance(changed)
  let roots = all.filter((f) => far(f) <= 1)
  let made = Object.entries(MADE)
    .filter(([, out]) => s.reaches(roots, out))
    .map(([generator]) => generator)
  return { roots, made }
}

/** Runs `deno` with these arguments, and says whether it succeeded. */
export type Run = (args: string[]) => Promise<boolean>

let deno: Run = async (args) =>
  (await new Deno.Command(Deno.execPath(), { args }).spawn().status).success

/** Check the types of `roots`, after making what they import. */
let check = async (roots: string[], made: string[], run: Run) =>
  (await Promise.all(made.map((g) => run(['run', '--no-lock', '-A', g]))))
    .every(Boolean) && await run(['check', '--doc', ...roots])

/** Check the types of the modules the `changed` paths reach. */
export let types = async (changed: string[], run: Run = deno) => {
  if (!changed.some(checked)) return true
  let { roots, made } = await reached(changed)
  return !roots.length || await check(roots, made, run)
}

if (import.meta.main) {
  let all = Deno.args.includes('--all')
  let paths = Deno.args.filter((a) => !a.startsWith('--'))
  let ok = all || paths.length
    ? await check(all ? DIRS : paths, Object.keys(MADE), deno)
    : await types(await changes())
  if (!ok) Deno.exit(1)
}
