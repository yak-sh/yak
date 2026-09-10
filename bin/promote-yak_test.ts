import { assertEquals } from '@std/assert'

Deno.test('production promotion creates and fast-forwards deploy, refusing stale gates and rewinds', async () => {
  let dir = await Deno.makeTempDir()
  let run = async (command: string, args: string[], cwd = dir) => {
    let out = await new Deno.Command(command, {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    return { code: out.code, text: new TextDecoder().decode(out.stdout).trim() }
  }
  let git = (...args: string[]) => run('git', args)
  let promote = (sha: string) =>
    run('sh', [new URL('./promote-yak', import.meta.url).pathname, sha])
  try {
    assertEquals((await git('init', '--initial-branch=main')).code, 0)
    await git('config', 'user.name', 'Test')
    await git('config', 'user.email', 'test@example.com')
    await run('git', ['init', '--bare', `${dir}/remote.git`])
    await git('remote', 'add', 'origin', `${dir}/remote.git`)
    await git('commit', '--allow-empty', '-m', 'first')
    let first = (await git('rev-parse', 'HEAD')).text
    await git('push', 'origin', 'main')
    assertEquals((await promote(first)).code, 0)
    assertEquals(
      (await git('rev-parse', 'refs/remotes/origin/deploy')).text,
      first,
    )
    await git('commit', '--allow-empty', '-m', 'second')
    let second = (await git('rev-parse', 'HEAD')).text
    // Neither an unpushed checkout nor a mismatched tested SHA may deploy.
    assertEquals((await promote(second)).code, 1)
    assertEquals((await promote(first)).code, 1)
    await git('push', 'origin', 'main')
    await git('checkout', '--detach', first)
    assertEquals((await promote(first)).code, 1)
    await git('checkout', 'main')
    assertEquals((await promote(second)).code, 0)
    assertEquals(
      (await git('rev-parse', 'refs/remotes/origin/deploy')).text,
      second,
    )
    // Even a forced rewind of main cannot make promotion rewind production.
    await git('push', '--force', 'origin', `${first}:refs/heads/main`)
    await git('checkout', '--detach', first)
    assertEquals((await promote(first)).code == 0, false)
    assertEquals(
      (await git('rev-parse', 'refs/remotes/origin/deploy')).text,
      second,
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
})
