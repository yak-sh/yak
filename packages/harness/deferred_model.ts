// Unused provider transports cost no module loading. Their synchronous recorders
// are still available before a request, as on a directly constructed Model.
import type { Model } from '@yaks/model'

export let deferredModel = (
  load: () => Promise<Model>,
  meta: Pick<Model, 'mark' | 'vocab' | 'anchor'> & {
    recover?: true
    info?: true
  },
): Model => {
  let pending: Promise<Model> | undefined
  let get = () => pending ??= load()
  let { recover, info, ...record } = meta
  return Object.assign(
    async (...args: Parameters<Model>) => (await get())(...args),
    record,
    {
      list: async () => await (await get()).list?.() ?? [],
      ...info
        ? { info: async (name: string) => await (await get()).info?.(name) }
        : {},
      ...recover
        ? { recover: async (call: string) => (await get()).recover!(call) }
        : {},
    },
  )
}
