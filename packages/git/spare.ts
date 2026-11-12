/** Git operations and filesystem observations at the worktree boundary. */
export type Host = {
  git: (
    cwd: string,
    args: string[],
    optional?: boolean,
  ) => Promise<string | undefined>
  exists: (path: string) => Promise<boolean>
  entries: (path: string) => AsyncIterable<{ name: string }>
  remove: (path: string) => Promise<void>
  lock: <T>(
    source: string,
    path: string,
    change: () => Promise<T>,
  ) => Promise<T>
}

let beside = (path: string) => path.slice(0, path.lastIndexOf('/')) + '/.spare'

/** Spare publication and claims share a lock. Git's own lock stays on the
 * registration across each move: even Git renames before updating `gitdir`,
 * so a concurrent prune must see the lock until the final path is registered. */
export let spares = (host: Host): {
  add: (
    source: string,
    path: string,
    flags: string[],
    target: string,
    spare?: boolean,
  ) => Promise<void>
  keep: (source: string, path: string, base: string) => Promise<void>
} => {
  let git = host.git
  let quiet = (source: string, args: string[]) =>
    git(source, args, true).catch(() => undefined)
  // Also protect a spare left by an older process, which did not keep it locked.
  let protect = async (source: string, path: string) => {
    let trees = await git(source, ['worktree', 'list', '--porcelain'])
    let tree = trees?.split('\n\n').find((tree) =>
      tree.startsWith(`worktree ${path}\n`)
    )
    if (!tree?.split('\n').some((line) => /^locked(?: |$)/.test(line))) {
      await git(source, ['worktree', 'lock', path])
    }
  }
  let move = (source: string, from: string, to: string) =>
    git(source, ['worktree', 'move', '--force', '--force', from, to])
  let add = async (
    source: string,
    path: string,
    flags: string[],
    target: string,
    spare?: boolean,
  ) => {
    let at = beside(path)
    let taken = spare && await host.lock(source, at, async () => {
      if (!await host.exists(at)) return false
      await protect(source, at)
      await move(source, at, path)
      await git(source, ['worktree', 'unlock', path])
      return true
    })
    if (!taken) {
      await git(source, ['worktree', 'add', ...flags, path, target])
      return
    }
    try {
      await git(path, ['checkout', '--quiet', ...flags, target])
    } catch (failure) {
      await quiet(source, ['worktree', 'remove', '--force', path])
      throw failure
    }
  }
  let keep = async (source: string, path: string, base: string) => {
    let at = beside(path)
    await host.lock(source, at, async () => {
      if (await host.exists(at)) {
        await protect(source, at)
        return
      }
      let dir = at.slice(0, at.lastIndexOf('/'))
      for await (let e of host.entries(dir)) {
        if (!e.name.startsWith('.spare-')) continue
        let left = `${dir}/${e.name}`
        await quiet(source, ['worktree', 'remove', '--force', '--force', left])
        await host.remove(left)
      }
      let cut = `${at}-${crypto.randomUUID()}`
      await git(source, ['worktree', 'add', '--detach', '--lock', cut, base])
      await move(source, cut, at)
    })
  }
  return { add, keep }
}
