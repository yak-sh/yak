// One-time T-61627 migration of a Mossvale store: each creature's look moves
// from beast_design{size, dust, look} to a figure row of its own, read from
// apps/vale/seed/figures. Delete after the live run.
//
//   deno run -A bin/migrate-vale-figures.ts expand|contract space/vale --admin
//
// `expand` adds each creature's figure beside its old look, so a page on the
// old release keeps drawing; `contract` clears size, dust and look once the
// new release is live. Each phase writes only what is still to move, so a
// second run writes nothing. The figures were exported from the looks at
// 1d7663fcc, which this checks the store's looks against.
let [phase, app, who] = Deno.args
if (!['expand', 'contract'].includes(phase) || !app || !who?.startsWith('--')) {
  throw new Error(
    'usage: migrate-vale-figures.ts expand|contract space/vale --admin|--as=…',
  )
}
let as = who == '--admin' || who == '--owner' ? [who] : ['--as', who.slice(5)]
let EXPORTED = '1d7663fcc'

// Rows as the store answers them, read loosely: this runs once.
// deno-lint-ignore no-explicit-any
type Row = { entity: { eid: string }; [comp: string]: any }

let run = async (cmd: string, args: string[]) => {
  let p = await new Deno.Command(cmd, {
    args,
    stdout: 'piped',
    stderr: 'piped',
  }).output()
  let out = new TextDecoder().decode(p.stdout)
  if (!p.success) {
    throw new Error(new TextDecoder().decode(p.stderr) + out)
  }
  return out
}
let query = async (q: string): Promise<Row[]> => {
  let out = await run('yak', ['admin', 'query', app, q, ...as])
  return JSON.parse(out.slice(out.indexOf('[')))
}
let apply = async (change: Row[]) => {
  for (let i = 0; i < change.length; i += 50) {
    let file = await Deno.makeTempFile({ suffix: '.json' })
    try {
      let part = change.slice(i, i + 50).map((b) => ({ $app: app, ...b }))
      await Deno.writeTextFile(file, JSON.stringify(part))
      let out = JSON.parse(
        await run('yak', [
          'admin',
          'tool',
          'graph_apply',
          `change=@${file}`,
          ...as,
          '--json',
        ]),
      )
      if (out.isError || out.result?.isError) {
        throw new Error(JSON.stringify(out).slice(0, 2000))
      }
    } finally {
      await Deno.remove(file)
    }
    console.log(`  ${Math.min(i + 50, change.length)} / ${change.length}`)
  }
}

let rows = await query('.beast_design')
let counts: Record<string, number> = { creatures: rows.length }

if (phase == 'expand') {
  let figures = new Map<string, Row>(), looks = new Map<string, unknown>()
  for await (let f of Deno.readDir('apps/vale/seed/figures')) {
    let seed: Row[] = JSON.parse(
      await Deno.readTextFile(`apps/vale/seed/figures/${f.name}`),
    )
    for (let r of seed) figures.set(r.figure.of, r)
    let old: Row[] = JSON.parse(
      await run('git', [
        'show',
        `${EXPORTED}:apps/vale/seed/beasts/${f.name}`,
      ]),
    )
    for (let r of old) {
      if (r.beast_design) looks.set(r.entity.eid, r.beast_design.look)
    }
  }
  let held = new Set((await query('.figure')).map((r) => r.figure.of))
  let same = (a: unknown, b: unknown) => JSON.stringify(a) == JSON.stringify(b)
  let change: Row[] = []
  for (let r of rows) {
    let b = r.beast_design, eid = r.entity.eid
    if (held.has(eid)) continue
    let fig = figures.get(eid)
    if (!fig) throw new Error(`${b.name} (${eid}) has no seeded figure`)
    if (
      !same(b.look, looks.get(eid)) || b.size != fig.figure.size ||
      b.dust != fig.figure.dust
    ) throw new Error(`${b.name}: the store's look differs from the export`)
    change.push(fig)
    counts.figures = (counts.figures ?? 0) + 1
  }
  console.log(app, 'expand', counts)
  await apply(change)
} else {
  let change: Row[] = []
  for (let r of rows) {
    let b = r.beast_design
    if (b.size == null && b.dust == null && b.look == null) continue
    change.push({
      entity: r.entity,
      beast_design: { size: null, dust: null, look: null },
    })
    counts.cleared = (counts.cleared ?? 0) + 1
  }
  console.log(app, 'contract', counts)
  await apply(change)
}
