import { equal, test } from '@yaks/testing'
import { changes } from './test-changes.ts'

let changed = async (branch: string) => {
  let called: string[][] = []
  let files = await changes(async (args) => {
    called.push(args)
    return args[0] == 'branch'
      ? `${branch}\n`
      : args[0] == 'merge-base'
      ? 'base-sha\n'
      : args[0] == 'diff'
      ? 'changed.ts\0renamed.ts\0'
      : 'new.ts\0changed.ts\0'
  })
  return { files, called }
}
let branch = await changed('topic')
let main = await changed('main')

test('branch selection includes committed, working and untracked changes once', () => {
  equal(branch.files, ['changed.ts', 'renamed.ts', 'new.ts'])
  equal(branch.called[1], ['merge-base', 'main', 'HEAD'])
  equal(branch.called[2], [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    'base-sha',
  ])
})

test('main selects the latest commit and working changes', () => {
  equal(main.called[1], ['diff', '--name-only', '--no-renames', '-z', 'HEAD^'])
})
