/** Frontend-local graph state. Only drafts and recovery data enter the local vault. */
import { type Client, client, type Vault, type Watch } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { SYNC_URI, syncKeywords } from '@yaks/sync'
import { signal } from '@preact/signals'

export let frontendVocab = loadVocab([{
  $vocabulary: { [SYNC_URI]: true },
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
        windowAnchor: { type: 'string' },
        windowEdge: { type: 'string' },
        offset: { type: 'number' },
        follow: { type: 'boolean' },
      },
    },
    pendingDraft: {
      persist: 'local',
      properties: {
        text: { type: 'string' },
        owner: { type: 'string' },
        order: { type: 'number' },
        generation: { type: 'number' },
      },
    },
    savedDraft: {
      persist: 'local',
      properties: {
        text: { type: 'string' },
        at: { type: 'number' },
        mode: { type: 'string' },
      },
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
}], [syncKeywords])

export let frontend = (vault: Vault | false = false): Frontend => {
  // No URL or socket: the local vault is never replicated to the backend.
  let pending = Promise.resolve()
  let failure: unknown
  const enqueue = (write: () => Promise<void>) => {
    pending = pending.then(write).catch((error) => {
      failure = error
      mutate([{
        entity: { eid: 'feedback' },
        feedback: {
          error: 'Draft recovery could not be saved: ' + String(error),
        },
      }])
    })
    return pending
  }
  const kept: Vault | false = vault && {
    load: () => vault.load(),
    save: (rows) => enqueue(() => vault.save(rows)),
    drop: (ids) => enqueue(() => vault.drop(ids)),
    clear: () => enqueue(() => vault.clear()),
  }
  let c = client(frontendVocab, [], { vault: kept, signal })
  const writes = new Set<Promise<unknown>>()
  const mutate: Client['mutate'] = (change) => {
    const result = c.mutate(change)
    if (result instanceof Promise) {
      const done = result.catch((error) => {
        failure = error
      }).finally(() => writes.delete(done))
      writes.add(done)
    }
    return result
  }
  mutate([{
    entity: { eid: 'visual' },
    visual: { surface: '', text: '', anchor: 0, at: 0, yank: '' },
  }])
  mutate([
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
  const slot = (selected: string | null) =>
    'draft:' + (selected == null ? 'new' : 'session:' + selected)
  const selected = (): string | null => {
    const id = record('view', 'frontend').selected
    return id == null ? null : String(id)
  }
  let touched = false
  const save = () =>
    mutate([{
      entity: { eid: slot(selected()) },
      savedDraft: {
        ...record('draft', 'draft'),
        mode: record('composer', 'composer').mode,
      },
    }])
  const restore = () => {
    const d = record(slot(selected()), 'savedDraft')
    mutate([
      {
        entity: { eid: 'draft' },
        draft: { text: d.text ?? '', at: d.at ?? 0 },
      },
      { entity: { eid: 'composer' }, composer: { mode: d.mode ?? 'message' } },
    ])
  }
  const ready = c.ready.then(() => {
    if (!vault || touched) return
    // Interrupted admissions become editable recovered drafts, never automatic sends.
    const interrupted = c.watch('.pendingDraft')
    const rows = [...interrupted.value].sort((a, b) =>
      Number((a.pendingDraft as Record<string, unknown>).order) -
      Number((b.pendingDraft as Record<string, unknown>).order)
    )
    const byOwner = new Map<string, string[]>()
    for (const row of rows) {
      const pending = row.pendingDraft as Record<string, unknown>
      const owner = String(pending.owner ?? '')
      byOwner.set(owner, [
        ...byOwner.get(owner) ?? [],
        String(pending.text ?? ''),
      ])
    }
    for (const [owner, texts] of byOwner) {
      const saved = record(slot(owner || null), 'savedDraft')
      const text = [...texts, saved.text].filter(Boolean).join('\n')
      mutate([{
        entity: { eid: slot(owner || null) },
        savedDraft: { ...saved, text, at: text.length },
      }])
    }
    for (const row of rows) mutate([{ entity: row.entity, pendingDraft: null }])
    interrupted.close()
    const r = record('recovery', 'recovery')
    const restored = typeof r.selected == 'string' && r.selected
      ? r.selected
      : null
    mutate([
      { entity: { eid: 'view' }, frontend: { selected: restored } },
      { entity: { eid: 'visual' }, visual: { yank: r.yank ?? '' } },
    ])
    restore()
  })
  return {
    ready,
    flush: async () => {
      while (writes.size) await Promise.all([...writes])
      await pending
      if (failure) throw failure
    },
    submission: () => {
      const owner = selected()
      const generation = record('view', 'frontend').generation
      const submitted = record('draft', 'draft')
      const id = 'pending:' + crypto.randomUUID()
      mutate([{
        entity: { eid: id },
        pendingDraft: {
          text: submitted.text ?? '',
          owner: owner ?? '',
          order: Date.now(),
          generation,
        },
      }])
      mutate([{ entity: { eid: 'draft' }, draft: { text: '', at: 0 } }])
      save()
      return {
        accepted: (session: string) => {
          mutate([{ entity: { eid: id }, pendingDraft: null }])
          if (owner == null) {
            // All queued submissions for this new session now have a durable
            // owner, including those whose acknowledgements arrive later.
            const outstanding = c.watch('.pendingDraft')
            for (const row of outstanding.value) {
              if (
                (row.pendingDraft as Record<string, unknown>).owner === '' &&
                (row.pendingDraft as Record<string, unknown>).generation ===
                  generation
              ) {
                mutate([{
                  entity: row.entity,
                  pendingDraft: { owner: session },
                }])
              }
            }
            outstanding.close()
            if (
              selected() == null &&
              generation === record('view', 'frontend').generation
            ) {
              const d = record('draft', 'draft')
              mutate([
                {
                  entity: { eid: slot(session) },
                  savedDraft: {
                    ...d,
                    mode: record('composer', 'composer').mode,
                  },
                },
                {
                  entity: { eid: slot(null) },
                  savedDraft: { text: '', at: 0, mode: 'message' },
                },
                { entity: { eid: 'view' }, frontend: { selected: session } },
                {
                  entity: { eid: 'recovery' },
                  recovery: { selected: session },
                },
              ])
            }
          }
        },
        failed: () => {
          const target = String(record(id, 'pendingDraft').owner ?? '') || null
          const d = target == selected()
            ? record('draft', 'draft')
            : record(slot(target), 'savedDraft')
          const text = [submitted.text, d.text].filter(Boolean).join('\n')
          mutate([{
            entity: { eid: slot(target) },
            savedDraft: { text, at: text.length },
          }])
          if (target == selected()) restore()
          mutate([{ entity: { eid: id }, pendingDraft: null }])
        },
      }
    },
    client: c,
    keyboard: c.watch('.keyboard'),
    keys: (fields: Record<string, string | boolean>) =>
      mutate([{ entity: { eid: 'keyboard' }, keyboard: fields }]),
    visual: c.watch('.visual'),
    select: (state: import('@yaks/tui').VisualState) => {
      if (state.yank !== undefined) {
        mutate([{
          entity: { eid: 'recovery' },
          recovery: { yank: state.yank },
        }])
      }
      return mutate([{ entity: { eid: 'visual' }, visual: state }])
    },
    view,
    draft,
    composer,
    feedback,
    patch: (fields: Record<string, string | number | boolean | null>) => {
      let { mode, error, ...selection } = fields
      touched = true
      const switching = 'selected' in selection &&
        (selection.selected ?? null) !== selected()
      const destination = selection.selected == null
        ? null
        : String(selection.selected)
      const next = switching
        ? record(slot(destination), 'savedDraft')
        : undefined
      if (switching) save()
      const result = mutate([
        ...Object.keys(selection).length
          ? [{ entity: { eid: 'view' }, frontend: selection }]
          : [],
        ...next
          ? [
            {
              entity: { eid: 'recovery' },
              recovery: { selected: destination ?? '' },
            },
            {
              entity: { eid: 'draft' },
              draft: { text: next.text ?? '', at: next.at ?? 0 },
            },
            {
              entity: { eid: 'composer' },
              composer: { mode: mode ?? next.mode ?? 'message' },
            },
          ]
          : mode !== undefined
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
      const result = mutate([{ entity: { eid: 'draft' }, draft: value }])
      save()
      return result
    },
    viewport: (id: string) => {
      if (!c.ent(id)) {
        mutate([{
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
          mutate([{
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
  submission: () => { accepted: (session: string) => void; failed: () => void }
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
