// One-time (T-131260, D-130750): an oracle stops being a mechanism of its own.
//
//   deno run -A bin/migrate-oracles.ts <config> [--apply]
//
// - The topic carrying topic_context{parent, self, children} (Q-129870) gets
//   an oracle persona: a homeless persona with role{surface, scope} on the
//   topic, its body the self record. Its children record becomes the
//   descendant-context persona D, which the oracle persona contains, along
//   with the topic. The parent record folds into the topic's cover. Each
//   record's citations, either way, move to what it became, and the three
//   records and the component go.
// - A dialogue a person opened with an oracle is kept: it becomes a session
//   wearing the oracle persona of the topic it asked, with oracle_dialogue
//   cleared. Every other oracle_tree, oracle, oracle_child and oracle_dialogue
//   row is deleted; their entries and links go with them.
//
// Without --apply it counts, lists every reference into the rows it would
// delete from outside them, and writes nothing. Writes go through the graph,
// signed as the session running it. A second run finds nothing to do.

import { compose, facet } from '@yaks/cli/host'
import { type Bundle, mint, token } from '@yaks/graph'
import { link } from '@yaks/edge'
import { read } from '../packages/cli/config.ts'
import { signer } from '../packages/cli/local.ts'
import { via } from '../packages/cli/run.ts'

let [path] = Deno.args.filter((a) => !a.startsWith('--'))
if (!path) throw Error('Usage: migrate-oracles.ts CONFIG [--apply]')
let apply = Deno.args.includes('--apply')

let host = await compose(read(path), ['graph'], facet, {
  process: false,
  readOnly: !apply,
})
let g = host.graph
let say = (name: string, value: unknown) =>
  console.log(JSON.stringify({ name, value }))
let q = (query: string) => Promise.resolve(g.read(query))
let count = async (query: string) =>
  Number((await g.rows(`${query} .count`))[0]?.n ?? 0)
let comp = (b: Bundle, name: string) =>
  b[name] as Record<string, unknown> | undefined
let { $actor } = await signer(host, via(), false)
if (!$actor?.via) throw Error('no session to sign as: run it from one')
say('writer', $actor)
let write = (bundles: Bundle[]) =>
  g.apply(bundles.map((b) => ({ ...b, $actor })))

let counts = async () => ({
  topic_context: await count('.topic_context'),
  oracle_tree: await count('.oracle_tree'),
  oracle: await count('.oracle'),
  oracle_child: await count('.oracle_child'),
  oracle_dialogue: await count('.oracle_dialogue'),
  role_persona: await count('.role .persona'),
  persona: await count('.persona'),
  session: await count('.session'),
  entry: await count('.entry'),
  edge: await count('.edge'),
  cites: await count('.cites'),
})

