/** @jsxImportSource preact */
// An age, said the human way. An entity says when it was created and, when
// present, edited; `at` names any other graph moment. The ages come off a
// minute tick, so an open card never fossilizes at the age it rendered, and
// the full stamps ride the tooltips.
import type { ComponentChildren } from 'preact'
import * as ui from '@yaks/ui'
import { relative } from '@yaks/ui'

/** How long ago a timestamp is, for plain text descriptions. */
export let ago = (iso?: string | null, now = Date.now()) => relative(iso, now)

export let Stamp = (
  { e, at, label, by }: {
    e?: {
      created?: { at?: string; by?: string | null }
      updated?: { at?: string; by?: string | null }
    }
    at?: string | null
    label?: string
    by?: (comp: 'created' | 'updated') => ComponentChildren
  },
) => {
  let born = at ?? e?.created?.at
  if (!born) return null
  // `updated` presence is the edited signal (T-6670), but belongs only to the
  // entity-age form.
  let edited = at == null ? e?.updated?.at : undefined
  return (
    <ui.Stamp>
      <span>
        {label && `${label} `}
        <ui.Time at={born} />
        {by && e?.created?.by && <>{' by '}{by('created')}</>}
      </span>
      {edited && (
        <span>
          · edited <ui.Time at={edited} />
          {by && e?.updated?.by && <>{' by '}{by('updated')}</>}
        </span>
      )}
    </ui.Stamp>
  )
}
