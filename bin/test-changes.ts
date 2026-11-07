// Git supplies the changed paths and what each hunk edits; dependency
// selection stays in @yaks/testing.
import { members } from '@yaks/cli/dependencies'
import { tested } from '@yaks/testing/find'
import { declared } from '@yaks/testing/names'

type Run = (args: string[]) => Promise<string>

/** Git's answer to `args`, or why it refused. */
export let git: Run = async (args) => {
  let result = await new Deno.Command('git', {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  if (!result.success) {
    throw new Error(
      `git ${args[0]} refused: ${
        new TextDecoder().decode(result.stderr).trim()
      }`,
    )
  }
  return new TextDecoder().decode(result.stdout)
}

/** Paths changed on this branch, including staged, unstaged and untracked
 * files. On main, the latest commit supplies the committed changes. */
export let changes = async (run: Run = git): Promise<string[]> => {
  let tracked = await run([
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    await base(run),
  ])
  let added = await run(['ls-files', '--others', '--exclude-standard', '-z'])
  return [...new Set((tracked + added).split('\0').filter(Boolean))]
}

// What this branch's changes are measured from: on main, the latest commit's
// parent.
let base = async (run: Run) =>
  (await run(['branch', '--show-current'])).trim() == 'main'
    ? 'HEAD^'
    : (await run(['merge-base', 'main', 'HEAD'])).trim()

/// lines('+++ b/a.ts\n@@ -3,2 +3,3 @@ x\n@@ -9 +10,0 @@\n+++ b/b.ts\n@@ -0,0 +1 @@') -> { 'a.ts': [3, 4, 5, 10], 'b.ts': [1] }
/// lines('+++ /dev/null\n@@ -1 +0,0 @@') -> {}
/** The lines each path's hunks of a diff (`-U0`) leave edited, as the
 * changed file counts them: where a hunk only takes lines out, the line
 * before them. */
export let lines = (diff: string): Record<string, number[]> => {
  let at: Record<string, number[]> = {}
  let file: number[] | undefined
  for (let line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.startsWith('+++ b/') ? (at[line.slice(6)] = []) : undefined
      continue
    }
    let hunk = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!hunk || !file) continue
    let from = Number(hunk[1]), count = Number(hunk[2] ?? 1)
    if (!count) file.push(Math.max(from, 1))
    for (let i = 0; i < count; i++) file.push(from + i)
  }
  return at
}

/** What this branch's changes edit in each module they change, staged,
 * unstaged or committed, but tests, which run for being changed: the
 * top-level declarations holding the lines they edit
 * (@yaks/testing/names `declared`). */
export let edits = async (
  run: Run = git,
  read: (path: string) => Promise<string> = (p) => Deno.readTextFile(p),
): Promise<Record<string, string[]>> => {
  let diff = await run(['diff', '-U0', '--no-renames', await base(run)])
  let edited: Record<string, string[]> = {}
  for (let [path, at] of Object.entries(lines(diff))) {
    if (!/\.[mc]?[jt]sx?$/.test(path) || tested(path)) continue
    let text = await read(path).catch(() => undefined)
    if (text == undefined) continue
    let owners = declared(text)
    let names = at.map((l) => owners[l - 1]).filter((n) => n != undefined)
    if (names.length) edited[path] = [...new Set(names)]
  }
  return edited
}

let workspace = new Set(members())
// Selection asks of each module many times.
let owners = new Map<string, string | undefined>()

/// member('packages/sql/render.ts') -> 'packages/sql'
/// member('bin/test.ts') -> undefined
/** The workspace package a path belongs to. */
export let member = (path: string): string | undefined => {
  if (!owners.has(path)) {
    let dirs = path.split('/').slice(0, -1)
    let at = dirs.findIndex((_, i) =>
      workspace.has(dirs.slice(0, i + 1).join('/'))
    )
    owners.set(path, at < 0 ? undefined : dirs.slice(0, at + 1).join('/'))
  }
  return owners.get(path)
}
