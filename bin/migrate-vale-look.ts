// Move the first appearance of each old Mossvale hero to a look row; the
// newest kept look, if any, stays newest. One-time operator script.
type Row = {
  entity: { eid: string }
  player?: Record<string, unknown>
  look?: Record<string, unknown>
}
let [mode, path, app] = Deno.args
if (!(mode == '--admin' || mode?.startsWith('--as=')) || !path || !app) {
  throw new Error(
    'usage: migrate-vale-look.ts --admin|--as=account export.json space/vale',
  )
}
let rows = JSON.parse(await Deno.readTextFile(path)) as Row[]
let prior = new Set(
  rows.filter((r) => r.look).map((r) => String(r.look?.player)),
)
let fields = ['name', 'tint', 'hair', 'skin'] as const
let moves = rows.filter((r) => r.player).flatMap((r) => {
  let old = r.player!
  let kept = Object.fromEntries(
    fields.filter((k) => typeof old[k] == 'string').map((k) => [k, old[k]]),
  )
  if (!Object.keys(kept).length) return []
  let patch = {
    $app: app,
    entity: { eid: r.entity.eid },
    player: Object.fromEntries(fields.map((k) => [k, null])),
  }
  return prior.has(r.entity.eid) ? [patch] : [
    {
      $app: app,
      entity: { eid: crypto.randomUUID() },
      look: { player: r.entity.eid, ...kept, at: 0 },
    },
    patch,
  ]
})
let call = async (change: unknown[]) => {
  let file = await Deno.makeTempFile({ suffix: '.json' })
  try {
    await Deno.writeTextFile(file, JSON.stringify(change))
    let p = await new Deno.Command('yak', {
      args: ['admin', 'tool', 'graph_apply', `change=@${file}`, mode, '--json'],
      stdout: 'piped',
      stderr: 'piped',
    }).output()
    let out = JSON.parse(new TextDecoder().decode(p.stdout))
    if (!p.success || out.result?.some((r: { error?: unknown }) => r.error)) {
      throw new Error(new TextDecoder().decode(p.stderr) + JSON.stringify(out))
    }
    return out
  } finally {
    await Deno.remove(file)
  }
}
for (let i = 0; i < moves.length; i += 40) await call(moves.slice(i, i + 40))
console.log(
  `${app}: ${moves.length} patches for ${
    rows.filter((r) => r.player).length
  } heroes`,
)
