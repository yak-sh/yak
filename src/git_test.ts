// The projection's commit, on scratch repos: it must take the paths it
// wrote and nothing else — not a neighbour's staged work, not a file git
// never heard of — and a repo that can't commit must cost a report, not a
// throw. Every case builds its own repo, so nothing here touches a live one.
import { assert, assertEquals } from '@std/assert'
import { commit } from './git.ts'

let dec = new TextDecoder()
let sh = async (cwd: string, ...args: string[]) => {
  let { success, stdout } = await new Deno.Command('git', {
    args: ['-C', cwd, ...args],
    stdout: 'piped',
    stderr: 'inherit',
  }).output()
  assert(success, `git ${args.join(' ')}`)
  return dec.decode(stdout).trim()
}

// The fixture: a repo tracking one projection file and one neighbour the
// projection has no business touching.
let repo = async () => {
  let dir = Deno.realPathSync(Deno.makeTempDirSync())
  await sh(dir, 'init', '-q', '-b', 'main')
  await sh(dir, 'config', 'user.email', 'test@example.com')
  await sh(dir, 'config', 'user.name', 'Test')
  await sh(dir, 'config', 'commit.gpgsign', 'false')
  Deno.mkdirSync(`${dir}/.tasks`)
  Deno.writeTextFileSync(`${dir}/.tasks/AGENTS.md`, 'one\n')
  Deno.writeTextFileSync(`${dir}/other.md`, 'work\n')
  await sh(dir, 'add', '.')
  await sh(dir, 'commit', '-qm', 'init')
  return dir
}
let write = (p: string, body: string) => (Deno.writeTextFileSync(p, body), p)

Deno.test('commit: takes the paths it wrote, leaves a staged neighbour staged', async () => {
  let dir = await repo()
  try {
    let file = write(`${dir}/.tasks/AGENTS.md`, 'two\n')
    // a concurrent agent's work, half of it staged
    write(`${dir}/other.md`, 'wip\n')
    await sh(dir, 'add', 'other.md')
    assertEquals(await commit([file], 'personas: materialize'), {
      committed: [dir],
      untracked: [],
      failed: [],
    })
    // the commit carries exactly the one path
    assertEquals(
      await sh(dir, 'show', '--name-only', '--format=%s', 'HEAD'),
      [
        'personas: materialize',
        '',
        '.tasks/AGENTS.md',
      ].join('\n'),
    )
    // and the neighbour is still staged, still uncommitted
    assertEquals(await sh(dir, 'diff', '--cached', '--name-only'), 'other.md')
    assertEquals(await sh(dir, 'show', 'HEAD:other.md'), 'work')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('commit: passes over the untracked, the unchanged, and the repo-less', async () => {
  let dir = await repo()
  try {
    let log = () => sh(dir, 'log', '--format=%s')
    let before = await log()
    // git has never heard of this path — writing it is our business,
    // adding it to someone's repo is not
    let fresh = write(`${dir}/.tasks/new.md`, 'hello\n')
    // tracked, but its bytes are HEAD's already: nothing to record
    let same = `${dir}/.tasks/AGENTS.md`
    // no repo at all
    let loose = write(`${Deno.makeTempDirSync()}/AGENTS.md`, 'hello\n')
    let out = await commit([fresh, same, loose], 'personas: materialize')
    assertEquals(out, {
      committed: [],
      untracked: [fresh, loose],
      failed: [],
    })
    assertEquals(await log(), before)
    assertEquals(await sh(dir, 'status', '--porcelain'), '?? .tasks/new.md')
    Deno.removeSync(loose.slice(0, loose.lastIndexOf('/')), { recursive: true })
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})

Deno.test('commit: a repo mid-merge keeps the file and reports the refusal', async () => {
  let dir = await repo()
  try {
    let file = write(`${dir}/.tasks/AGENTS.md`, 'two\n')
    // MERGE_HEAD is the state git itself reads: with one present it
    // refuses any partial commit ("cannot do a partial commit during a
    // merge") — the same wall a live conflict or rebase puts up.
    Deno.writeTextFileSync(
      `${dir}/.git/MERGE_HEAD`,
      await sh(dir, 'rev-parse', 'HEAD'),
    )
    let out = await commit([file], 'personas: materialize')
    assertEquals(out.committed, [])
    assertEquals(out.failed.length, 1)
    assert(out.failed[0].startsWith(`${dir}: `), out.failed[0])
    // the write survives, uncommitted — exactly where we started
    assertEquals(Deno.readTextFileSync(file), 'two\n')
    assertEquals(await sh(dir, 'log', '--format=%s'), 'init')
  } finally {
    Deno.removeSync(dir, { recursive: true })
  }
})
