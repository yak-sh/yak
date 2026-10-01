// Filesystem agreement and linked-export boundaries for the skills mirror.
import { Refused } from '@yaks/graph'
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
  if (
    await Deno.realPath(dir) != common || await Deno.realPath(tree) == root ||
    await Deno.realPath(gitdir) == common || top != await Deno.realPath(tree) ||
    branch == 'refs/heads/main' ||
    (await git(tree, ['status', '--porcelain=v1', '--untracked-files=all']))
      .trim()
  ) throw new Refused('skills: export needs a clean linked non-main worktree')
  let current = (await git(tree, ['rev-parse', 'HEAD'])).trim()
  if (current == head) return
  let ancestor = await run(['merge-base', '--is-ancestor', current, head], tree)
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
