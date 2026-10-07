// Receive is verification before publication. Git decodes untrusted packs in
// an isolated scratch repository on an explicitly lent Machine; only verified
// raw object bodies enter the index, and a guarded ref write publishes them.
// No checkout, hook, config, or host filesystem is acquired here.

import { type Bundle, type Eid, token } from '@yaks/graph'
import { link } from '@yaks/edge'
import type { Machine } from '@yaks/machine'
import { BLOB, GITOBJ, PARENT, REF, TREE_ENTRY } from './comp.ts'
import { MAIN, type Refs } from './http.ts'
import { entryEid } from './index.ts'
import { objects } from './objects.ts'
import { concat, hex, type Kind, oid } from './oid.ts'
import { FLUSH, mark, pkt } from './pkt.ts'
import { moved, refAt, type Repo } from './refs.ts'

let text = new TextDecoder()
let ID = /^[0-9a-f]{40}$/
export let ZERO: string = '0'.repeat(40)

/** Branches only: no deletes, tags, pseudo refs, or ambiguous ref syntax. */
// deno-lint-ignore no-control-regex
let unsafeRef = /[\x00-\x20\x7f~^:?*\[\\]/
export let receiveBranch = (name: string): boolean =>
  name.startsWith('refs/heads/') && name.length > 'refs/heads/'.length &&
  !unsafeRef.test(name) &&
  !name.includes('..') && !name.includes('@{') &&
  name.split('/').every((p) =>
    !!p && !p.startsWith('.') &&
    !p.endsWith('.') && !p.endsWith('.lock')
  )

/** A decoder machine explicitly supplied by the host, never implicitly local. */
export type Decoder = { machine: Machine; cwd?: string }

/** One observed branch and the pack carrying its proposed commit. */
export type PackChange = {
  app: Eid
  branch?: string
  old: string | null
  commit: string
  pack: Uint8Array
}

let quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'"
let base64 = (bytes: Uint8Array) => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 32768) {
    out += String.fromCharCode(...bytes.subarray(i, i + 32768))
  }
  return btoa(out)
}
let unbase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

// Environment from a client's checkout must not redirect scratch Git's object
// database, config, alternates, or worktree. Every command uses this shell.
let clean = 'for n in ${!GIT_@}; do unset "$n"; done; ' +
  'export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0; '

let command = async (machine: Machine, dir: string, shell: string) => {
  let id = await machine.start(
    `(${clean}${shell}) > ${quote(dir + '/log')} 2>&1`,
  )
  while (true) {
    let p = await machine.look(id)
    if (!p) throw Error('receive: decoder process disappeared')
    if (p.exit) {
      if (p.exit.code != 0) {
        throw Error(
          'receive: ' +
            (await machine.read(dir + '/log')).trim().slice(0, 2000),
        )
      }
      return
    }
    await new Promise((resolve) => setTimeout(resolve, machine.poll ?? 100))
  }
}

type Raw = { id: string; type: Kind; body: string }

// cat-file is binary framed (size, then exactly that many bytes), not lines:
// signed commits, binary blobs and tree filenames must survive byte for byte.
let decodeScript = `import base64, json, subprocess, sys
repo, tip, output, old = sys.argv[1:]
git = ['git', '--git-dir=' + repo]
revisions = [tip] + (['^' + old] if old != '-' else [])
ids = subprocess.check_output(git + ['rev-list', '--objects', '--no-object-names'] + revisions).splitlines()
p = subprocess.Popen(git + ['cat-file', '--batch'], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
with open(output, 'w') as out:
    for oid in ids:
        p.stdin.write(oid + b'\\n'); p.stdin.flush()
        head = p.stdout.readline().split()
        if len(head) != 3: raise RuntimeError('missing object ' + oid.decode())
        size = int(head[2]); body = p.stdout.read(size)
        if len(body) != size or p.stdout.read(1) != b'\\n': raise RuntimeError('truncated object')
        out.write(json.dumps(dict(id=oid.decode(), type=head[1].decode(), body=base64.b64encode(body).decode())) + '\\n')
p.stdin.close()
if p.wait() != 0: raise RuntimeError('cat-file failed')
`

