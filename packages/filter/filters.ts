/** The query-domain adapter over generic UX completion. @module */
import { complete, type Source } from '@yaks/query'
import {
  completion,
  type Controller,
  type Drafts,
  type Float,
  type Front,
} from '@yaks/ux/completion'
import type { Vocab } from '@yaks/vocab'

export type {
  Anchor,
  Drafts,
  FieldProps as FilterProps,
  Float,
  Front,
} from '@yaks/ux/completion'

/** The query domain and the host's durable drafts and presentation. */
export type Opts = {
  vocab: Vocab
  drafts: Drafts
  source?: Source
  Float?: Float
}

/** Existing query fields, with generic completion actions and presentation. */
export type Filters = Controller & { Filter: Controller['Field'] }

/** Bind query completion, retaining the existing filter{caret,from,to,cands,pick} contract. */
export let filters = (front: Front, opts: Opts): Filters => {
  let fields = completion(front, {
    drafts: opts.drafts,
    Float: opts.Float,
    component: 'filter',
    complete: (text, caret) =>
      complete(opts.vocab, text, caret, opts.source ?? {}),
  })
  return { ...fields, Filter: fields.Field }
}
