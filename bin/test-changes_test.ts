import { equal, test } from '@yaks/testing'
import { changes, edits } from './test-changes.ts'

let changed = async (branch: string) => {
  let called: string[][] = []
  let run = (args: string[]) => {
    called.push(args)
    return Promise.resolve(
      args[0] == 'branch'
        ? `${branch}\n`
        : args[0] == 'merge-base' || args[0] == 'rev-parse'
        ? 'base-sha\n'
        : args[0] == 'diff'
        ? 'changed.ts\0renamed.ts\0'
        : 'new.ts\0changed.ts\0',
    )
  }
  let files = await changes({ run })
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
  equal(main.called[1], ['rev-parse', 'HEAD^'])
  equal(main.called[2], [
    'diff',
    '--name-only',
    '--no-renames',
    '-z',
    'base-sha',
  ])
})

test('a copied checkout uses the supplied base without consulting local refs', async () => {
  let calls: string[][] = []
  let run = (args: string[]) => {
    calls.push(args)
    return Promise.resolve('')
  }
  let comparison = { run, at: 'HEAD' }
  await changes(comparison)
  await edits(comparison)
  equal(calls, [
    ['diff', '--name-only', '--no-renames', '-z', 'HEAD'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
    ['diff', '-U0', '--no-renames', 'HEAD'],
  ])
})