// The graph indexes links without rewriting the object's own body. Gitlinks
// are recorded as tree entries but not followed: submodule objects are in
// another repository and are legitimately absent from this pack.
let rows = async (raw: Raw[], repo: Repo): Promise<Bundle[]> => {
  let out: Bundle[] = []
  for (let o of raw) {
    if (!['blob', 'tree', 'commit'].includes(o.type) || !ID.test(o.id)) {
      throw Error('receive: unsupported object')
    }
    let bytes = unbase64(o.body)
    if (await oid(o.type, bytes) != o.id) {
      throw Error('receive: object hash mismatch')
    }
    let sha = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    await repo.bytes.put(sha, bytes)
    out.push({
      entity: { eid: o.id },
      [GITOBJ]: { type: o.type, size: bytes.length },
      [BLOB]: { sha },
    })
    if (o.type == 'commit') {
      let header = text.decode(bytes).split('\n\n', 1)[0]
      let parents = header.split('\n').filter((l) => l.startsWith('parent '))
      for (let [i, p] of parents.entries()) {
        out.push(link(o.id, PARENT, p.slice(7), i))
      }
    }
    if (o.type == 'tree') {
      let at = 0, ord = 0
      while (at < bytes.length) {
        let space = bytes.indexOf(32, at), nul = bytes.indexOf(0, space + 1)
        if (space < at || nul < space || nul + 21 > bytes.length) {
          throw Error('receive: malformed tree')
        }
        let mode = text.decode(bytes.subarray(at, space))
        let name = new TextDecoder('utf-8', { fatal: true }).decode(
          bytes.subarray(space + 1, nul),
        )
        let child = hex(bytes.subarray(nul + 1, nul + 21))
        out.push({
          entity: { eid: entryEid(o.id, name) },
          edge: { from: o.id, to: child, ord: ord++ },
          [TREE_ENTRY]: { name, mode },
        })
        at = nul + 21
      }
    }
  }
  return out
}

/**
 * Verify and import a SHA-1 pack, then publish its commit by fast-forward CAS.
 * `old` is the ref the caller observed, null before bootstrap. An old ref whose
 * objects are absent is allowed only if the incoming full pack supplies them
 * (legacy discovery recorded refs before it recorded objects). Immutable
 * object writes may precede a failed CAS; no failed verification moves a ref.
 */
export let acceptPack = async (
  repo: Repo,
  change: PackChange,
  decoder: Decoder,
): Promise<void> => {
  let branch = change.branch ?? MAIN
  if (
    !receiveBranch(branch) || !ID.test(change.commit) ||
    (change.old != null && !ID.test(change.old))
  ) throw Error('receive: invalid ref update')
  if (await refAt(repo.refs, change.app, branch) != change.old) {
    throw Error('receive: stale ref')
  }
  let { machine } = decoder
  let dir = `${decoder.cwd ?? '.'}/.yak-receive-${crypto.randomUUID()}`
  let git = `git --git-dir=${quote(dir + '/repo.git')}`
  // write makes only this unique directory, on the supplied machine.
  let indexedOld = false
  await machine.write(dir + '/incoming.b64', base64(change.pack))
  try {
    await command(
      machine,
      dir,
      `git init --bare --quiet ${quote(dir + '/repo.git')}`,
    )
    if (change.old) {
      let found = await repo.objects.read(`.gitobj&.entity.eid=${change.old}`)
      if (found.length) {
        indexedOld = true
        let seed = await objects(repo.objects, repo.bytes).pack([change.old])
        let bytes = new Uint8Array(await new Response(seed).arrayBuffer())
        await machine.write(dir + '/seed.b64', base64(bytes))
        await command(
          machine,
          dir,
          `base64 -d ${
            quote(dir + '/seed.b64')
          } | ${git} index-pack --strict --stdin`,
        )
      }
    }
    if (change.pack.length) {
      await command(
        machine,
        dir,
        `set -o pipefail; base64 -d ${
          quote(dir + '/incoming.b64')
        } | ${git} index-pack --strict --fix-thin --stdin`,
      )
    }
    await command(
      machine,
      dir,
      `${git} cat-file -e ${
        quote(change.commit + '^{commit}')
      } && ${git} fsck --strict --no-reflogs ${quote(change.commit)}`,
    )
    if (change.old) {
      await command(
        machine,
        dir,
        `${git} merge-base --is-ancestor ${quote(change.old)} ${
          quote(change.commit)
        }`,
      )
    }
    await machine.write(dir + '/decode.py', decodeScript)
    await command(
      machine,
      dir,
      `python3 ${quote(dir + '/decode.py')} ${quote(dir + '/repo.git')} ${
        quote(change.commit)
      } ${quote(dir + '/objects.json')} ${
        quote(indexedOld ? change.old! : '-')
      }`,
    )
    let raw = (await machine.read(dir + '/objects.json')).trim().split('\n')
      .filter(Boolean).map((line) => JSON.parse(line) as Raw)
    // Verification is complete. Import immutable objects in bounded batches,
    // not one transaction proportional to an entire repository's history.
    // The old closure seeded above is already indexed and need not be rewritten.
    for (let at = 0; at < raw.length; at += 100) {
      let bite = raw.slice(at, at + 100)
      let known = new Set((await repo.objects.read(
        `.gitobj&.entity.eid=${bite.map((o) => o.id).join(',')}`,
      )).map((b) => b.entity.eid))
      let fresh = bite.filter((o) => !known.has(o.id))
      if (fresh.length) await repo.objects.apply(await rows(fresh, repo))
    }
    let move = {
      ...moved(change.app, branch, change.commit),
      $was: { [REF]: { commit: token(change.old) } },
    }
    let applied = await repo.refs.apply([move])
    if (!applied.some((b) => b.entity.eid == move.entity.eid && b[REF])) {
      throw Error('receive: ref was deleted during acceptance')
    }
  } finally {
    await command(machine, dir, `rm -rf -- ${quote(dir)}`)
  }
}