try {
  say('before', await counts())

  // The oracle persona of a topic, made from its topic_context.
  let oracles = new Map<string, string>()
  for (let b of await q('.topic_context *')) {
    let topic = b.entity.eid
    let ctx = comp(b, 'topic_context')!
    let records = [ctx.parent, ctx.self, ctx.children].map(String)
    let got = await g.get(records)
    let [parent, self, children] = records.map((eid) =>
      String(comp(got.find((r) => r.entity.eid == eid)!, 'content')!.body)
    )
    let cover = String(comp(b, 'doc')!.body)
    let title = String(comp(b, 'doc')!.title)
    let oracle = mint(), d = mint()
    oracles.set(topic, oracle)
    // Each record's citations, both ways, move to what it became.
    let into = new Map([
      [records[0], topic],
      [records[1], oracle],
      [records[2], d],
    ])
    let cited: Bundle[] = []
    for (let [record, now] of into) {
      for (let dir of ['from', 'to'] as const) {
        for (let c of await q(`.cites .edge.${dir}=${record} *`)) {
          let { from, to } = comp(c, 'edge') as { from: string; to: string }
          let ends = dir == 'from' ? [now, to] : [from, now]
          cited.push({
            ...link(ends[0], 'cites', ends[1]),
            cites: { hash: comp(c, 'cites')!.hash },
          })
        }
      }
    }
    let made: Bundle[] = [
      {
        entity: { eid: oracle },
        persona: {},
        role: { surface: 'native', scope: topic },
        doc: { title: `${title} oracle`, body: self },
      },
      {
        entity: { eid: d },
        persona: {},
        doc: { title: `${title}: descendant context`, body: children },
      },
      link(oracle, 'contains', topic, 1),
      link(oracle, 'contains', d, 2),
      {
        entity: { eid: topic },
        doc: { body: `${cover}\n\n${parent}` },
        topic_context: null,
        $was: { doc: { body: token(cover) } },
      },
      ...cited,
      ...records.map((eid) => ({ entity: { eid }, $delete: true as const })),
    ]
    say('oracle', { topic, oracle, d, cites: cited.length })
    if (apply) await write(made)
  }
  // The oracle persona of each topic that already has one.
  let topics = new Set((await q('.topic')).map((b) => b.entity.eid))
  for (let b of await q('.role .persona *')) {
    let scope = String(comp(b, 'role')?.scope)
    if (topics.has(scope) && !oracles.has(scope)) {
      oracles.set(scope, b.entity.eid)
    }
  }

  // A person's dialogue is theirs: it moves; the bench's go.
  let people = new Set((await q('.person')).map((b) => b.entity.eid))
  let dialogues = await q('.oracle_dialogue *')
  let kept = dialogues.filter((b) => people.has(String(comp(b, 'created')?.by)))
  for (let b of kept) {
    let to = String(comp(b, 'oracle_dialogue')!.to)
    let oracle = oracles.get(to)
    if (!oracle) throw Error(`${b.entity.eid} asked ${to}, which has no oracle`)
    say('kept', { session: b.entity.eid, persona: oracle })
    if (apply) {
      await write([{
        entity: { eid: b.entity.eid },
        session: { persona: oracle },
        oracle_dialogue: null,
      }])
    }
  }
  let keep = new Set(kept.map((b) => b.entity.eid))
  let doomed = [
    ...await q('.oracle_tree'),
    ...await q('.oracle'),
    ...dialogues.filter((b) => !keep.has(b.entity.eid)),
  ].map((b) => b.entity.eid)
  let links = (await q('.oracle_child')).map((b) => b.entity.eid)

  if (!apply) {
    // Their entries go with them: who wrote those, and what points into any
    // of it from outside.
    let entries: string[] = [], by = new Map<string, number>()
    for (let eid of doomed) {
      for (let e of await q(`.entry.session=${eid} .fields=created.by`)) {
        entries.push(e.entity.eid)
        let who = String(comp(e, 'created')?.by)
        if (people.has(who)) by.set(who, (by.get(who) ?? 0) + 1)
      }
    }
    say('entries', {
      entries: entries.length,
      by_people: Object.fromEntries(by),
    })
    let inside = new Set([...doomed, ...links, ...entries])
    let outside: Record<string, string[]> = {}
    for (let eid of [...doomed, ...entries]) {
      for (let r of await q(`.refs=${eid}`)) {
        if (inside.has(r.entity.eid)) continue
        ;(outside[eid] ??= []).push(r.entity.eid)
      }
    }
    say('outside references', outside)
  }
  say('delete', { roots: doomed.length, links: links.length })
  if (apply) {
    for (let i = 0; i < links.length; i += 200) {
      await write(
        links.slice(i, i + 200).map((eid) => ({
          entity: { eid },
          $delete: true as const,
        })),
      )
    }
    for (let i = 0; i < doomed.length; i += 20) {
      await write(
        doomed.slice(i, i + 20).map((eid) => ({
          entity: { eid },
          $delete: true as const,
        })),
      )
    }
  }
  say('after', await counts())
} finally {
  await host.close()
}
