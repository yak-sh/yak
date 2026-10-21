// App stores spoke @yaks/session's `imported{source, line}`, the file and line
// an entry was imported from, until the importer gave it up for @yaks/file's
// `lines{file, start}` (D-131267). No app store imports a file: both
// properties are server-owned and nothing in the Worker writes them, so a store
// holds at most bare rows. This clears any it holds and sheds the columns.
import type { VocabDoc } from '@yaks/vocab'
import type { Rule } from './mover.ts'

/** The retired declaration, as the session vocabulary last said it. */
export let importedSource: VocabDoc = {
  $defs: {
    imported: {
      component: true,
      type: 'object',
      properties: {
        source: { type: 'string', stamped: true },
        line: { type: 'number', stamped: true },
      },
      description:
        'an entry imported from somewhere else — which source, and which line of it',
    },
  },
}

export let importedRule: Rule = {
  mark: 'yak/store/session-imported/1',
  // An app that declares `imported` itself, now the platform has let it go,
  // keeps its rows.
  core: ['imported'],
  live: 'apps',
  find: '.imported',
  source: importedSource,
  move: (row) => [{ entity: { eid: row.entity.eid }, imported: null }],
  drop: ['imported.source', 'imported.line'],
}
