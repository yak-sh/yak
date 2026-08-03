// The repository's git hooks, exercised through scratch pushes: a worktree
// branch has no upstream, so the pushed ref itself must define the commits
// screened for a wip marker. Nothing here changes this repository or its
// remote.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'

let dec = new TextDecoder()
let run = async (cwd: string, ...args: string[]) => {
  let out = await new Deno.Command('git', {
    args: ['-C', cwd, ...args],
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  return {
    success: out.success,
    stdout: dec.decode(out.stdout),
    stderr: dec.decode(out.stderr),
  }
}
let sh = async (cwd: string, ...args: string[]) => {
  let out = await run(cwd, ...args)
  assert(out.success, `git ${args.join(' ')}\n${out.stderr}`)
  return out.stdout.trim()
}

Deno.test('pre-push screens the pushed commits without needing an upstream', async () => {
  let base = Deno.realPathSync(Deno.makeTempDirSync())
  let origin = `${base}/origin.git`
  let repo = `${base}/repo`
  try {
    await sh(base, 'init', '--bare', '-q', '-b', 'main', origin)
    await sh(base, 'init', '-q', '-b', 'main', repo)
    await sh(repo, 'config', 'user.email', 'test@example.com')
    await sh(repo, 'config', 'user.name', 'Test')
    await sh(repo, 'config', 'commit.gpgsign', 'false')
    await sh(repo, 'remote', 'add', 'origin', origin)
    Deno.writeTextFileSync(`${repo}/file`, 'one\n')
    await sh(repo, 'add', 'file')
    await sh(repo, 'commit', '-qm', 'seed')
    await sh(repo, 'push', '-qu', 'origin', 'main')

    await sh(repo, 'switch', '-qc', 'agent')
    await sh(
      repo,
      'config',
      'core.hooksPath',
      Deno.realPathSync(new URL('../.githooks', import.meta.url)),
    )
    assertEquals((await run(repo, 'rev-parse', '@{upstream}')).success, false)

    Deno.writeTextFileSync(`${repo}/file`, 'two\n')
    await sh(repo, 'commit', '-qam', 'ship')
    let clean = await run(repo, 'push', 'origin', 'HEAD:main')
    assert(clean.success, clean.stderr)
    assertEquals(clean.stderr.includes('fatal:'), false)

    Deno.writeTextFileSync(`${repo}/file`, 'three\n')
    await sh(repo, 'commit', '-qam', 'wip')
    let wip = await run(repo, 'push', 'origin', 'HEAD:main')
    assertEquals(wip.success, false)
    assertStringIncludes(
      wip.stderr,
      "pre-push: a commit message contains a 'wip' line",
    )
    assertEquals(await sh(origin, 'show', 'main:file'), 'two')
  } finally {
    Deno.removeSync(base, { recursive: true })
  }
})
