// An app store's lenses: the session words it speaks at their first version,
// and the renames its own `vocab.json` declares (./lenses.ts `lensDocAt`). A
// row a lens could not normalize is the host's to report.
import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import type { Host } from '@yaks/host'
import { lenses, lensesIn } from '@yaks/lens'
import type { Options } from './lent.ts'
import { lensDocAt, sessionPackage, sessionRows } from './lenses.ts'

export let plugins = (
  host: { vocab: Vocab } & Pick<Host, 'report'>,
  { store }: { store: Pick<Options['store'], 'name' | 'manifest'> },
): Plugin[] => [
  lenses(
    (error) =>
      void host.report?.(error, { during: { request: 'lens normalize' } }),
    {
      vocab: host.vocab,
      speaks: { [sessionPackage]: 0 },
      rows: [
        ...sessionRows(),
        ...lensesIn([lensDocAt(store.name, store.manifest())]),
      ],
    },
  ),
]
