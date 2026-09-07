// Correct main, then wait for Workers Builds to serve the correction. Land is
// the same git primitive `task land` calls; its two outcomes matter here: a
// rebase needs another gate, and a local landing is not proof of a push.
import { land } from './land.ts'
import { git } from './repo.ts'
import { deploys, needGit, table } from './yak_deploys.ts'

export let revert = async (
  root: string,
  sha: string,
  out: (line: string) => void,
  note: (line: string) => void,
) => {
  let list = await needGit(root, ['worktree', 'list', '--porcelain'])
  if (!list.split('\n\n')[0].split('\n').includes('branch refs/heads/main')) {
    throw new Error(
      'task land must target main; the primary checkout is on another branch',
    )
  }
  let remote = await needGit(root, ['config', 'branch.main.remote'])
  let branch = await needGit(root, ['config', 'branch.main.merge'])
  if (!remote || remote == '.' || branch != 'refs/heads/main') {
    throw new Error('main needs a remote main upstream for Workers Builds')
  }
  await needGit(root, ['fetch', remote, 'main'])
  let base = await needGit(root, ['rev-parse', 'main'])
  if (base != await needGit(root, ['rev-parse', 'FETCH_HEAD'])) {
    throw new Error(
      'local main differs from remote main; synchronize main before reverting',
    )
  }
  let target = await needGit(root, ['rev-parse', '--verify', `${sha}^{commit}`])
  let ancestor = await git(root, ['merge-base', '--is-ancestor', target, base])
  if (!ancestor.ok) throw new Error(`${sha} is not an ancestor of main`)

  let name = `yak-revert-${crypto.randomUUID().slice(0, 8)}`
  let parent = `${root}/.claude/worktrees`
  await Deno.mkdir(parent, { recursive: true })
  let tree = `${parent}/${name}`
  await needGit(root, ['worktree', 'add', '-b', name, tree, 'main'])
  let kept = true
  note(`revert worktree: ${tree}`)
  // Preserve the worktree on failure: conflicts and failed gates are work an
  // owner can finish, not scratch that this command is entitled to erase.
  try {
    await needGit(tree, ['revert', '--no-edit', target])
    for (let attempt = 0; attempt < 3; attempt++) {
      note('gating the revert: deno task check')
      let check = await new Deno.Command(Deno.execPath(), {
        args: ['task', 'check'],
        cwd: tree,
        stdin: 'null',
      }).spawn().status
      if (!check.success) {
        throw new Error(`deno task check exited ${check.code}`)
      }
      let pushed = Date.now()
      let outcome = await land({
        cwd: tree,
        write: (line, error) => (error ? note : out)(line.trimEnd()),
      })
      if (!('landed' in outcome)) {
        if (outcome.conflict) {
          throw new Error('rebase conflicts need resolution')
        }
        note('main moved; gating the rebased revert before landing again')
        continue
      }
      let commit = outcome.landed
      // land deliberately treats a failed push as a successful local merge.
      // Confirm remote ancestry before starting a deployment watch.
      await needGit(tree, ['fetch', remote, 'main'])
      let published = await git(tree, [
        'merge-base',
        '--is-ancestor',
        commit,
        'FETCH_HEAD',
      ])
      if (!published.ok) {
        throw new Error(`${commit} landed locally but was not pushed to main`)
      }
      out(`pushed ${commit}; waiting for Workers Builds`)
      let due = Date.now() + 20 * 60_000
      let previous = ''
      while (Date.now() < due) {
        let rows = await deploys(root)
        let seen = table(rows)
        if (seen != previous) out(seen)
        previous = seen
        let live = rows.filter((r) => r.live > 0)
        let served = live.length > 0
        for (let row of live) {
          if (!row.commit || row.estimated) {
            served = false
            break
          }
          // A later main push may overtake this build. It also serves the
          // correction if its commit contains the revert.
          let known = await git(tree, [
            'cat-file',
            '-e',
            `${row.commit.sha}^{commit}`,
          ])
          if (!known.ok) await needGit(tree, ['fetch', remote, 'main'])
          let contains = await git(tree, [
            'merge-base',
            '--is-ancestor',
            commit,
            row.commit.sha,
          ])
          if (!contains.ok) served = false
        }
        if (served) {
          out(
            `${commit} live — push-to-live ${
              ((Date.now() - pushed) / 1000).toFixed(1)
            }s`,
          )
          await needGit(root, ['worktree', 'remove', tree])
          kept = false
          await needGit(outcome.root, ['branch', '-d', name])
          return 0
        }
        await new Promise((ok) => setTimeout(ok, 10_000))
      }
      throw new Error(
        `Workers Builds did not serve ${commit} within 20m; check yak deploys --owner and the build logs`,
      )
    }
    throw new Error('main kept moving through three gate attempts')
  } catch (e) {
    if (kept) note(`worktree kept at ${tree}`)
    throw e
  }
}
