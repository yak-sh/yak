// Filesystem agreement and linked-export boundaries for the skills mirror.
import { Refused } from '@yaks/graph/errors'
import type { Run } from '@yaks/git/land'
import type { Agreed } from '@yaks/mirror'

// A missing memo is a first sync; malformed data is an expected refusal.
// Unreadable storage is a fault, never silently reset into a new agreement.
export let agreement = (path: string) => {
  let load = async (): Promise<Map<string, Agreed>> => {
    let text: string
    try {
      text = await Deno.readTextFile(path)
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) return new Map()
      throw e
    }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e
      throw new Refused(`skills: malformed agreement ${path}`)
    }
    if (!value || typeof value != 'object' || Array.isArray(value)) {
      throw new Refused(`skills: malformed agreement ${path}`)
    }
    for (let a of Object.values(value)) {
      if (
        !a || typeof a != 'object' || typeof a.blob != 'string' ||
        (a.hash != undefined && typeof a.hash != 'string')
      ) {
        throw new Refused(`skills: malformed agreement ${path}`)
      }
    }
    return new Map(Object.entries(value))
  }
  return {
    agreed: load,
    remember: async (changed: Map<string, Agreed | null>) => {
      let all = await load()
      for (let [p, a] of changed) a ? all.set(p, a) : all.delete(p)
      await Deno.mkdir(path.slice(0, path.lastIndexOf('/')) || '.', {
        recursive: true,
      })
      let tmp = `${path}.${crypto.randomUUID()}.tmp`
      await Deno.writeTextFile(
        tmp,
        JSON.stringify(Object.fromEntries(all), null, 1) + '\n',
      )
      await Deno.rename(tmp, path)
    },
  }
}

type Git = (cwd: string, args: string[]) => Promise<string>

// Never adopt a dirty/unlanded branch or write the primary checkout. A clean
// ancestor can be advanced without rewriting any commit or discarding work.
export let prepareTree = async (
  root: string,
  common: string,
  head: string,
  tree: string,
  git: Git,
  run: Run,
): Promise<void> => {
  try {
    await Deno.lstat(tree)
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error
    await git(root, [
      'worktree',
      'add',
      '-b',
      `skills-${crypto.randomUUID()}`,
      tree,
      head,
    ])
    return
  }
  let dir = (await git(tree, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ])).trim()
  let gitdir =
    (await git(tree, ['rev-parse', '--path-format=absolute', '--git-dir']))
      .trim()
  let top = (await git(tree, ['rev-parse', '--show-toplevel'])).trim()
  let branch = (await git(tree, ['symbolic-ref', '--quiet', 'HEAD'])).trim()
  let primary = (await git(root, ['symbolic-ref', '--quiet', 'HEAD'])).trim()
  if (
    await Deno.realPath(dir) != common || await Deno.realPath(tree) == root ||
    await Deno.realPath(gitdir) == common || top != await Deno.realPath(tree) ||
    branch == primary ||
    (await git(tree, ['status', '--porcelain=v1', '--untracked-files=all']))
      .trim()
  ) throw new Refused('skills: export needs a clean linked worktree')
  let current = (await git(tree, ['rev-parse', 'HEAD'])).trim()
  if (current == head) return
  let ancestor = await run(
    ['merge-base', '--is-ancestor', current, head],
    tree,
  )
  if (!ancestor.ok) {
    if (ancestor.code != 1) throw new Refused(ancestor.err || ancestor.out)
    throw new Refused(
      'skills: dedicated worktree has unlanded or divergent commits',
    )
  }
  await git(tree, ['merge', '--ff-only', head])
}

// Compare raw bytes (including BOM/encoding) and never follow symlinks. Missing
// paths agree only with a planned deletion; every other I/O fault propagates.
export let exact = async (
  root: string,
  path: string,
  expected: string | undefined,
): Promise<boolean> => {
  try {
    let at = root
    for (let part of path.slice(root.length + 1).split('/')) {
      at += `/${part}`
      if ((await Deno.lstat(at)).isSymlink) return false
    }
    if (expected == undefined) return false
    let bytes = await Deno.readFile(path)
    let wanted = new TextEncoder().encode(expected)
    return bytes.length == wanted.length &&
      bytes.every((b, i) => b == wanted[i])
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return expected == undefined
    throw error
  }
}

let gone = (error: unknown) =>
  error instanceof Deno.errors.NotFound ||
  error instanceof Deno.errors.NotADirectory

/** How long a change time stays racy: past the coarsest timestamp tick a
 * filesystem keeps, so a rewrite of equal size can no longer share it. */
export let RACY = 2_000

// One line per path: its kind, inode, size and change times, or its absence.
// A path changed within RACY of `now` is racy, as Git calls it: a rewrite in
// the same tick would leave every stat equal, so its line equals no other.
let mark = (path: string, now: number): string => {
  try {
    let i = Deno.lstatSync(path)
    let kind = i.isSymlink ? 'l' : i.isDirectory ? 'd' : 'f'
    let changed = i.ctime?.getTime() ?? i.mtime?.getTime() ?? now
    if (changed > now - RACY) return `${path} racy ${crypto.randomUUID()}`
    let times = `${i.mtime?.getTime()} ${i.ctime?.getTime()}`
    return `${path} ${kind} ${i.ino} ${i.size} ${times}`
  } catch (error) {
    if (gone(error)) return `${path} -`
    throw error
  }
}
let walk = (dir: string, out: string[], now: number): void => {
  out.push(mark(dir, now))
  let entries: Deno.DirEntry[]
  try {
    entries = [...Deno.readDirSync(dir)]
  } catch (error) {
    if (gone(error)) return
    throw error
  }
  for (let entry of entries.sort((a, b) => a.name < b.name ? -1 : 1)) {
    let path = `${dir}/${entry.name}`
    if (entry.isDirectory) walk(path, out, now)
    else out.push(mark(path, now))
  }
}

/** What a sync of `root` reads from disk, as stats: the checkout's index and
 * HEAD (the tracked set, staged blobs and branch) and every path under
 * .claude/skills. Equal stamps mean a sync would read the same files, so a
 * watcher compares these instead of syncing; a racy path keeps it syncing
 * until its change is RACY old. No Git process runs, and the few stats are
 * synchronous: cheaper than a thread-pool hop each. */
export let stamp = (root: string, now: number = Date.now()): string => {
  let out = [
    mark(`${root}/.git/index`, now),
    mark(`${root}/.git/HEAD`, now),
  ]
  walk(`${root}/.claude/skills`, out, now)
  return out.join('\n')
}
