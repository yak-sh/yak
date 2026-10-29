// Revert a main commit and publish its correction. Workers Builds and the
// deploy catch-up report deployment failures after this command returns.
import { CallError } from '@yaks/tools/errors'
import { land, type Run } from '@yaks/git/land'
import { git } from './deploys.ts'

export let revert = async (
  root: string,
  sha: string,
  out: (line: string) => void,
  note: (line: string) => void,
  stopping: AbortSignal,
  run: Run = (args, cwd) =>
    git(
      cwd,
      args,
      ['fetch', 'push'].includes(args[0])
        ? AbortSignal.any([stopping, AbortSignal.timeout(2_500)])
        : stopping,
    ),
) => {
  let command = (cwd: string, args: string[]) => run(args, cwd)
  let need = async (cwd: string, args: string[], refusal?: string) => {
    let r = await command(cwd, args)
    if (!r.ok) {
      let message = `git ${args[0]} exited ${r.code}: ${r.err.trim()}`
      if (refusal) throw new CallError(refusal, message)
      throw new Error(message)
    }
    return r.out.trim()
  }
  let list = await need(root, ['worktree', 'list', '--porcelain'])
  if (!list.split('\n\n')[0].split('\n').includes('branch refs/heads/main')) {
    throw new Error(
      'land must target main; the primary checkout is on another branch',
    )
  }
  let remote = await need(root, ['config', 'branch.main.remote'])
  let branch = await need(root, ['config', 'branch.main.merge'])
  if (!remote || remote == '.' || branch != 'refs/heads/main') {
    throw new Error('main needs a remote main upstream for Workers Builds')
  }
  await need(root, ['fetch', remote, 'main'])
  let base = await need(root, ['rev-parse', 'main'])
  if (base != await need(root, ['rev-parse', 'FETCH_HEAD'])) {
    throw new Error(
      'local main differs from remote main; synchronize main before reverting',
    )
  }
  let target = await need(
    root,
    ['rev-parse', '--verify', `${sha}^{commit}`],
    'sha',
  )
  let ancestor = await command(
    root,
    ['merge-base', '--is-ancestor', target, base],
  )
  if (!ancestor.ok) {
    let message = `${sha} is not an ancestor of main`
    if (ancestor.code == 1) throw new CallError('sha', message)
    throw new Error(message)
  }

  let name = `yak-revert-${crypto.randomUUID().slice(0, 8)}`
  let parent = `${root}/.claude/worktrees`
  await Deno.mkdir(parent, { recursive: true })
  let tree = `${parent}/${name}`
  await need(
    root,
    ['worktree', 'add', '-b', name, tree, 'main'],
  )
  let kept = true
  note(`revert worktree: ${tree}`)
  // Preserve the worktree on failure: conflicts are work an
  // owner can finish, not scratch that this command is entitled to erase.
  try {
    await need(tree, ['revert', '--no-edit', target], 'sha')
    // These files are the explicit git revert, not a rebase that silently
    // restores older content. Keep the exception scoped to that patch.
    let paths = (await need(
      tree,
      ['diff', '--name-only', '-z', 'HEAD^', 'HEAD'],
    )).split('\0').filter(Boolean)
    for (let attempt = 0; attempt < 3; attempt++) {
      let outcome = await land({
        cwd: tree,
        allow: paths,
        run,
        write: (line, error) => (error ? note : out)(line.trimEnd()),
      })
      if (!('landed' in outcome)) {
        if (outcome.conflict) {
          throw new CallError('sha', 'rebase conflicts need resolution')
        }
        note('main moved; landing the rebased revert')
        continue
      }
      let commit = outcome.landed
      // land deliberately treats a failed push as a successful local merge.
      // Confirm publication before removing its recovery worktree.
      await need(tree, ['fetch', remote, 'main'])
      let published = await command(tree, [
        'merge-base',
        '--is-ancestor',
        commit,
        'FETCH_HEAD',
      ])
      if (!published.ok) {
        throw new Error(`${commit} landed locally but was not pushed to main`)
      }
      out(`pushed ${commit}; Workers Builds deploys in the background`)
      await need(root, ['worktree', 'remove', tree])
      kept = false
      await need(outcome.root, ['branch', '-d', name])
      return 0
    }
    throw new Error('main kept moving through three landing attempts')
  } catch (e) {
    if (kept) note(`worktree kept at ${tree}`)
    throw e
  }
}
