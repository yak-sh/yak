// Each app's one draft, the token `app.draft`, becomes a draft row of the
// same eid (D-414): `app_draft{app, base}`, with neither `by` nor `via`, so
// its `written` rows still name it and anyone with a seat may release it.
// Until a store is moved, written.ts `withLegacy` reads the pointer as that
// row, and a write or a release into the draft writes the row and drops the
// pointer itself. Only the directory holds apps.
import type { Bundle, Comp } from '@yaks/graph'
import { token } from '@yaks/graph/sha256'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Rule } from './mover.ts'

export let draftMove = (
  row: Bundle,
  read?: (line: string) => Bundle[],
): Bundle[] => {
  let app = row.app as Comp | undefined
  let id = app?.draft
  if (typeof id != 'string' || !id) return []
  // When it opened: its first write, where it kept one.
  let first = read?.(
    `.written.draft=${id}&.order=written.at&.limit=1&.written.at`,
  )[0]?.written as Comp | undefined
  return [
    {
      entity: { eid: id },
      app_draft: {
        app: row.entity.eid,
        ...typeof app?.version == 'number' ? { base: app.version } : {},
        ...typeof first?.at == 'string' ? { at: first.at } : {},
      },
      $was: { app_draft: { app: token(null) } },
    },
    {
      entity: { eid: row.entity.eid },
      app: { draft: null },
      $was: { app: { draft: token(id) } },
    },
  ]
}

export let draftRule: Rule = {
  mark: 'yak/store/app-draft/1',
  stores: [PLATFORM_STORE],
  core: ['app', 'app_draft', 'written'],
  live: 'all',
  find: '.app.draft&*',
  move: draftMove,
}
