// What an app's store composes, as @yaks/host's config: the packages its words
// and rules come from, and the store's own plugins (`yak/*`) ahead of and
// behind them. The parts every platform store shares are exported for the
// host's other store configs to build on.
import type { Config, Plug } from '@yaks/host/config'
import type { FacetName } from '@yaks/host'

/** The rows each read as the entity they name does (@yaks/member
 * `through`): a document's pages, and a heard recording's turns. */
export let THROUGH: Record<string, string> = {
  document_page: 'document',
  heard_turn: 'recording',
}

export let storeFacets: FacetName[] = ['vocab', 'graph', 'effects']
export let toolFacets: FacetName[] = [...storeFacets, 'tools']
export let storePlugins = (plugins: Plug[]): Plug[] =>
  plugins.map((plug) =>
    typeof plug == 'string'
      ? { use: plug, facets: storeFacets }
      : { ...plug, facets: plug.facets ?? storeFacets }
  )

export let spine: string[] = ['entity']
// The stamps every write leaves, beside the kernel in every store.
export let provenance: Plug = { use: '@yaks/provenance', facets: ['vocab'] }
export let relations: string[] = [
  'about',
  'cites',
  'delegates',
  'reads',
  'supersedes',
  'supervises',
  'wants',
  'worked',
]
export let marks: string[] = [
  'opened',
  'archived',
  'image',
  'quarantined',
  'verified',
  'pending',
  'interrupted',
  'failed',
]
export let machine = (persona: string[] = ['person']): Plug[] => [
  { use: '@yaks/persona', facets: ['vocab'], words: persona },
  { use: '@yaks/archetype', words: [] },
  '@yaks/edge',
  '@yaks/key',
]
export let addressed: Plug[] = ['@yaks/alias', '@yaks/wake']
export let links: Plug[] = [
  { use: '@yaks/goal', words: ['satisfies'] },
  { use: '@yaks/dreaming', facets: ['vocab'], words: ['recalled'] },
]

// The store's own plugins that run ahead of every package's: an app's lenses
// name each component as it is now, its references are lowered to eids, and
// its schema pages are derived from its words when read.
export let ahead: Plug[] = [
  { use: 'yak/lenses', facets: ['graph'] },
  { use: 'yak/lower', facets: ['graph'] },
  { use: 'yak/describe', facets: ['graph'] },
]
// What every store does once a write commits: rouse the wakes it made hold,
// embed the texts it changed, and keep a keyed write's answer, last of the
// commit hooks (log-graph.ts).
export let behind: Plug[] = [
  { use: 'yak/rouse', facets: ['graph'] },
  { use: 'yak/embed', facets: ['graph'] },
  { use: 'yak/log', facets: ['graph'] },
]

export let appConfig: Config = {
  plugins: storePlugins([
    ...ahead,
    {
      use: '@yaks/kernel',
      facets: ['vocab'],
      words: [
        ...spine,
        ...relations,
        ...marks,
        'comment',
        'completed',
        'cancelled',
        'favorite',
        'decided',
      ],
    },
    provenance,
    ...machine(),
    // Who wrote the words a row still holds.
    { use: 'yak/authorship', facets: ['graph'] },
    // Apps have no numbers, but every store accepts human ids on input.
    { use: '@yaks/id', words: [] },
    ...addressed,
    '@yaks/doc',
    '@yaks/forms',
    // Only the rule a sign-up's people settle by: an app names @yaks/people
    // for its words (vocab.ts `lent`), or declares them itself the same way.
    { use: '@yaks/people', facets: ['graph'] },
    '@yaks/events',
    '@yaks/draft',
    { use: '@yaks/member', with: { through: THROUGH } },
    {
      use: '@yaks/task',
      facets: ['vocab'],
      words: ['contains', 'requires', 'task', 'decision'],
    },
    { use: '@yaks/project', facets: ['vocab'], words: ['filed', 'project'] },
    ...links,
    { use: '@yaks/notify', facets: ['vocab'], words: ['subscription'] },
    {
      use: '@yaks/mail',
      facets: toolFacets,
      with: { sender: { via: 'worker' } },
    },
    // An app's texts: the people it texts and their agreement, the texts it
    // sends from its number and those that arrive at it (app-texts.ts).
    {
      use: '@yaks/phone',
      facets: ['vocab', 'effects'],
      words: ['phone', 'sms_consent', 'text', 'text_post'],
      with: { sender: { via: 'worker' } },
    },
    // What is said on the chat connections the app uses, and what it says
    // there: each message heard lands as a row, and a row it writes to a
    // room is posted by the connection's bot (workers/yak chat.ts).
    { use: '@yaks/chat', facets: ['vocab', 'effects'] },
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
        'ask',
        'using',
        'sending',
        'offer',
        'told',
        'notice',
        'stop',
        'attempt',
        'cancel',
        'dispatch',
        'session_input',
        'session_run',
        'session_resume',
        'session_result',
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
        'model_result',
        'stream_item',
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
    // What the app holds, told to the directory (weigh-graph.ts), and
    // the words a write brought, told to the Lexicon.
    { use: 'yak/weigh', facets: ['graph'] },
    { use: 'yak/lexicon', facets: ['graph'] },
    ...behind,
    // Last, so no write hook rewrites a value it checked.
    { use: 'yak/admit', facets: ['graph'] },
  ]),
}

/** What an app store composes once it keeps versions: the journal, its
 * versions on and its attribution off, since every row carries its own
 * stamps, and no feed, since a Durable Object is its store's only host. A
 * store's first branch records it as required (@yaks/host `meet`), and that
 * record is what makes a store compose {@link appVersionsConfig}. */
export let versions = {
  use: '@yaks/journal',
  facets: ['graph'] as FacetName[],
  with: { versions: true, attribution: false, feed: false },
} satisfies Plug

/** An app store that keeps versions: {@link appConfig} and {@link versions},
 * ahead of the hooks that run once a write commits. */
export let appVersionsConfig: Config = {
  plugins: appConfig.plugins!.flatMap((plug) =>
    typeof plug != 'string' && plug.use == 'yak/weigh'
      ? [versions, plug]
      : [plug]
  ),
}
