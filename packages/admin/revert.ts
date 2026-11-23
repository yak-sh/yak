// Revert a main commit and publish its correction, landed from the box
// (./landing.ts).

import { CallError } from '@yaks/tools/errors'
import type { Run } from '@yaks/git/land'
import { git } from './deploys.ts'
import { onMain } from './landing.ts'

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
  let target = ''
  let commit = await onMain(
    root,
    'yak-revert',
    { run, out, note },
    async (tree, need) => {
      await need(tree, ['revert', '--no-edit', target], 'sha')
      // These files are the explicit git revert, not a rebase that silently
      // restores older content. Keep the exception scoped to that patch.
      return (await need(tree, ['diff', '--name-only', '-z', 'HEAD^', 'HEAD']))
        .split('\0').filter(Boolean)
    },
    async (base, need) => {
      target = await need(
        root,
        ['rev-parse', '--verify', `${sha}^{commit}`],
        'sha',
      )
      let ancestor = await run(
        ['merge-base', '--is-ancestor', target, base],
        root,
      )
      if (!ancestor.ok) {
        let message = `${sha} is not an ancestor of main`
        if (ancestor.code == 1) throw new CallError('sha', message)
        throw new Error(message)
      }
    },
  )
  out(`pushed ${commit}; Workers Builds deploys in the background`)
  return 0
}
