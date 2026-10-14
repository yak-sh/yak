// The worker's curated registry. Page projections become component bundles at
// this door; HTML uses the same portable renderer as a mounted Preact view.

import { render } from '@yaks/html'
import { define } from '@yaks/render'
import type { SpacePage } from '../pages.ts'
import type { Person } from '../people.ts'
import { platformVocab } from '../vocab.ts'
import { once } from '@yaks/fp'
import { app } from './app.ts'
import { guest, invitation, seat } from './held.ts'

export let registry = define([app, seat, guest, invitation])
// The directory's words, composed when a page first draws a row.
export let vocab = once(platformVocab)

export let tile = (
  a: SpacePage['apps'][number],
  at?: string,
  errors?: number,
) =>
  render(
    registry,
    {
      entity: { eid: a.eid },
      app: { slug: a.slug, access: a.access },
      doc: { title: a.title },
      ...(a.home ? { home: {} } : {}),
    },
    'List.Tile',
    vocab(),
    { gallery: a.gallery, at, errors },
  )

// The row itself, as the directory keeps it, and who it is for beside it.
let comps = {
  seat: (p: Person) => ({ member: { role: p.role } }),
  grant: (p: Person) => ({ grant: { access: p.role } }),
  invite: (p: Person) => ({ invite: { role: p.role, sent: p.sent } }),
}

export let holder = (p: Person) =>
  render(
    registry,
    { entity: { eid: p.eid }, ...comps[p.held](p) },
    'List.Tile',
    vocab(),
    { name: p.name, email: p.email },
  )
