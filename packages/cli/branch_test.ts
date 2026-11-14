// Branches through a host's doors: a store with versions, its branch made,
// written, read and deleted the way any caller asks, a call through the
// runner, each call's record kept on main.

import { equal, test } from '@yaks/testing'
import { answerOf, toolEid } from '@yaks/tools'
import { type Bundle, mint } from '@yaks/graph'
import type { Facets } from '@yaks/host'
import type { Merged } from '@yaks/journal'
import { facet } from './words.ts'
import { compose } from './host.ts'

// What an effect saw committed, by title: a plugin of this test's own.
let observed: string[] = []
let load = <F extends keyof Facets>(spec: string, name: F) =>
  spec != 'watcher' ? facet(spec, name) : Promise.resolve(
    (name == 'graph'
      ? {
        plugins: () => [{
          name: 'watcher',
          hooks: {
            effect: (bs: Bundle[]) => {
              for (let b of bs) {
                let title = (b.doc as { title?: string } | undefined)?.title
                if (title) observed.push(title)
              }
              return bs
            },
          },
        }],
      }
      : null) as Facets[F] | null,
  )

let dir = Deno.makeTempDirSync()
let h = await compose(
  {
    db: `${dir}/graph.db`,
    plugins: [
      '@yaks/kernel',
      '@yaks/doc',
      { use: '@yaks/journal', with: { versions: true } },
      'watcher',
    ],
  },
  ['graph'],
  load,
)

// One call the way a door makes it, and its answer.
let ask = async (name: string, args: Record<string, unknown> = {}) => {
  let id = mint()
  let landed = await h.runner.call({
    entity: { eid: id },
    call: { to: toolEid(name), args },
  })
  return { id, answer: answerOf(landed, id) }
}
let value = (b: Bundle[]) =>
  (b.find((x) => x.output)?.output as { value: unknown }).value
let titles = (b: Bundle[]) => b.map((x) => (x.doc as { title: string }).title)

let seen = await (async () => {
  try {
    await h.runner.ensure()
    let kept = (await ask('graph_apply', {
      bundles: [{ entity: { eid: '$kept' }, doc: { title: 'kept' } }],
    })).answer.find((b) => b.doc)!.entity.eid
    let made = value((await ask('branch_new')).answer) as { id: number }
    let branch = made.id
    let wrote = await ask('graph_apply', {
      branch,
      bundles: [{ entity: { eid: '$draft' }, doc: { title: 'draft' } }],
    })
    let draft = wrote.answer.find((b) => b.doc)!.entity.eid
    let result = {
      onBranch: titles((await ask('graph_query', { q: '.doc', branch })).answer)
        .sort(),
      onMain: titles((await ask('graph_query', { q: '.doc' })).answer),
      shown: titles(
        (await ask('graph_show', { id: draft, branch })).answer.filter((b) =>
          b.doc
        ),
      ),
      recorded: !!(await h.graph.get([wrote.id]))[0]?.call,
      observed: [...observed],
      listed: (value((await ask('branch_list')).answer) as { id: number }[])
        .map((b) => b.id),
    }
    // Both sides change the kept page's title: a conflict, and nothing
    // merges until it is picked.
    let retitle = (title: string, on?: number) =>
      ask('graph_apply', {
        ...on ? { branch: on } : {},
        bundles: [{ entity: { eid: kept }, doc: { title } }],
      })
    await retitle('kept, drafted', branch)
    await retitle('kept, changed')
    let held = value(
      (await ask('branch_merge', { id: branch })).answer,
    ) as Merged
    let mainHeld = titles((await ask('graph_query', { q: '.doc' })).answer)
    let pick = held.conflicts.map(({ eid, comp, prop }) => ({
      eid,
      comp,
      prop,
      take: 'branch',
    }))
    let done = value(
      (await ask('branch_merge', { id: branch, pick })).answer,
    ) as Merged
    let merging = {
      conflicts: held.conflicts.map((
        c,
      ) => [c.comp, c.prop, c.fork, c.branch, c.main]),
      held: mainHeld,
      left: done.conflicts,
      merged: titles((await ask('graph_query', { q: '.doc' })).answer).sort(),
      observed: [...observed].sort(),
    }
    await ask('branch_delete', { id: branch })
    return {
      ...result,
      merging,
      left: value((await ask('branch_list')).answer),
      refused: !!(await ask('graph_query', { q: '.doc', branch })).answer
        .find((b) => b.refusal),
      made: typeof branch,
    }
  } finally {
    await h.close()
    Deno.removeSync(dir, { recursive: true })
  }
})()

test('a branch is made, written, read and deleted through the tools, main untouched and no effect reached', () =>
  equal(seen, {
    onBranch: ['draft', 'kept'],
    onMain: ['kept'],
    shown: ['draft'],
    recorded: true,
    observed: ['kept'],
    listed: [1],
    merging: {
      conflicts: [['doc', 'title', 'kept', 'kept, drafted', 'kept, changed']],
      held: ['kept, changed'],
      left: [],
      merged: ['draft', 'kept, drafted'],
      observed: ['draft', 'kept', 'kept, changed', 'kept, drafted'],
    },
    left: [],
    refused: true,
    made: 'number',
  }))
