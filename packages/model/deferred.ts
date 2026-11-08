// Unused provider transports cost no module loading. Their synchronous recorders
// are still available before a request, as on a directly constructed Model.
import { type Model, modelReads } from './mod.ts'

export let deferredModel = (
  load: () => Promise<Model>,
  meta:
    & Pick<
      Model,
      'mark' | 'vocab' | 'anchor' | 'lateResults' | 'hosted'
    >
    & {
      recover?: true
      info?: true
      reads?: Model['reads'] | true
    },
): Model => {
  let pending: Promise<Model> | undefined
  let get = () => pending ??= load()
  let { recover, info, reads, ...record } = meta
  return Object.assign(
    async (...args: Parameters<Model>) => (await get())(...args),
    record,
    {
      list: async () => await (await get()).list?.() ?? [],
      ...reads === true
        ? { reads: async (name: string) => modelReads(await get(), name) }
        : reads
        ? { reads }
        : {},
      ...info
        ? { info: async (name: string) => await (await get()).info?.(name) }
        : {},
      ...recover
        ? { recover: async (call: string) => (await get()).recover!(call) }
        : {},
    },
  )
}
