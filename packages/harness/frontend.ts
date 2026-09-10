/** Private, non-persistent application state. Each mounted frontend owns one client. */
import { type Client, client, type Watch } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { signal } from '@preact/signals'

export let frontendVocab = loadVocab([{
  $defs: {
    entity: { properties: { eid: { type: 'string' } } },
    keyboard: {
      persist: 'none',
      properties: {
        mode: { type: 'string' },
        focus: { type: 'string' },
        help: { type: 'boolean' },
        pending: { type: 'string' },
      },
    },
    frontend: {
      persist: 'none',
      properties: {
        selected: { type: 'string' },
        generation: { type: 'number' },
        showSettled: { type: 'boolean' },
        showArchived: { type: 'boolean' },
      },
    },
    visual: {
      persist: 'none',
      properties: {
        surface: { type: 'string' },
        text: { type: 'string' },
        anchor: { type: 'number' },
        at: { type: 'number' },
        yank: { type: 'string' },
      },
    },
    composer: {
      persist: 'none',
      properties: { mode: { enum: ['message', 'task'] } },
    },
    feedback: { persist: 'none', properties: { error: { type: 'string' } } },
    viewport: {
      persist: 'none',
      properties: {
        item: { type: 'string' },
        offset: { type: 'number' },
        follow: { type: 'boolean' },
      },
    },
    draft: {
      persist: 'none',
      properties: { text: { type: 'string' }, at: { type: 'number' } },
    },
  },
}])

export let frontend = (): Frontend => {
  // Deliberately no URL, socket or vault: drafts never leave this frontend.
  let c = client(frontendVocab, [], { vault: false, signal })
  c.mutate([{
    entity: { eid: 'visual' },
    visual: { surface: '', text: '', anchor: 0, at: 0, yank: '' },
  }])
  c.mutate([
    {
      entity: { eid: 'view' },
      frontend: {
        showSettled: false,
        generation: 0,
      },
    },
    {
      entity: { eid: 'keyboard' },
      keyboard: {
        mode: 'INSERT',
        focus: 'transcript',
        help: false,
        pending: '',
      },
    },
    { entity: { eid: 'composer' }, composer: { mode: 'message' } },
    { entity: { eid: 'feedback' }, feedback: { error: '' } },
    { entity: { eid: 'draft' }, draft: { text: '', at: 0 } },
  ])
  let view = c.watch('.frontend')
  let draft = c.watch('.draft')
  let composer = c.watch('.composer')
  let feedback = c.watch('.feedback')
  return {
    client: c,
    keyboard: c.watch('.keyboard'),
    keys: (fields: Record<string, string | boolean>) =>
      c.mutate([{ entity: { eid: 'keyboard' }, keyboard: fields }]),
    visual: c.watch('.visual'),
    select: (state: import('@yaks/tui').VisualState) =>
      c.mutate([{ entity: { eid: 'visual' }, visual: state }]),
    view,
    draft,
    composer,
    feedback,
    patch: (fields: Record<string, string | number | boolean | null>) => {
      let { mode, error, ...selection } = fields
      return c.mutate([
        ...Object.keys(selection).length
          ? [{ entity: { eid: 'view' }, frontend: selection }]
          : [],
        ...mode !== undefined
          ? [{ entity: { eid: 'composer' }, composer: { mode } }]
          : [],
        ...error !== undefined
          ? [{ entity: { eid: 'feedback' }, feedback: { error } }]
          : [],
      ])
    },
    edit: (value: { text: string; at: number }) =>
      c.mutate([{ entity: { eid: 'draft' }, draft: value }]),
    viewport: (id: string) => {
      if (!c.ent(id)) {
        c.mutate([{
          entity: { eid: id },
          viewport: { follow: true, offset: 0 },
        }])
      }
      let watch = c.watch('.eid=' + id)
      return {
        watch,
        set: (
          value: { anchor?: { id: string; offset: number }; follow: boolean },
        ) => {
          c.mutate([{
            entity: { eid: id },
            viewport: {
              item: value.anchor?.id ?? null,
              offset: value.anchor?.offset ?? 0,
              follow: value.follow,
            },
          }])
        },
      }
    },
    close: () => c.close(),
  }
}
export type Frontend = {
  keyboard: Watch
  keys: (
    fields: Record<string, string | boolean>,
  ) => ReturnType<Client['mutate']>
  client: Client
  visual: Watch
  select: (
    state: import('@yaks/tui').VisualState,
  ) => ReturnType<Client['mutate']>
  view: Watch
  draft: Watch
  composer: Watch
  feedback: Watch
  patch: (
    fields: Record<string, string | number | boolean | null>,
  ) => ReturnType<Client['mutate']>
  edit: (value: { text: string; at: number }) => ReturnType<Client['mutate']>
  viewport: (id: string) => {
    watch: Watch
    set: (
      value: { anchor?: { id: string; offset: number }; follow: boolean },
    ) => void
  }
  close: () => void
}
