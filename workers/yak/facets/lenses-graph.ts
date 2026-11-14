// An app store's lenses: the session words it speaks at their first version,
// and the renames its own `vocab.json` declares (lenses.ts `lensDocAt`).
import type { Plugin } from '@yaks/graph'
import type { Vocab } from '@yaks/vocab'
import { lenses, lensesIn } from '@yaks/lens'
import type { Options } from './store.ts'
import { sessionPackage, sessionRows } from '../session-lens.ts'
import { lensDocAt } from '../lenses.ts'
import { defect } from '../defects.ts'

export let plugins = (host: { vocab: Vocab }, { store }: Options): Plugin[] => [
  lenses(
    (error) => defect(error, { request: 'lens normalize', store: store.name }),
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
