// Unused provider transports cost no module loading. Their synchronous recorders
// are still available before a request, as on a directly constructed Model.
import { lazy } from '@yaks/fp'
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
      retrieve?: true
      info?: true
      count?: true
      reads?: Model['reads'] | true
    },
): Model => {
  let get = lazy(load)
  let { recover, retrieve, info, count, reads, ...record } = meta
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
      ...count
        ? {
          count: async (req: Parameters<Model>[0]) =>
            await (await get()).count!(req),
        }
        : {},
      ...recover
        ? { recover: async (call: string) => (await get()).recover!(call) }
        : {},
      ...retrieve
        ? {
          retrieve: async (
            ...args: Parameters<NonNullable<Model['retrieve']>>
          ) => (await get()).retrieve?.(...args),
        }
        : {},
    },
  )
}
