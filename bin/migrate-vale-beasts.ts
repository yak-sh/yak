// One-time T-61626 migration of a Mossvale store: each creature row splits
// into its aspects (beast_design, combat, loot, sounds, an alias key), each haunt
// becomes a den row, slain.kind becomes slain.beast, and a deal that names a
// creature by its old kind names it by its alias. Delete after the live run.
//
//   deno run -A bin/migrate-vale-beasts.ts expand|contract space/vale --admin
//
// `expand` adds the new shape beside the old, so a page on the old release
// keeps playing; `contract` clears the old fields once the new release is
// live, and moves any fall an old page wrote meanwhile. Each phase reads the
// store first and writes only what is still to move, so a second run writes
// nothing. The den eids and sounds come from apps/vale/seed, which this
// checks the store's creatures against.
let [phase, app, who] = Deno.args
if (!['expand', 'contract'].includes(phase) || !app || !who?.startsWith('--')) {
  throw new Error(
    'usage: migrate-vale-beasts.ts expand|contract space/vale --admin|--as=…',
  )
}
let as = who == '--admin' || who == '--owner' ? [who] : ['--as', who.slice(5)]

// Rows as the store answers them, read loosely: this runs once.
// deno-lint-ignore no-explicit-any
type Row = { entity: { eid: string }; [comp: string]: any }

let yak = async (args: string[]) => {
  let p = await new Deno.Command('yak', {
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
  let out = await yak(['admin', 'query', app, q, ...as])
  return JSON.parse(out.slice(out.indexOf('[')))
}
// A hundred bundles a call; a deal alone, since each writer writes a deal at
// most once every 2s (vocab.json `pace`).
let apply = async (change: Row[]) => {
  let deals = change.filter((b) => b.deal)
  let rest = change.filter((b) => !b.deal)
  let parts = [
    ...Array.from(
      { length: Math.ceil(rest.length / 100) },
      (_, i) => rest.slice(i * 100, i * 100 + 100),
    ),
    ...deals.map((d) => [d]),
  ]
  let done = 0
  for (let part of parts) {
    if (part[0].deal) await new Promise((r) => setTimeout(r, 2100))
    let file = await Deno.makeTempFile({ suffix: '.json' })
    try {
      await Deno.writeTextFile(
        file,
        JSON.stringify(part.map((b) => ({ $app: app, ...b }))),
      )
      let out = await yak([
        'admin',
        'tool',
        'graph_apply',
        `change=@${file}`,
        ...as,
        '--json',
      ])
      if (!out.includes('"$said"') || out.includes('"$fault"')) {
        throw new Error(out.slice(0, 2000))
      }
    } finally {
      await Deno.remove(file)
    }
    console.log(`  ${done += part.length} / ${change.length}`)
  }
}

let seed: Row[] = []
for await (let f of Deno.readDir('apps/vale/seed/beasts')) {
  seed.push(
    ...JSON.parse(await Deno.readTextFile(`apps/vale/seed/beasts/${f.name}`)),
  )
}
let sounds: Row[] = JSON.parse(
  await Deno.readTextFile('apps/vale/seed/sounds.json'),
)
let creatures = new Map(
  seed.filter((r) => r.beast_design).map((r) => [r.entity.eid, r]),
)
let densOf = new Map<string, Row[]>()
for (let r of seed.filter((r) => r.den)) {
  densOf.set(r.den.beast, [...densOf.get(r.den.beast) ?? [], r])
}

let OLD = [
  'kind',
  'lvl',
  'hp',
  'dmg',
  'speed',
  'xp',
  'reach',
  'aggro',
  'respawn',
  'loot',
  'haunts',
  'boss',
]
let same = (a: unknown, b: unknown) => JSON.stringify(a) == JSON.stringify(b)
let clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v != null))

let rows = await query('.beast_design ?combat')
let slain = await query('.slain')
let deals = await query('.deal')
// Each creature's old kind, from its row while it has one, else its alias.
let kinds = new Map([
  ...(await query('.alias .key')).flatMap((r) =>
    String(r.key.value).startsWith('beast:')
      ? [[String(r.key.value).slice(6), r.key.of] as [string, string]]
      : []
  ),
  ...rows.filter((r) => r.beast_design.kind)
    .map((r) => [r.beast_design.kind, r.entity.eid] as [string, string]),
])
let counts: Record<string, number> = {
  creatures: rows.length,
  slain: slain.length,
  deals: deals.length,
}

// A fall's creature by eid, from its old kind.
let fell = (r: Row) => {
  let eid = kinds.get(r.slain.kind)
  if (!eid) {
    throw new Error(`slain ${r.entity.eid} names no creature: ${r.slain.kind}`)
  }
  return eid
}

