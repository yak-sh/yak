// T-2943. These are the write times matched to box-agent calls in the
// session graph. The credential alone does not establish who requested a write.
import type { Bundle, Comp, Graph } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { type Line, line } from '@yaks/query'
import { PLATFORM_STORE } from './names.ts'

let jeff = '50ec3cb5-8d01-4d94-8607-1b23d30cc3e2'
let agent = 'ce2121dd-687d-469f-b1cc-98da310e1b7d'
let signIn = 'a91a445f-1f0e-81b7-8254-42d5ab9bc3d1'

let patch = (row: Bundle, name: 'created' | 'updated', times: string[]) => {
  let stamp = row[name] as Comp | undefined
  if (
    stamp?.by != jeff || stamp.via != signIn || typeof stamp.at != 'string' ||
    !times.includes(stamp.at)
  ) return []
  return [{
    entity: { eid: row.entity.eid },
    [name]: { by: agent },
    $was: {
      [name]: { by: token(jeff), via: token(signIn), at: token(stamp.at) },
    },
  }]
}

let correction = (
  mark: `yak/store/${string}`,
  store: string,
  name: 'created' | 'updated',
  times: string[],
) => ({
  mark,
  stores: [store],
  stamp: false as const,
  live: 'all' as const,
  find: name == 'created'
    ? line`.created.by=${jeff}&.created.via=${signIn}&.created.at=${times}&?created`
    : line`.updated.by=${jeff}&.updated.via=${signIn}&.updated.at=${times}&?updated`,
  move: (row: Bundle) => patch(row, name, times),
})

// The query builder interpolates values and leaves filter paths literal.
let printBound = {
  ...correction('yak/store/box-attribution-lulu/1', PLATFORM_STORE, 'updated', [
    '2026-11-23T22:37:05.623Z', // S-4675, connection_attach
  ]),
  find:
    line`.entity.eid=4249f7ad-da71-8d0a-8489-8e1b8c0ab11b&.updated.by=${jeff}&.updated.via=${signIn}&?updated`,
}

// Directory transactions recorded by the support and test membership calls.
let evidence = new Map<number, string>([
  [419, '0d69470d-1a6, support reply'],
  [459, '8b1db5cf-053, support reply'],
  [490, '2324a288-455, support reply'],
  [1501, '3a610e6a-411, free-space test creation'],
  [1502, 'bd1398f1, support reply'],
  [1633, '325867ba-4ac, subscription support reply'],
  [1667, '5c921508-d1c, support reply'],
  [1669, '9e371d6f, support reply'],
  [1720, 'f42d9929-3b8, CrayonBloom test invitation'],
  [1752, 'f42d9929-3b8, PrintBound test invitation'],
  [1755, 'f42d9929-3b8, removal of the PrintBound test seat'],
])

export let boxAttributionMoves = [
  printBound,
  {
    mark: 'yak/store/box-attribution-operator-cleanup/1' as const,
    stores: [PLATFORM_STORE],
    stamp: false as const,
    live: 'all' as const,
    find:
      line`.entity.eid=e416ab43-f8fd-4b18-81de-11f9fa7d3627&.admin_action.operation=operator_apply&.admin_action.person=${jeff}&?created`,
    move: (row: Bundle) =>
      patch(row, 'created', ['2026-11-21T07:32:09.550Z']).map((fix) => ({
        ...fix,
        admin_action: { person: agent },
        $was: { ...fix.$was, admin_action: { person: token(jeff) } },
      })),
  },
  correction(
    'yak/store/box-attribution-directory-created/1',
    PLATFORM_STORE,
    'created',
    [
      '2026-11-11T22:40:18.458Z',
      '2026-11-12T17:52:14.533Z',
      '2026-11-13T18:46:04.390Z',
      '2026-11-20T13:38:54.200Z',
      '2026-11-20T13:48:51.920Z',
      '2026-11-21T18:54:52.237Z',
      '2026-11-21T21:14:46.470Z',
      '2026-11-21T21:31:48.468Z',
      '2026-11-23T17:01:29.032Z',
      '2026-11-23T17:01:51.020Z',
      '2026-11-23T18:02:15.004Z',
    ],
  ),
  correction(
    'yak/store/box-attribution-directory-updated/1',
    PLATFORM_STORE,
    'updated',
    [
      '2026-11-13T18:46:04.390Z',
    ],
  ),
  // cca4d4b3-dae imported the church site's events, sermons and forms.
  correction(
    'yak/store/box-attribution-church/2',
    'locustgrove/church.955100',
    'created',
    [
      '2026-11-09T02:27:02.936Z',
      '2026-11-09T02:27:04.682Z',
      '2026-11-09T02:27:06.019Z',
      '2026-11-09T02:27:07.434Z',
      '2026-11-09T02:27:42.955Z',
      '2026-11-09T02:38:30.804Z', // d6afd9e4, all seven rows match this call
    ],
  ),
  correction(
    'yak/store/box-attribution-forms/1',
    'locustgrove/directory.c9f0fc',
    'created',
    [
      '2026-11-09T02:24:42.190Z',
      '2026-11-09T02:24:43.532Z',
      '2026-11-09T02:24:44.829Z',
      '2026-11-09T02:24:46.155Z',
      '2026-11-09T02:24:47.323Z',
      '2026-11-09T02:24:48.688Z',
      '2026-11-09T02:24:49.957Z',
      '2026-11-09T02:24:51.430Z',
    ],
  ),
  // 16016817-fc3 uploaded the sample image while preparing its gallery card.
  correction(
    'yak/store/box-attribution-sample/1',
    'yourname/directory.a02c3f',
    'created',
    [
      '2026-11-14T02:48:27.352Z',
    ],
  ),
  {
    mark: 'yak/store/box-attribution-journal/1' as const,
    stores: [PLATFORM_STORE],
    stamp: false as const,
    live: 'all' as const,
    find: line`.entity.eid=${agent}&.email`,
    move: (row: Bundle, read?: (q: Line) => Bundle[]): Bundle[] => {
      let fixes = read?.(
        line`._tx.seq=${[
          ...evidence.keys(),
        ]}&._tx.by=${jeff}&._tx.via=${signIn}`,
      ).map(({ _tx }) => {
        let tx = _tx as Comp
        return {
          seq: tx.seq,
          at: tx.at,
          by: jeff,
          via: signIn,
          why: `T-2943, box agent ${evidence.get(Number(tx.seq))}`,
        }
      })
      return fixes?.length
        ? [{ entity: row.entity, $journal_actor: { corrections: fixes } }]
        : []
    },
  },
]

export let concept = '0538988d-d6f4-49db-bbad-75f62d46d128'

// Support wrote the same replies into the directory and the Concept Operator.
export let repairConceptReplies = async (g: Graph) => {
  let eids = [
    '07796646-ca3a-8f9a-afab-d974a99d7ca6',
    '7ffe59b7-62a2-84ab-b5ab-f13981e5bf9d',
    '7f084e6d-4e91-892a-b6b7-db6d6004563a',
  ]
  let rows = await g.get(eids, ['created'])
  let bundles = rows.flatMap((r) =>
    patch(r, 'created', [
      '2026-11-21T18:54:52.417Z',
      '2026-11-21T21:14:46.875Z',
      '2026-11-21T21:31:49.636Z',
    ])
  )
  if (bundles.length) await g.apply(bundles, { trusted: true, stamp: false })
}
