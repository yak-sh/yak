/** Frontend-local graph state. Only drafts and recovery data enter the local vault. */
import { type Client, client, type Vault, type Watch } from '@yaks/client'
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
        clipboard: { type: 'string' },
        runtime: { type: 'boolean' },
        runtimeSelected: { type: 'string' },
        runtimeFeedback: { type: 'string' },
      },
    },
    frontend: {
      persist: 'none',
      properties: {
        selected: { type: 'string' },
        sidebar: { type: 'string' },
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
        selected: { type: 'string' },
        offset: { type: 'number' },
        follow: { type: 'boolean' },
      },
    },
    savedDraft: {
      persist: 'local',
      properties: { text: { type: 'string' }, at: { type: 'number' }, mode: { type: 'string' } },
    },
    recovery: {
      persist: 'local',
      properties: { selected: { type: 'string' }, yank: { type: 'string' } },
    },
    draft: {
      persist: 'none',
      properties: { text: { type: 'string' }, at: { type: 'number' } },
    },
  },
}])

export let frontend = (vault: Vault | false = false): Frontend => {
  // No URL or socket: the local vault is never replicated to the backend.
  let pending = Promise.resolve()
  let failure: unknown
  const enqueue = (write: () => Promise<void>) => {
    pending = pending.then(write).catch(error => {
      failure = error
      c.mutate([{ entity: { eid: 'feedback' }, feedback: { error: 'Draft recovery could not be saved: ' + String(error) } }])
    })
    return pending
  }
  const kept: Vault | false = vault && {
    load: () => vault.load(),
    save: rows => enqueue(() => vault.save(rows)),
    drop: ids => enqueue(() => vault.drop(ids)),
    clear: () => enqueue(() => vault.clear()),
  }
  let c = client(frontendVocab, [], { vault: kept, signal })
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
  const record = (id: string, comp: string) =>
    (c.ent(id)?.[comp] ?? {}) as Record<string, unknown>
  const slot = (selected: string | null) => 'draft:' + (selected == null ? 'new' : 'session:' + selected)
  let selected: string | null = null
  let revision = 0
  let touched = false
  const save = () => c.mutate([{
    entity: { eid: slot(selected) },
    savedDraft: { ...record('draft', 'draft'), mode: record('composer', 'composer').mode },
  }])
  const restore = () => {
    const d = record(slot(selected), 'savedDraft')
    c.mutate([
      { entity: { eid: 'draft' }, draft: { text: d.text ?? '', at: d.at ?? 0 } },
      { entity: { eid: 'composer' }, composer: { mode: d.mode ?? 'message' } },
    ])
    revision++
  }
  const ready = c.ready.then(() => {
    if (touched) return
    const r = record('recovery', 'recovery')
    selected = typeof r.selected == 'string' && r.selected ? r.selected : null
    c.mutate([
      { entity: { eid: 'view' }, frontend: { selected } },
      { entity: { eid: 'visual' }, visual: { yank: r.yank ?? '' } },
    ])
    restore()
  })
  return {
    ready,
    flush: async () => { await pending; if (failure) throw failure },
    submission: () => {
      const owner = selected, version = revision
      const submitted = record('draft', 'draft')
      return {
        accepted: (session: string) => {
          // The acknowledged revision alone is cleared. Text entered while the
          // request was pending remains a draft, including after switching away.
          if (owner == selected && version == revision) {
            c.mutate([{ entity: { eid: 'draft' }, draft: { text: '', at: 0 } }])
            save()
          }
          if (owner != selected) {
            const d = record(slot(owner), 'savedDraft')
            if (d.text == submitted.text && d.at == submitted.at) {
              c.mutate([{ entity: { eid: slot(owner) }, savedDraft: { text: '', at: 0 } }])
            }
          }
          if (owner == null && selected == null) {
            const d = record('draft', 'draft')
            c.mutate([
              { entity: { eid: slot(session) }, savedDraft: { ...d, mode: record('composer', 'composer').mode } },
              { entity: { eid: slot(null) }, savedDraft: { text: '', at: 0, mode: 'message' } },
            ])
          }
        },
      }
    },
    client: c,
    keyboard: c.watch('.keyboard'),
    keys: (fields: Record<string, string | boolean>) =>
      c.mutate([{ entity: { eid: 'keyboard' }, keyboard: fields }]),
    visual: c.watch('.visual'),
    select: (state: import('@yaks/tui').VisualState) => {
      if (state.yank !== undefined) c.mutate([{ entity: { eid: 'recovery' }, recovery: { yank: state.yank } }])
      return c.mutate([{ entity: { eid: 'visual' }, visual: state }])
    },
    view,
    draft,
    composer,
    feedback,
    patch: (fields: Record<string, string | number | boolean | null>) => {
      let { mode, error, ...selection } = fields
      touched = true
      if ('selected' in selection && (selection.selected ?? null) !== selected) {
        save()
        selected = selection.selected == null ? null : String(selection.selected)
        c.mutate([{ entity: { eid: 'recovery' }, recovery: { selected: selected ?? '' } }])
        restore()
      }
      const result = c.mutate([
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
      if (mode !== undefined) save()
      return result
    },
    edit: (value: { text: string; at: number }) => {
      touched = true
      revision++
      const result = c.mutate([{ entity: { eid: 'draft' }, draft: value }])
      save()
      return result
    },
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
  ready: Promise<void>
  flush: () => Promise<void>
  submission: () => { accepted: (session: string) => void }
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
