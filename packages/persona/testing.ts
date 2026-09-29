// Shared test fixtures (not part of the published package — see deno.json): a
// graph with personas in it, over @yaks/ram, so the tests need no database and
// no server.
//
// The two edge relations are declared here rather than imported: `contains` is
// @yaks/task's and `reads` is @yaks/kernel's, and a test of what a persona
// includes has no business loading a to-do list to find out. A composed server
// loads the packages that own them; this declares the same two components.

import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import {
  type Bundle,
  type Comp,
  type Graph,
  graph,
  type Storage,
} from '@yaks/graph'
import { edgeDoc, edgeKeywords, link } from '@yaks/edge'
import { docDoc } from '@yaks/doc'
import { idKeywords } from '@yaks/id'
import { ram } from '@yaks/ram'
import { personaDoc } from './comp.ts'

let doc: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    contains: { component: true, type: 'object', edge: true },
    reads: { component: true, type: 'object', edge: true },
    memory: { component: true, type: 'object', kind: true, prefix: 'M' },
    proposed: { component: true, type: 'object' },
    decided: {
      component: true,
      type: 'object',
      properties: { verdict: { type: 'string' } },
    },
    // Where the persona files go: @yaks/project's project and its repo,
    // @yaks/git's repository and worktree, @yaks/kernel's archived, and a
    // name @yaks/alias keeps as a key.
    project: { component: true, type: 'object', kind: true, prefix: 'P' },
    repo: {
      component: true,
      type: 'object',
      properties: { repository: { type: 'string' } },
    },
    repository: {
      component: true,
      type: 'object',
      properties: { common: { type: 'string' } },
    },
    worktree: {
      component: true,
      type: 'object',
      properties: {
        repository: { type: 'string' },
        path: { type: 'string' },
        gitdir: { type: 'string' },
      },
    },
    archived: { component: true, type: 'object' },
    key: {
      component: true,
      type: 'object',
      properties: { of: { type: 'string' }, value: { type: 'string' } },
    },
    alias: { component: true, type: 'object' },
  },
}

/** A vocabulary with the persona components, both relations, and ids. */
export let said: Vocab = loadVocab(
  [edgeDoc, docDoc, personaDoc, doc],
  [edgeKeywords, idKeywords],
)

let { contains: _carries, ...rest } = doc.$defs ?? {}

/** The same vocabulary without `contains` — a server that did not compose
 * @yaks/task. */
export let thin: Vocab = loadVocab(
  [edgeDoc, docDoc, personaDoc, { $defs: rest }],
  [edgeKeywords, idKeywords],
)

/** A graph over a fresh in-memory store. */
export let world = (vocab: Vocab = said): Graph =>
  graph({ storage: ram(vocab, { number: true }), vocab })

/** The storage a graph is keeping its entities in. */
export let held = (g: Graph): Storage => g.storage

/** One entity with a `doc` on it, plus any other components given. */
export let says = (
  eid: string,
  title: string,
  body: string,
  wears: Record<string, Comp> = {},
): Bundle => ({ ...wears, entity: { eid }, doc: { title, body } })

/** A persona: a doc whose body is the instruction text. */
export let voiced = (eid: string, title: string, body: string): Bundle =>
  says(eid, title, body, { persona: {} })

/** A memory: a doc somebody wrote. */
export let memory = (eid: string, title: string, body: string): Bundle =>
  says(eid, title, body, { memory: {} })

/** A checkout of r1 at `path`, whose own Git directory is `gitdir`. */
export let checkout = (eid: string, path: string, gitdir: string): Bundle => ({
  entity: { eid },
  worktree: { repository: 'r1', path, gitdir },
})

/** A project whose repository r1 has its main worktree at `root` and a linked
 * one at `<root>/agent`, whose common persona n1 carries m1, and a specialist
 * n2 named `coder` that carries m1 and m2. */
export let fleet = (root: string): Graph => {
  let g = world()
  g.apply([
    { entity: { eid: 'p1' }, project: {}, repo: { repository: 'r1' } },
    { entity: { eid: 'r1' }, repository: { common: `${root}/.git` } },
    checkout('w1', root, `${root}/.git`),
    checkout('w2', `${root}/agent`, `${root}/.git/worktrees/agent`),
    { ...voiced('n1', 'common', 'for everyone'), persona: { home: 'p1' } },
    { ...voiced('n2', 'Coder', 'for code'), persona: { home: 'p1' } },
    { entity: { eid: 'k1' }, key: { of: 'n2', value: 'coder' }, alias: {} },
    memory('m1', 'one', 'first'),
    memory('m2', 'two', 'second'),
    link('p1', 'contains', 'n1'),
    link('n1', 'contains', 'm1'),
    link('n2', 'contains', 'm1'),
    link('n2', 'contains', 'm2'),
  ])
  return g
}

export { link }