if (phase == 'expand') {
  let change: Row[] = []
  // The sounds a creature names that the store does not hold yet.
  let held = new Set((await query('.sfx')).map((r) => r.entity.eid))
  let named = new Set(
    [...creatures.values()].flatMap((r) => [r.sounds.cry, r.sounds.step]),
  )
  for (let s of sounds) {
    if (held.has(s.entity.eid) || !named.has(s.entity.eid)) continue
    // A pinned clip (samples.ts) needs no recording: no body, no build.
    let doc = s.sfx.name == 'wolf' ? { title: s.doc.title } : s.doc
    change.push({ ...s, doc })
    counts.sounds = (counts.sounds ?? 0) + 1
  }
  let haveDens = new Set((await query('.den')).map((r) => r.entity.eid))
  for (let r of rows) {
    let b = r.beast_design, eid = r.entity.eid
    if (!b.kind) continue
    let s = creatures.get(eid)
    if (!s) throw new Error(`${b.kind} (${eid}) is not in the seed`)
    // The seed was cut from these rows: check each aspect says what the row does.
    let combat = clean({
      lvl: b.lvl,
      hp: b.hp,
      dmg: b.dmg,
      speed: b.speed,
      reach: b.reach,
      aggro: b.aggro,
      xp: b.xp,
      boss: b.boss || null,
    })
    if (
      s.alias.name != `beast:${b.kind}` || !same(clean(s.combat), combat) ||
      !same(s.loot.drops, b.loot) || s.beast_design.name != b.name
    ) throw new Error(`${b.kind}: the store's row differs from the seed`)
    let dens = densOf.get(eid) ?? []
    if (dens.length != b.haunts.length) throw new Error(`${b.kind}: dens`)
    b.haunts.forEach((h: Record<string, unknown>, i: number) => {
      let d = clean(dens[i].den)
      if (
        !same(
          d,
          clean({
            beast: eid,
            near: h.near,
            count: h.count,
            within: h.within,
            beyond: h.beyond,
            apart: h.apart,
            roam: h.roam,
            odds: h.odds,
            respawn: b.respawn,
          }),
        )
      ) {
        throw new Error(`${b.kind}: den ${i} differs from its haunt`)
      }
    })
    if (!r.combat) {
      change.push({
        entity: { eid },
        alias: s.alias,
        combat: s.combat,
        loot: s.loot,
        sounds: s.sounds,
      })
      counts.aspects = (counts.aspects ?? 0) + 1
    }
    for (let d of dens) {
      if (haveDens.has(d.entity.eid)) continue
      change.push(d)
      counts.dens = (counts.dens ?? 0) + 1
    }
  }
  for (let r of slain) {
    if (r.slain.beast || !r.slain.kind) continue
    change.push({ entity: r.entity, slain: { beast: fell(r) } })
    counts.falls = (counts.falls ?? 0) + 1
  }
  // A deal's words name a creature by its alias, as goods() reads them.
  let word = (part: string) => {
    let m = /^(\s*(?:\d+\s*)?x?\s*)(\S+?)(s|es)?(\s*)$/i.exec(part)
    let kind = m &&
      (kinds.has(m[2]) ? m[2] : kinds.has(m[2] + m[3]) ? m[2] + m[3] : null)
    return m && kind
      ? `${m[1]}beast:${kind}${kind == m[2] ? m[3] ?? '' : ''}${m[4]}`
      : part
  }
  for (let r of deals) {
    let take = r.deal.take
    if (typeof take != 'string') continue
    let next = take.split(/(,|;|\band\b|\+)/).map(word).join('')
    if (next == take) continue
    change.push({ entity: r.entity, deal: { take: next } })
    counts.dealt = (counts.dealt ?? 0) + 1
  }
  console.log(app, 'expand', counts)
  await apply(change)
} else {
  let change: Row[] = []
  for (let r of rows) {
    let b = r.beast_design
    if (!OLD.some((k) => b[k] != null)) continue
    change.push({
      entity: r.entity,
      beast_design: Object.fromEntries(OLD.map((k) => [k, null])),
    })
    counts.cleared = (counts.cleared ?? 0) + 1
  }
  for (let r of slain) {
    if (r.slain.kind == null) continue
    change.push({
      entity: r.entity,
      slain: { ...!r.slain.beast && { beast: fell(r) }, kind: null },
    })
    counts.falls = (counts.falls ?? 0) + 1
  }
  console.log(app, 'contract', counts)
  await apply(change)
}
