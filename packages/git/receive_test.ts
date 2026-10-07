// Scratch graph plus ordinary Git over a socket: publication, pack rejection,
// and the ref race are checked where callers encounter them.
import { equal, ok, test } from '@yaks/testing'
import type { Machine, Proc } from '@yaks/machine'
import { advertise, MAIN, type Refs, uploadPack } from './http.ts'
import { objects } from './objects.ts'
import { concat } from './oid.ts'
import { FLUSH, mark, pkt } from './pkt.ts'
import {
  acceptPack,
  advertiseReceive,
  receiveBranch,
  receivePack,
  ZERO,
} from './receive.ts'
import { moved, refAt, type Repo } from './refs.ts'
import { fixture, git } from './testing.ts'

let dec = new TextDecoder()
let app = 'b2a13829-b705-493a-b248-90837dc34f7a'

// This explicitly lent machine owns only the test's scratch directory. The
// receive implementation must use its doors, not local Deno file operations.
let localMachine = (): Machine => {
  let procs = new Map<string, Proc>()
  return {
    poll: 1,
    start: (command, cwd) => {
      let id = crypto.randomUUID()
      procs.set(id, {})
      let p = new Deno.Command('bash', {
        args: ['-c', command],
        cwd,
        stdout: 'null',
        stderr: 'null',
      }).spawn()
      p.status.then(({ code }) => procs.set(id, { exit: { code } }))
      return Promise.resolve(id)
    },
    look: (id) => Promise.resolve(procs.get(id) ?? null),
    tail: () => Promise.resolve([]),
    kill: () => Promise.resolve(),
    read: (path) => Deno.readTextFile(path),
    write: async (path, content) => {
      await Deno.mkdir(path.slice(0, path.lastIndexOf('/')), {
        recursive: true,
      })
      await Deno.writeTextFile(path, content)
    },
  }
}

let packed = async (cwd: string, tip: string, old?: string) => {
  let proc = new Deno.Command('git', {
    args: ['pack-objects', '--stdout', '--revs', ...old ? ['--thin'] : []],
    cwd,
    stdin: 'piped',
    stdout: 'piped',
    stderr: 'piped',
  }).spawn()
  let w = proc.stdin.getWriter()
  await w.write(
    new TextEncoder().encode(tip + '\n' + (old ? '^' + old + '\n' : '')),
  )
  await w.close()
  let out = await proc.output()
  equal(out.code, 0, dec.decode(out.stderr))
  return out.stdout
}

let scratch = async (
  fn: (dir: string, repo: Repo, machine: Machine) => Promise<void>,
) => {
  let dir = await Deno.makeTempDir({ prefix: 'T-66426-receive-' })
  let { g, bytes } = fixture()
  let repo: Repo = { refs: g, objects: g, bytes }
  await g.apply([{ entity: { eid: app } }])
  try {
    await git(dir, 'init', '-q', '-b', 'main')
    await git(dir, 'config', 'user.name', 'Receiver test')
    await git(dir, 'config', 'user.email', 'receive@example.test')
    await fn(dir, repo, localMachine())
    equal(
      [...Deno.readDirSync(dir)].some((e) =>
        e.name.startsWith('.yak-receive-')
      ),
      false,
    )
  } finally {
    await Deno.remove(dir, { recursive: true })
  }
}

let commit = async (dir: string, value: string) => {
  await Deno.writeTextFile(dir + '/file', value)
  await git(dir, 'add', '.')
  await git(dir, 'commit', '-qm', value.slice(0, 40))
  return git(dir, 'rev-parse', 'HEAD')
}
let rejected = async (fn: () => Promise<unknown>) => {
  let failed = false
  try {
    await fn()
  } catch {
    failed = true
  }
  ok(failed, 'receiver must reject')
}
let request = (old: string, tip: string, pack: Uint8Array, names = [MAIN]) =>
  new Request('http://x/git-receive-pack', {
    method: 'POST',
    body: concat([
      ...names.map((name, i) =>
        pkt(`${old} ${tip} ${name}${i == 0 ? '\0report-status' : ''}\n`)
      ),
      mark(FLUSH),
      pack,
    ]),
  })

test('ordinary git push bootstraps, thin incremental push lands, and clone preserves objects', async () => {
  await scratch(async (dir, repo, machine) => {
    let refs: Refs = {
      list: async () => {
        let at = await refAt(repo.refs, app)
        return at ? [{ name: MAIN, oid: at }] : []
      },
    }
    let decoder = { machine, cwd: dir }
    let from = objects(repo.objects, repo.bytes)
    let server = Deno.serve({ port: 0, onListen: () => {} }, (req) => {
      let url = new URL(req.url)
      if (url.pathname.endsWith('/info/refs')) {
        return url.searchParams.get('service') == 'git-receive-pack'
          ? advertiseReceive(req, refs)
          : advertise(req)
      }
      if (url.pathname.endsWith('/git-receive-pack')) {
        return receivePack(req, repo, app, decoder)
      }
      return uploadPack(req, refs, from)
    })
    try {
      let url = `http://127.0.0.1:${server.addr.port}/a.git`
      let content = Array.from(
        { length: 400 },
        (_, i) => `line ${i}: original data\n`,
      ).join('')
      let one = await commit(dir, content)
      await git(dir, 'push', url, 'HEAD:refs/heads/main')
      equal(await refAt(repo.refs, app), one)
      let two = await commit(dir, content + 'incremental\n')
      await git(dir, 'push', url, 'HEAD:refs/heads/main')
      equal(await refAt(repo.refs, app), two)
      let clone = `${dir}/clone`
      await git(dir, '-c', 'protocol.version=2', 'clone', '-q', url, clone)
      equal(await git(clone, 'rev-parse', 'HEAD'), two)
      equal(await Deno.readTextFile(clone + '/file'), content + 'incremental\n')
      await git(clone, 'fsck', '--strict')
      // --force reaches the receiver; ordinary git would reject locally.
      await git(dir, 'checkout', '--orphan', 'unrelated')
      await git(dir, 'rm', '-rf', '.')
      await commit(dir, 'unrelated')
      await rejected(() =>
        git(dir, 'push', '--force', url, 'HEAD:refs/heads/main')
      )
      equal(await refAt(repo.refs, app), two)
    } finally {
      await server.shutdown()
    }
  })
})

