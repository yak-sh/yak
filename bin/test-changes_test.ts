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

test('an edit is its declaration, and a line outside every declaration is the whole module', async () => {
  let text =
    "import { x } from './x.ts'\n\nexport let a = () =>\n  x\nlet b = 2"
  let at = (diff: string) =>
    edits({
      run: () => Promise.resolve(diff),
      at: 'HEAD',
      read: () => Promise.resolve(text),
    })
  equal(await at('+++ b/m.ts\n@@ -4 +4 @@'), { 'm.ts': ['a'] })
  equal(await at('+++ b/m.ts\n@@ -1 +1 @@\n@@ -5 +5 @@'), {
    'm.ts': ['*', 'b'],
  })
})
