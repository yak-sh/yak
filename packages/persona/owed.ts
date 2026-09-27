// The persona a checkout carries, and what an agent working in one is owed of
// it.
//
// A project's common persona is the one the project `contains` whose `home` is
// that project. The persona files write it into the checkout a person keeps as
// `.tasks/AGENTS.md` (./files.ts), and every checkout of the same repository
// carries the same persona, whether or not that file reaches it there: an
// agent's own worktree has the repository's links to `.tasks` but not the
// ignored directory they point into.
//
// So a harness starting an agent asks {@link owed} what to give it beside the
// instruction files its provider reads. A file says the persona only when its
// text is exactly the projection the persona files write, banner and all; one
// that names the same persona but was written before the graph last moved is
// stale, and the agent reading it is still owed the persona as it stands now.
//
// Pure reads of the graph: the caller reads the files, because only it knows
// which ones its provider reads.

import { and, eq, type Input, list, present } from '@yaks/query'
import {
  type Bundle,
  type Comp,
  type Eid,
  type Graph,
  Refused,
} from '@yaks/graph'
import { relations } from '@yaks/edge'
import { DOC, TITLE } from '@yaks/doc'
import { human } from '@yaks/id'
import { safe } from '@yaks/text'
import type { Vocab } from '@yaks/vocab'
import { PERSONA } from './comp.ts'
import { voice, type Worn } from './voice.ts'
import { CARRIES, wear } from './worn.ts'

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let str = (v: unknown): string => v == null ? '' : String(v)

let value = (eids: Eid[]): Input => eids.length == 1 ? eids[0] : list(...eids)

let eidOf = (b: Bundle): Eid => b.entity.eid

/** Each project's common persona: the one it `contains` whose home is that
 * project. A project with none is left out. */
export let commons = async (
  g: Graph,
  projects: Eid[],
): Promise<Map<Eid, Bundle>> => {
  let out = new Map<Eid, Bundle>()
  let tag = relations(g.vocab)[CARRIES]
  if (!tag || !projects.length) return out
  let homed = await g.storage.read(
    and(present(PERSONA), eq(`${PERSONA}.home`, value(projects))),
  )
  if (!homed.length) return out
  let held = new Set(
    (await g.storage.read(
      and(
        eq('edge.from', value(projects)),
        eq('edge.to', value(homed.map(eidOf))),
        present(tag),
      ),
    )).map((b) => `${comp(b, 'edge').from}|${comp(b, 'edge').to}`),
  )
  for (let p of homed.toSorted((a, b) => eidOf(a).localeCompare(eidOf(b)))) {
    let home = str(comp(p, PERSONA).home)
    if (!out.has(home) && held.has(`${home}|${eidOf(p)}`)) out.set(home, p)
  }
  return out
}

/** The line a persona file opens with: which persona it was generated from,
 * and where to edit it. */
export let banner = (vocab: Vocab): (persona: Bundle) => string => {
  let id = human(vocab)
  return (p) =>
    `<!-- GENERATED from ${id(p)} (${safe(str(comp(p, DOC)[TITLE]))}) — ` +
    'edit it in the graph, never here: the next sync overwrites hand edits. -->'
}

/** A persona as the file projecting it into a checkout says it: its
 * {@link banner}, then its {@link voice}. */
export let projection = (vocab: Vocab): (worn: Worn) => string => {
  let head = banner(vocab)
  let render = voice(vocab)
  return (w) => `${head(w.persona)}\n\n${render(w)}`
}

/** What an agent is owed: the persona's id, and its text. */
export type Owed = { source: string; text: string }

/**
 * What an agent working in the checkout at `path` is owed of the persona its
 * repository carries, given the text of each instruction file its provider
 * reads there. Nothing when a file already is that persona's projection, when
 * the graph knows no checkout at `path`, or when its project has no common
 * persona. Passing `persona` selects a graph persona instead of the checkout's
 * common one, even when the checkout is not known to the graph.
 *
 * ```ts ignore
 * let owes = await owed(g, '/srv/runs/S-1', [agentsMd])
 * if (owes) args.push('--append-system-prompt', owes.text)
 * ```
 */
export let owed = async (
  g: Graph,
  path: string,
  files: string[],
  persona?: string,
): Promise<Owed | undefined> => {
  if (persona) {
    let found = await g.address([persona])
    let worn = await wear(g.storage, g.vocab)(found.get(persona) ?? persona)
    if (!worn) throw new Refused(`no persona called ${persona}`)
    return files.includes(projection(g.vocab)(worn))
      ? undefined
      : { source: human(g.vocab)(worn.persona), text: voice(g.vocab)(worn) }
  }
  let needs = ['worktree', 'repo', 'project', PERSONA]
  if (!needs.every((c) => g.vocab.comp(c))) return
  let repos = (await g.storage.read(and(eq('worktree.path', path))))
    .map((b) => str(comp(b, 'worktree').repository)).filter(Boolean)
  if (!repos.length) return
  let projects = (await g.storage.read(
    and(present('project'), eq('repo.repository', value(repos))),
  )).filter((b) => !b.archived).map(eidOf).sort()
  let bases = await commons(g, projects)
  let base = projects.map((p) => bases.get(p)).find(Boolean)
  let worn = base && await wear(g.storage, g.vocab)(eidOf(base))
  if (!worn || files.includes(projection(g.vocab)(worn))) return
  return { source: human(g.vocab)(worn.persona), text: voice(g.vocab)(worn) }
}
