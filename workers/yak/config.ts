// The packages and Worker domains each kind of store composes. Chosen words
// preserve the vocabulary each store already holds.
import type { Config, Plug } from '@yaks/host/config'
import type { FacetName } from '@yaks/host'
import { memoryDoc } from '@yaks/memory/vocab'

let storeFacets: FacetName[] = ['vocab', 'graph', 'effects']
let toolFacets: FacetName[] = [...storeFacets, 'tools']
let storePlugins = (plugins: Plug[]): Plug[] =>
  plugins.map((plug) =>
    typeof plug == 'string'
      ? { use: plug, facets: storeFacets }
      : { ...plug, facets: plug.facets ?? storeFacets }
  )

let spine = ['entity', 'created', 'updated']
let relations = [
  'about',
  'cites',
  'delegates',
  'reads',
  'supersedes',
  'supervises',
  'wants',
  'worked',
]
let marks = [
  'opened',
  'archived',
  'image',
  'quarantined',
  'verified',
  'pending',
  'interrupted',
  'failed',
]
let machine: Plug[] = [
  { use: '@yaks/persona', facets: ['vocab'], words: ['person'] },
  { use: '@yaks/archetype', words: [] },
  '@yaks/edge',
  '@yaks/key',
]
let addressed: Plug[] = ['@yaks/alias', '@yaks/wake']
let links: Plug[] = [
  { use: '@yaks/goal', words: ['satisfies'] },
  { use: '@yaks/dreaming', facets: ['vocab'], words: ['recalled'] },
]

export let appConfig: Config = {
  plugins: storePlugins([
    {
      use: '@yaks/kernel',
      facets: ['vocab'],
      words: [
        ...spine,
        ...relations,
        ...marks,
        'comment',
        'completed',
        'favorite',
      ],
    },
    ...machine,
    // Apps have no numbers, but every store accepts human ids on input.
    { use: '@yaks/id', words: [] },
    ...addressed,
    '@yaks/doc',
    '@yaks/draft',
    '@yaks/member',
    {
      use: '@yaks/task',
      facets: ['vocab'],
      words: ['contains', 'requires', 'cancelled', 'task'],
    },
    { use: '@yaks/project', facets: ['vocab'], words: ['filed', 'project'] },
    ...links,
    { use: '@yaks/notify', facets: ['vocab'], words: ['subscription'] },
    {
      use: '@yaks/mail',
      facets: toolFacets,
      with: { sender: { via: 'worker' } },
    },
    {
      use: '@yaks/tools',
      words: [
        'call',
        'result',
        'content',
        'output',
        'refusal',
        'execution',
        'tool',
        'call_ready',
        'call_woken',
        'finding',
      ],
    },
    '@yaks/hook',
    {
      use: '@yaks/session',
      words: [
        'session',
        'entry',
        'imported',
        'ask',
        'using',
        'notice',
        'stop',
        'attempt',
        'cancel',
        'dispatch',
        'session_run',
      ],
    },
    {
      use: '@yaks/model',
      words: [
        'model',
        'submitted',
        'usage',
        'cost',
        'questions',
        'answer',
        'inference',
      ],
    },
    { use: '@yaks/blob', words: ['artifact', 'representation'] },
    '@yaks/openai',
    '@yaks/openrouter',
    {
      use: '@yaks/builders',
      facets: toolFacets,
      words: [
        'builder',
        'staged',
        'builder_dep',
        'build',
        'build_of',
        'built',
        'chosen',
        'output_of',
        'builder_open',
        'builder_edit',
        'builder_ring',
        'builder_answer',
        'builder_model_answer',
        'builder_build',
        'builder_supply',
        'builder_choose',
        'builder_model',
      ],
    },
    { use: '@yaks/effects', words: ['provisional', 'effect', 'lease'] },
    '@yaks/rtc',
    'yak/app',
    { use: 'yak/trash', words: [] },
    { use: 'yak/meter', words: [] },
    { use: 'yak/models', with: {} },
    { use: 'yak/attribution', words: ['register_writes'] },
  ]),
}

