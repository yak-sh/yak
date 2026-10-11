// The cold path of command discovery. A memo hit imports none of these
// vocabulary constructors, validators or declaration modules.
import { type Config, exported, subpaths, used } from './config.ts'
import type { CliCommand } from './host.ts'
import type { VocabFacet } from '@yaks/host'
import type { Declarations } from './declarations.ts'
import { toolsIn } from '@yaks/vocab/tools'
import { loadVocab } from '@yaks/vocab/runtime'
import { declared, offered, toolName } from '@yaks/graph/vocab'
import { fields } from '@yaks/fts/fields'
import { docsOf } from '@yaks/host/documents'
import { understood } from '@yaks/host/keywords'

export let derive = async (
  config: Config,
  includeControls = false,
): Promise<Declarations> => {
  let plugins = (config.plugins ?? []).map(used)
  let requests = plugins.flatMap((
    p,
  ) => [[p, 'vocab'] as const, ...includeControls ? [[p, 'cli'] as const] : []])
  let width = includeControls ? 2 : 1
  let modules = await subpaths(requests)
  let vocabs = plugins.map((plugin, i) => ({
    plugin,
    value: modules[i * width] as VocabFacet | null,
  }))
  let controls = (includeControls ? plugins : []).map((plugin, i) => {
    let v = modules[i * 2 + 1] as { commands?: CliCommand[] } | null
    return {
      plugin,
      value: v
        ? { commands: (v.commands ?? []).map(({ run: _, ...data }) => data) }
        : null,
    }
  })
  let docs = docsOf(
    vocabs.flatMap(({ plugin, value }) =>
      (value?.docs ?? []).map((d) => ({
        ...d,
        package: plugin,
        description: value?.description,
      }))
    ),
  )
  let vocab = loadVocab(
    docs,
    understood(vocabs.flatMap(({ value }) => value?.keywords ?? [])),
  )
  return {
    facets: Object.fromEntries(
      plugins.map((
        p,
      ) => [
        p,
        [
          'vocab',
          'graph',
          'tools',
          'effects',
          'routes',
          'ui',
          'service',
          'cli',
          'views',
        ].filter((name) => exported(p, name)),
      ]),
    ),
    vocabs: vocabs.map(({ plugin, value }) => ({
      plugin,
      value: value
        ? {
          description: value.description,
          docs: value.docs,
          keywords: value.keywords,
        }
        : null,
      factories: !!(value?.derived || value?.backed),
    })),
    controls,
    tools: [
      ...declared({ keywords: vocab.keywords, search: !!fields(vocab).length }),
      ...toolsIn(docs).map((d) => ({ ...d, name: d.name ?? toolName(d) })),
    ].filter(offered('cli')),
    owners: Object.fromEntries(
      vocabs.flatMap(({ plugin, value }) =>
        toolsIn(value?.docs ?? []).map((d) => [d.name ?? toolName(d), plugin])
      ),
    ),
    pooled: !!vocab.comp('effect'),
  }
}
