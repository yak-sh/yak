// The worker's curated registry. Page projections become component bundles at
// this door; HTML uses the same portable renderer as a mounted Preact view.

import { render } from '@yaks/html'
import { define } from '@yaks/render'
import type { SpacePage } from '../pages.ts'
import { platformVocab } from '../vocab.ts'
import { app } from './app.ts'

export let registry = define([app])
export let vocab = platformVocab()

export let tile = (a: SpacePage['apps'][number]) =>
  render(
    registry,
    {
      entity: { eid: a.eid },
      app: { slug: a.slug, access: a.access },
      doc: { title: a.title },
      ...(a.home ? { home: {} } : {}),
    },
    'List.Tile',
    vocab,
    { gallery: a.gallery },
  )