export let directoryConfig: Config = {
  numbers: true,
  plugins: storePlugins([
    {
      use: '@yaks/kernel',
      facets: ['vocab'],
      words: [...spine, ...relations, ...marks, 'completed'],
    },
    ...machine,
    '@yaks/id',
    ...addressed,
    '@yaks/doc',
    // doc.body uses the blob keyword and graph hooks without artifact words.
    { use: '@yaks/blob', words: [] },
    { use: '@yaks/task', facets: ['vocab'], words: ['contains', 'requires'] },
    ...links,
    { use: '@yaks/mail', words: ['notified'] },
    '@yaks/tunnel',
    {
      use: '@yaks/memory',
      facets: toolFacets,
      // The directory shares spaces. Only the space-bound memory loop belongs
      // here; transcript walks and globally identified topics need an app store.
      words: Object.entries(memoryDoc.$defs ?? {}).filter(([name, entry]) =>
        entry.tool !== true || ['memory_save', 'memory_recall'].includes(name)
      ).map(([name]) => name),
    },
    { use: '@yaks/connections', facets: toolFacets },
    '@yaks/secrets',
    // The pool's rows: the directory's effects (a deploy's Git commit, trash
    // delivery) are recorded beside the write and run after it, durably, so
    // no writer waits on them.
    { use: '@yaks/effects', words: ['provisional', 'effect', 'lease'] },
    {
      use: '@yaks/tools',
      words: [
        'content',
        'call',
        'result',
        'output',
        'refusal',
        'execution',
        'tool',
        'call_ready',
        'call_woken',
      ],
    },
    { use: '@yaks/git', words: ['ref', 'repository', 'commit'] },
    '@yaks/platform',
    { use: '@yaks/model', facets: ['vocab'], words: ['cost'] },
    {
      use: 'yak/app',
      words: [
        'archetype',
        'retired',
        'exception',
        'referenced',
        'error',
        'blob',
        'attachment',
      ],
    },
    'yak/directory',
    'yak/trash',
    'yak/meter',
    { use: 'yak/pages', facets: ['graph'] },
    { use: 'yak/attribution', words: ['browser', 'attribute_writes'] },
    'yak/git',
    'yak/wrap',
    'yak/kills',
    'yak/lapsed',
  ]),
}

export let gitConfig: Config = {
  numbers: true,
  plugins: storePlugins([
    { use: '@yaks/kernel', facets: ['vocab'], words: spine },
    ...machine,
    '@yaks/id',
    ...addressed,
    { use: '@yaks/blob', words: [] },
    // This store's blob is a Git object's bytes, not an app upload.
    '@yaks/git',
    { use: 'yak/app', words: ['archetype', 'retired', 'exception'] },
    { use: 'yak/trash', words: [] },
    { use: 'yak/meter', words: [] },
  ]),
}

export let configs = {
  app: appConfig,
  directory: directoryConfig,
  git: gitConfig,
}

/** Worker domains export the same store facets as packages, at local paths. */
export let domains = {
  'yak/app': {
    vocab: './facets/app-vocab.ts',
    effects: './facets/app-effects.ts',
  },
  'yak/directory': { vocab: './facets/directory-vocab.ts' },
  'yak/trash': {
    vocab: './facets/trash-vocab.ts',
    graph: './facets/trash-graph.ts',
    effects: './facets/trash-effects.ts',
  },
  'yak/meter': {
    vocab: './facets/meter-vocab.ts',
    graph: './facets/meter-graph.ts',
    effects: './facets/meter-effects.ts',
  },
  'yak/pages': { graph: './facets/pages-graph.ts' },
  'yak/attribution': {
    vocab: './facets/attribution-vocab.ts',
    effects: './facets/attribution-effects.ts',
  },
  'yak/models': {
    vocab: './facets/models-vocab.ts',
    effects: './facets/models-effects.ts',
  },
  'yak/git': {
    vocab: './facets/git-vocab.ts',
    graph: './facets/git-graph.ts',
    effects: './facets/git-effects.ts',
  },
  'yak/wrap': {
    vocab: './facets/wrap-vocab.ts',
    graph: './facets/wrap-graph.ts',
    effects: './facets/wrap-effects.ts',
  },
  'yak/kills': {
    vocab: './facets/kills-vocab.ts',
    graph: './facets/kills-graph.ts',
    effects: './facets/kills-effects.ts',
  },
  'yak/lapsed': {
    vocab: './facets/lapsed-vocab.ts',
    effects: './facets/lapsed-effects.ts',
  },
}
