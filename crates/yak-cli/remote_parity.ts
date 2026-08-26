// Storage transparency, proven (T-22576): every read verb run TWICE against
// the same live graph — once from the FILE, once over the server's JSON wire
// — and the printed bytes must be identical. That equality IS the feature: a
// yak on a box with no graph file must be indistinguishable from one
// standing beside it.
//
//   deno run -A crates/yak-cli/remote_parity.ts [host] [db]
//
// Point BOTH arms at one FROZEN graph — a copy of the db, served by a probe
// server on its own port — or the diff reports the board moving between the
// two reads rather than a difference between the doors. Against the live
// pairing, expect false alarms on timestamps, a session's latest_seq, and any
// task a sibling agent moves mid-run.
//
//   cp ~/.tasks/snap/tasks.db /tmp/p/graph.db
//   DB_PATH=/tmp/p/graph.db PORT=5391 TASKS_EMBED=0 deno run -A --unstable-net \
//     --unstable-worker-options src/server.ts &
//   deno run -A crates/yak-cli/remote_parity.ts 127.0.0.1:5391 /tmp/p/graph.db
//
// Reads only. A slow harness by design — run it by hand or from the slow
// tier, never the 1ms gate.
let host = Deno.args[0] ?? '127.0.0.1:5173'
let bin = new URL('../../target/release/yak', import.meta.url).pathname
let db = Deno.args[1] ?? `${Deno.env.get('HOME')}/.tasks/tasks.db`

let up = await fetch(`http://${host}/providers`).then((r) => r.ok).catch(() =>
  false
)
if (!up) {
  console.error(`no live server at ${host} — refusing to run the parity proof`)
  Deno.exit(2)
}

// The FILE arm names DB_PATH (and drops TASKS_HOST so nothing can fall back
// to the wire mid-run); the WIRE arm names only TASKS_HOST, which is exactly
// the "laptop without a graph file" case.
let run = async (args: string[], env: Record<string, string>) => {
  let cmd = new Deno.Command(bin, {
    args,
    env: { ...env, PATH: Deno.env.get('PATH') ?? '' },
    clearEnv: true,
    stdout: 'piped',
    stderr: 'piped',
  })
  let { code, stdout, stderr } = await cmd.output()
  return {
    code,
    out: new TextDecoder().decode(stdout),
    err: new TextDecoder().decode(stderr),
  }
}

let file = (args: string[]) =>
  run(args, { DB_PATH: db, HOME: Deno.env.get('HOME') ?? '' })
let wire = (args: string[]) =>
  run(args, { TASKS_HOST: host, HOME: Deno.env.get('HOME') ?? '' })

// Verbs worth the diff: a task, a project, a design, a SESSION (the rolling
// session/spawn projection is the subtlest place the two doors can disagree),
// a comment target with a thread, the board, filtered boards, other kinds,
// and search — plus the two error paths.
let cases: string[][] = [
  ['show', 'T-22576'],
  ['show', 'P-19'],
  ['show', 'D-22530'],
  ['show', 'T-22550'],
  ['show', 'T-12452'],
  ['show', 'M-17862'],
  ['show', 'nonsuch-id-xyz'],
  // A QUARANTINED entity: the server screens it from /query, so the file
  // reader must screen it too or the doors disagree about what exists. Both
  // answering "no entity" is the pass — as is both showing it, on a graph
  // where this num is not quarantined.
  ['show', 'T-1947'],
  ['list'],
  ['list', '.project=P-19', '.status=open'],
  ['list', '.status=wip'],
  ['list', '.priority<=1', '.status=open'],
  ['list', 'projects'],
  ['list', '.kind=memory'],
  ['list', '.kind=design'],
  ['search', 'remote', 'source'],
  ['search', 'kernel'],
  ['search', 'zzzznotawordzzzz'],
]

// A session id is minted per run, so pick a real one off the live board
// rather than hardcoding: sessions are where the projection bites.
let sess = await fetch(`http://${host}/query?.kind=session&limit=3`)
  .then((r) => r.json())
  .catch(() => [])
for (let s of (sess as { entity?: { num?: number } }[]).slice(0, 3)) {
  if (s.entity?.num) cases.push(['show', `S-${s.entity.num}`])
}

let bad = 0
for (let args of cases) {
  let [a, b] = await Promise.all([file(args), wire(args)])
  let same = a.out == b.out && a.err == b.err && a.code == b.code
  console.log(`${same ? 'ok  ' : 'DIFF'}  yak ${args.join(' ')}`)
  if (same) continue
  bad++
  if (a.code != b.code) console.log(`      exit ${a.code} vs ${b.code}`)
  if (a.err != b.err) {
    console.log(`      stderr file: ${JSON.stringify(a.err.slice(0, 200))}`)
    console.log(`      stderr wire: ${JSON.stringify(b.err.slice(0, 200))}`)
  }
  // The first differing line is the whole story; a full dump would bury it.
  let al = a.out.split('\n'), bl = b.out.split('\n')
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] == bl[i]) continue
    console.log(`      line ${i + 1}`)
    console.log(`      file: ${JSON.stringify(al[i] ?? null)}`)
    console.log(`      wire: ${JSON.stringify(bl[i] ?? null)}`)
    break
  }
}

console.log(
  bad
    ? `\n${bad}/${cases.length} verbs differ`
    : `\nall ${cases.length} verbs identical file vs wire`,
)
Deno.exit(bad ? 1 : 0)
