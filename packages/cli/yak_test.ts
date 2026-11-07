// A command from a checkout loads its modules only between landings.
import { equal, test } from '@yaks/testing'
import * as disk from '@yaks/file/io'
import { command } from '@yaks/process/command'
import { hold } from '@yaks/git/hold'
import { common, steady } from './yak.ts'

// What `first` and `second` did, in order, once `second` waits on `first`
// holding the checkout for a moment.
let order = async (
  first: (gitdir: string) => Promise<() => void>,
  second: (gitdir: string) => Promise<() => void>,
) => {
  let root = await disk.makeTempDir()
  try {
    await command('git', { args: ['init', '-q', root] }).output()
    let did: string[] = []
    let held = await first(`${root}/.git`)
    let waited = second(`${root}/.git`).then((release) => {
      did.push('second')
      release()
    })
    await new Promise((r) => setTimeout(r, 50))
    did.push('first')
    held()
    await waited
    return did
  } finally {
    await disk.remove(root, { recursive: true })
  }
}

let landing = (gitdir: string) => hold(gitdir, true)
let loading = async (gitdir: string) => (await steady(`${gitdir}/..`))!

test('a command waits out a landing before it loads, and a landing waits for it', async () => {
  equal(await order(landing, loading), ['first', 'second'])
  equal(await order(loading, landing), ['first', 'second'])
  equal(await steady(await disk.makeTempDir()), undefined)
})

test("a worktree shares its checkout's Git directory", async () => {
  let root = await disk.realPath(await disk.makeTempDir())
  let git = (...args: string[]) =>
    command('git', { args: ['-C', root, ...args], stdout: 'null' }).output()
  try {
    await git('init', '-q')
    await git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      'commit',
      '-qm',
      '.',
      '--allow-empty',
    )
    await git('worktree', 'add', '-q', `${root}/w`)
    equal(await common(root), `${root}/.git`)
    equal(await common(`${root}/w`), `${root}/.git`)
  } finally {
    await disk.remove(root, { recursive: true })
  }
})
