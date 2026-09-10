/** Private, non-persistent application state. Each mounted frontend owns one client. */
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { signal } from '@preact/signals'

export let frontendVocab = loadVocab([{
  $defs: {
    frontend: {
      persist: 'none',
      properties: {
        selected: { type: 'string' },
        mode: { enum: ['message', 'task'] },
        showSettled: { type: 'boolean' },
        error: { type: 'string' },
      },
    },
    draft: {
      persist: 'none',
      properties: { text: { type: 'string' }, at: { type: 'number' } },
    },
  },
}])

export let frontend = () => {
  // Deliberately no URL, socket or vault: drafts never leave this frontend.
  let c = client(frontendVocab, [], { vault: false, signal })
  c.mutate([
    { entity: { eid: 'view' }, frontend: { mode: 'message', showSettled: false, error: '' } },
    { entity: { eid: 'draft' }, draft: { text: '', at: 0 } },
  ])
  let view = c.watch('.frontend')
  let draft = c.watch('.draft')
  return {
    client: c,
    view,
    draft,
    patch: (fields: Record<string, string | boolean | null>) =>
      c.mutate([{ entity: { eid: 'view' }, frontend: fields }]),
    edit: (value: { text: string; at: number }) =>
      c.mutate([{ entity: { eid: 'draft' }, draft: value }]),
    close: () => c.close(),
  }
}
export type Frontend = ReturnType<typeof frontend>
