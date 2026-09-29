// bin/tidy against a scratch repo and a scratch /tmp, never the live box: it
// collects only the worktrees that can lose nothing, and reaps only the
// headless browsers and profiles that outlived any probe.
import { test } from '@yaks/testing'
import { fileURLToPath } from 'node:url'
import { assert, assertEquals } from '@std/assert'

let script = fileURLToPath(new URL('./tidy', import.meta.url))
let decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
let exists = (path: string) => {
  try {
    return !!Deno.statSync(path)
  } catch {
    return false
  }
}

let git = async (cwd: string, ...args: string[]) => {
  let out = await new Deno.Command('git', {
    args: ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
    cwd,
  }).output()
  assert(out.success, decode(out.stderr))
  return decode(out.stdout).trim()
}

let fixture = async () => {
  let dir = await Deno.makeTempDir({ prefix: 'yak-tidy-' })
  let repo = `${dir}/repo`
  let tmp = `${dir}/tmp`
  await Deno.mkdir(repo)
  await Deno.mkdir(tmp)
  await git(repo, 'init', '-q', '-b', 'main')
  await Deno.writeTextFile(`${repo}/a`, 'a')
  await git(repo, 'add', 'a')
  await git(repo, 'commit', '-q', '-m', 'a')
  await git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
  return {
    dir,
    repo,
    tmp,
    // Everything it removed, one line each.
    tidy: async (age = 3600) => {
      let out = await new Deno.Command(script, {
        env: {
          // Unbounded and at full priority: a test waits behind nothing.
          YAK_TIDY_BOUND: '1',
          YAK_TIDY_REPO: repo,
          YAK_TIDY_TMP: tmp,
          YAK_TIDY_AGE: `${age}`,
        },
      }).output()
      assert(out.success, decode(out.stderr))
      return decode(out.stdout).split('\n').filter(Boolean)
    },
    close: () => Deno.remove(dir, { recursive: true }),
  }
}

test('tidy collects a worktree only when nothing in it can be lost', async () => {
  let f = await fixture()
  try {
    let add = async (
      name: string,
      at = `${f.repo}/.claude/worktrees/${name}`,
    ) => {
      await git(f.repo, 'worktree', 'add', '-q', '-b', name, at, 'main')
      return at
    }
    let done = await add('done')
    let ahead = await add('ahead')
    await git(ahead, 'commit', '-q', '--allow-empty', '-m', 'unmerged')
    let dirty = await add('dirty')
    await Deno.writeTextFile(`${dirty}/a`, 'changed')
    let untracked = await add('untracked')
    await Deno.writeTextFile(`${untracked}/b`, 'new')
    let locked = await add('locked')
    await git(f.repo, 'worktree', 'lock', locked)
    let outside = await add('outside', `${f.dir}/outside`)
    let busy = await add('busy')
    // Every index but busy's was last written four hours ago.
    let then = Date.now() / 1000 - 4 * 3600
    for (
      let name of ['done', 'ahead', 'dirty', 'untracked', 'locked', 'outside']
    ) {
      Deno.utimeSync(`${f.repo}/.git/worktrees/${name}/index`, then, then)
    }

    let out = await f.tidy()

    assertEquals(out.length, 1, out.join('\n'))
    assert(out[0].includes(done), out[0])
    let all = [done, ahead, dirty, untracked, locked, outside, busy]
    assertEquals(all.filter(exists), all.slice(1))
    assertEquals(
      (await git(f.repo, 'branch', '--format=%(refname:short)')).split('\n'),
      ['ahead', 'busy', 'dirty', 'locked', 'main', 'outside', 'untracked'],
    )
  } finally {
    await f.close()
  }
})

test('tidy reaps old headless browsers and unused profiles, and nothing else', async () => {
  let f = await fixture()
  let procs: Deno.ChildProcess[] = []
  // A stand-in for one Chrome process: its command line is all tidy reads.
  let browser = (dir: string, ...flags: string[]) => {
    let p = new Deno.Command('sh', {
      args: [
        '-c',
        'while sleep 1; do :; done',
        'chrome',
        ...flags,
        `--user-data-dir=${dir}`,
      ],
      stdout: 'null',
      stderr: 'null',
    }).spawn()
    procs.push(p)
    return p
  }
  // Running, and not a zombie waiting to be reaped.
  let alive = (p: Deno.ChildProcess) => {
    try {
      return Deno.readTextFileSync(`/proc/${p.pid}/cmdline`) != ''
    } catch {
      return false
    }
  }
  let profile = (name: string) => {
    let dir = `${f.tmp}/${name}`
    Deno.mkdirSync(`${dir}/Default`, { recursive: true })
    return dir
  }
  try {
    let headless = profile('cdp-probe')
    let headed = profile('cdp-probe1') // cdp-probe's name is its prefix
    let stale = profile('cdp-stale')
    let other = profile('other')
    let all = [headless, headed, stale, other]
    let chrome = browser(headless, '--headless=new')
    let renderer = browser(headless, '--type=renderer')
    let window = browser(headed)
    let orphan = browser(`${f.tmp}/cdp-gone`, '--headless')

    assertEquals(await f.tidy(), [], 'nothing is old yet')
    assertEquals(all.filter(exists), all)

    let out = await f.tidy(0)

    assertEquals(out.length, 3, out.join('\n'))
    await Promise.all([chrome.status, renderer.status, orphan.status])
    assert(alive(window))
    assertEquals(all.filter(exists), [headed, other])
  } finally {
    for (let p of procs) if (alive(p)) p.kill('SIGKILL')
    await Promise.all(procs.map((p) => p.status))
    await f.close()
  }
})
