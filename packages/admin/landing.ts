// One commit the box lands on main itself, through the landing path every
// agent uses (@yaks/git/land): a revert (./revert.ts), or the changes made on
// the platform that a release from git carries into it (./service.ts). Workers
// Builds and the deploy catch-up report deployment failures after it returns.

import * as fs from '@yaks/file/io'
import { CallError } from '@yaks/tools/errors'
import { land, type Run } from '@yaks/git/land'

/** git as a landing runs it, and where it says what happened. */
export type Landing = {
  run: Run
  out: (line: string) => void
  note: (line: string) => void
}

/** git run in `cwd`, its output trimmed, refused as `refusal` or failing. */
export type Need = (
  cwd: string,
  args: string[],
  refusal?: string,
) => Promise<string>

/** Lands one commit on main from a fresh worktree of it, named after `name`.
 * main must be the shared checkout's branch and match its remote; `check`
 * reads it then, its tip as `base`. `make` commits in the worktree and names
 * the files whose rewind is deliberate. A main that moves is rebased onto and
 * landed again, and the commit is confirmed on the remote. A worktree whose
 * landing fails is kept for whoever finishes it. */
export let onMain = async (
  root: string,
  name: string,
  { run, out, note }: Landing,
  make: (tree: string, need: Need) => Promise<string[]>,
  check?: (base: string, need: Need) => Promise<void>,
): Promise<string> => {
  let need: Need = async (cwd, args, refusal) => {
    let r = await run(args, cwd)
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
      'local main differs from remote main; synchronize main first',
    )
  }
  await check?.(base, need)

  let named = `${name}-${crypto.randomUUID().slice(0, 8)}`
  let parent = `${root}/.claude/worktrees`
  await fs.mkdir(parent, { recursive: true })
  let tree = `${parent}/${named}`
  await need(root, ['worktree', 'add', '-b', named, tree, 'main'])
  let kept = true
  note(`landing worktree: ${tree}`)
  try {
    let allow = await make(tree, need)
    for (let attempt = 0; attempt < 3; attempt++) {
      let outcome = await land({
        cwd: tree,
        allow,
        run,
        write: (line, error) => (error ? note : out)(line.trimEnd()),
      })
      if (!('landed' in outcome)) {
        if (outcome.conflict) {
          throw new Error('rebase conflicts need resolution')
        }
        note('main moved; landing the rebased commit')
        continue
      }
      let commit = outcome.landed
      // land deliberately treats a failed push as a successful local merge.
      // Confirm publication before removing its recovery worktree.
      await need(tree, ['fetch', remote, 'main'])
      let published = await run([
        'merge-base',
        '--is-ancestor',
        commit,
        'FETCH_HEAD',
      ], tree)
      if (!published.ok) {
        throw new Error(`${commit} landed locally but was not pushed to main`)
      }
      await need(root, ['worktree', 'remove', tree])
      kept = false
      await need(outcome.root, ['branch', '-d', named])
      return commit
    }
    throw new Error('main kept moving through three landing attempts')
  } catch (e) {
    if (kept) note(`worktree kept at ${tree}`)
    throw e
  }
}
