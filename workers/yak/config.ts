// The packages each kind of store composes. Worker-owned words and facets
// join these lists when the Store moves onto the portable assembly (D-121573,
// item 7); the package selections here follow vocab.ts's store documents.
import type { Config, Plug } from '@yaks/host/config'

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
  { use: '@yaks/persona', words: ['person'] },
  '@yaks/archetype',
  '@yaks/edge',
  '@yaks/key',
  '@yaks/alias',
  '@yaks/wake',
]
let links: Plug[] = [
  { use: '@yaks/goal', words: ['satisfies'] },
  { use: '@yaks/dreaming', words: ['recalled'] },
]

export let appConfig: Config = {
  plugins: [
    {
      use: '@yaks/kernel',
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
    '@yaks/doc',
    '@yaks/member',
    { use: '@yaks/task', words: ['contains', 'requires', 'cancelled', 'task'] },
    { use: '@yaks/project', words: ['filed', 'project'] },
    ...links,
    '@yaks/mail',
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
        'provider',
        'model',
        'serves',
        'price',
        'usage',
        'cost',
        'questions',
        'answer',
      ],
    },
    { use: '@yaks/blob', words: ['artifact', 'representation'] },
    '@yaks/openrouter',
    {
      use: '@yaks/builders',
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
      ],
    },
    { use: '@yaks/effects', words: ['provisional', 'effect', 'lease'] },
    '@yaks/rtc',
  ],
}

export let directoryConfig: Config = {
  numbers: true,
  plugins: [
    {
      use: '@yaks/kernel',
      words: [...spine, ...relations, ...marks, 'completed'],
    },
    ...machine,
    '@yaks/id',
    '@yaks/doc',
    // doc.body uses the blob keyword and graph hooks without artifact words.
    { use: '@yaks/blob', words: [] },
    { use: '@yaks/task', words: ['contains', 'requires'] },
    ...links,
    { use: '@yaks/mail', words: ['notified'] },
    '@yaks/tunnel',
    '@yaks/memory',
    '@yaks/connections',
    '@yaks/secrets',
    { use: '@yaks/effects', words: ['provisional'] },
    { use: '@yaks/tools', words: ['content'] },
    { use: '@yaks/git', words: ['ref'] },
    {
      use: '@yaks/platform',
      words: ['hostname', 'plan', 'deploy', 'switched'],
    },
    { use: '@yaks/model', words: ['cost'] },
  ],
}

export let gitConfig: Config = {
  numbers: true,
  plugins: [
    { use: '@yaks/kernel', words: spine },
    ...machine,
    '@yaks/id',
    { use: '@yaks/blob', words: [] },
    // This store's blob is a Git object's bytes, not an app upload.
    '@yaks/git',
  ],
}

export let configs = {
  app: appConfig,
  directory: directoryConfig,
  git: gitConfig,
}