test('stale, non-FF, duplicate commands, corrupt and incomplete packs never publish', async () => {
  await scratch(async (dir, repo, machine) => {
    let one = await commit(dir, 'one')
    let full = await packed(dir, one)
    let decoder = { machine, cwd: dir }
    await acceptPack(repo, { app, old: null, commit: one, pack: full }, decoder)
    let two = await commit(dir, 'two')
    let next = await packed(dir, two, one)
    let receive = (
      old: string,
      tip: string,
      pack: Uint8Array,
      names?: string[],
    ) => receivePack(request(old, tip, pack, names), repo, app, decoder)
    ok((await (await receive(ZERO, two, next)).text()).includes('stale'))
    ok(
      (await (await receive(one, two, next, [MAIN, MAIN])).text()).includes(
        'exactly one',
      ),
    )
    ok(
      (await (await receive(one, two, next, [MAIN, 'refs/heads/other'])).text())
        .includes('exactly one'),
    )
    let corrupt = full.slice()
    corrupt[corrupt.length - 1] ^= 1
    ok(
      (await (await receive(one, two, corrupt)).text()).includes(
        'unpack receive:',
      ),
    )
    equal(await refAt(repo.refs, app), one)
    equal((await repo.objects.read(`.gitobj&.entity.eid=${two}`)).length, 0)
    // A valid pack containing only the commit is not a complete closure.
    let proc = new Deno.Command('git', {
      args: ['pack-objects', '--stdout'],
      cwd: dir,
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped',
    }).spawn()
    let w = proc.stdin.getWriter()
    await w.write(new TextEncoder().encode(two + '\n'))
    await w.close()
    let incomplete = await proc.output()
    equal(incomplete.code, 0)
    await rejected(() =>
      acceptPack(
        repo,
        { app, old: one, commit: two, pack: incomplete.stdout },
        decoder,
      )
    )
    equal(await refAt(repo.refs, app), one)
    await acceptPack(repo, { app, old: one, commit: two, pack: next }, decoder)
    await rejected(() =>
      acceptPack(repo, { app, old: two, commit: one, pack: full }, decoder)
    )
    equal(await refAt(repo.refs, app), two)
  })
})

test('legacy observed ref imports full history, while the final CAS loses a concurrent writer', async () => {
  await scratch(async (dir, repo, machine) => {
    let one = await commit(dir, 'legacy one')
    let full = await packed(dir, one)
    await repo.refs.apply([moved(app, MAIN, one)])
    await acceptPack(repo, { app, old: one, commit: one, pack: full }, {
      machine,
      cwd: dir,
    })
    equal((await repo.objects.read(`.gitobj&.entity.eid=${one}`)).length, 1)
    let two = await commit(dir, 'proposed two')
    let proposal = await packed(dir, two, one)
    let competitor = 'f'.repeat(40)
    let racing: Repo = {
      ...repo,
      objects: {
        ...repo.objects,
        apply: async (bundles) => {
          let written = await repo.objects.apply(bundles)
          await repo.refs.apply([moved(app, MAIN, competitor)])
          return written
        },
      },
    }
    await rejected(() =>
      acceptPack(racing, { app, old: one, commit: two, pack: proposal }, {
        machine,
        cwd: dir,
      })
    )
    equal(await refAt(repo.refs, app), competitor)
  })
})

test('gitlink targets are not part of this repository closure', async () => {
  await scratch(async (dir, repo, machine) => {
    await git(
      dir,
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${'a'.repeat(40)},submodule`,
    )
    await git(dir, 'commit', '-qm', 'submodule')
    let tip = await git(dir, 'rev-parse', 'HEAD')
    await acceptPack(repo, {
      app,
      old: null,
      commit: tip,
      pack: await packed(dir, tip),
    }, { machine, cwd: dir })
    let reached = await objects(repo.objects, repo.bytes).reach([tip])
    equal(reached.includes('a'.repeat(40)), false)
    let stream = await objects(repo.objects, repo.bytes).pack([tip])
    ok((await new Response(stream).arrayBuffer()).byteLength > 0)
  })
})

test('branch syntax fails closed', () => {
  for (
    let name of [
      'refs/heads/a..b',
      'refs/heads/.x',
      'refs/heads/a.lock',
      'refs/heads/a//b',
      'refs/tags/v1',
      'refs/heads/a\nb',
      'refs/heads/a@{b',
      'refs/heads/a\\b',
    ]
  ) {
    equal(receiveBranch(name), false, name)
  }
  ok(receiveBranch('refs/heads/topic/a'))
})