let response = (body: Uint8Array<ArrayBuffer>, kind: string) =>
  new Response(body, {
    headers: {
      'content-type': `application/x-git-receive-pack-${kind}`,
      'cache-control': 'no-cache',
    },
  })

/** Receive uses Git's v0/v1 wire even when fetch uses v2. No force or delete. */
export let advertiseReceive = async (
  req: Request,
  refs: Refs,
): Promise<Response> => {
  if (
    req.method != 'GET' ||
    new URL(req.url).searchParams.get('service') != 'git-receive-pack'
  ) {
    return new Response('git: receive advertisement not found\n', {
      status: 404,
    })
  }
  let all = await refs.list()
  let caps = 'report-status object-format=sha1 agent=yaks'
  let lines = all.length
    ? all.map((r, i) => pkt(`${r.oid} ${r.name}${i == 0 ? '\0' + caps : ''}\n`))
    : [pkt(`${ZERO} capabilities^{}\0${caps}\n`)]
  return response(
    concat([
      pkt('# service=git-receive-pack\n'),
      mark(FLUSH),
      ...lines,
      mark(FLUSH),
    ]),
    'advertisement',
  )
}

/** Mount only after authorizing this repository's write; accepts one branch. */
export let receivePack = async (
  req: Request,
  repo: Repo,
  app: Eid,
  decoder: Decoder,
): Promise<Response> => {
  if (req.method != 'POST') return new Response('git: POST\n', { status: 405 })
  let branch = '', caps: string[] = [], old = '', commit = ''
  try {
    let stream = req.body ?? new Blob([]).stream()
    if (req.headers.get('content-encoding') == 'gzip') {
      stream = stream.pipeThrough(new DecompressionStream('gzip'))
    }
    let bytes = new Uint8Array(await new Response(stream).arrayBuffer())
    let at = 0, commands: string[] = []
    while (true) {
      let head = text.decode(bytes.subarray(at, at + 4))
      if (!/^[0-9a-f]{4}$/.test(head)) throw Error('receive: invalid pkt-line')
      let n = parseInt(head, 16)
      at += 4
      if (n == 0) break
      if (n < 4 || n > 65520 || at + n - 4 > bytes.length) {
        throw Error('receive: truncated pkt-line')
      }
      commands.push(
        text.decode(bytes.subarray(at, at + n - 4)).replace(/\n$/, ''),
      )
      at += n - 4
    }
    let first = commands[0]?.split('\0') ?? []
    caps = (first[1] ?? '').split(' ').filter(Boolean)
    let match = first[0]?.match(
      /^([0-9a-f]{40}) ([0-9a-f]{40}) (refs\/heads\/\S+)$/,
    )
    if (!match) throw Error('receive: invalid ref command')
    ;[, old, commit, branch] = match
    if (commands.length != 1 || first.length > 2) {
      throw Error('receive: exactly one ref command required')
    }
    if (
      caps.some((c) =>
        !['report-status', 'object-format=sha1', 'agent=git'].includes(c) &&
        !c.startsWith('agent=')
      )
    ) throw Error('receive: unsupported capability')
    if (commit == ZERO) throw Error('receive: deleting refs is not supported')
    await acceptPack(repo, {
      app,
      branch,
      old: old == ZERO ? null : old,
      commit,
      pack: bytes.subarray(at),
    }, decoder)
    return response(
      concat([pkt('unpack ok\n'), pkt(`ok ${branch}\n`), mark(FLUSH)]),
      'result',
    )
  } catch (e) {
    let reason = String(e instanceof Error ? e.message : e).replace(
      /[\r\n\0]/g,
      ' ',
    ).slice(0, 2000)
    return response(
      concat([
        pkt(`unpack ${reason}\n`),
        ...branch ? [pkt(`ng ${branch} ${reason}\n`)] : [],
        mark(FLUSH),
      ]),
      'result',
    )
  }
}
