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

let spine = ['entity']
// The stamps every write leaves, beside the kernel in every store.
let provenance: Plug = { use: '@yaks/provenance', facets: ['vocab'] }
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
let machine = (persona = ['person']): Plug[] => [
  { use: '@yaks/persona', facets: ['vocab'], words: persona },
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
    provenance,
    ...machine(),
    // Apps have no numbers, but every store accepts human ids on input.
    { use: '@yaks/id', words: [] },
    ...addressed,
    '@yaks/doc',
    '@yaks/draft',
    { use: '@yaks/member', with: { through: { document_page: 'document' } } },
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
    // An app's texts: the people it texts and their agreement, the texts it
    // sends from its number and those that arrive at it (app-texts.ts).
    {
      use: '@yaks/phone',
      facets: ['vocab', 'effects'],
      words: ['phone', 'sms_consent', 'text', 'text_post'],
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
        'ask',
        'using',
        'sending',
        'offer',
        'notice',
        'stop',
        'attempt',
        'cancel',
        'dispatch',
        'session_input',
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
    provenance,
    // The directory keeps the persona every Operator is worn on
    // (operator-persona.ts).
    ...machine(['person', 'persona']),
    '@yaks/id',
    ...addressed,
    '@yaks/doc',
    // doc.body uses the blob keyword and graph hooks without artifact words.
    { use: '@yaks/blob', words: [] },
    { use: '@yaks/task', facets: ['vocab'], words: ['contains', 'requires'] },
    ...links,
    { use: '@yaks/mail', words: ['notified'] },
    // A person's mobile number beside their address, and the words they
    // agreed to before being texted. Texts themselves are kept by the
    // Operator, not here, so `text` stays free for apps.
    {
      use: '@yaks/phone',
      facets: ['vocab'],
      words: ['phone', 'sms_consent', 'sender'],
    },
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
    { use: '@yaks/topic', facets: ['vocab'], words: ['topic'] },
    { use: '@yaks/connections', facets: toolFacets },
    // Each call out through a `uses` link counted on it (outbound.ts).
    { use: '@yaks/egress', facets: ['vocab', 'graph'] },
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
    { use: 'yak/publishing', facets: ['graph'] },
    { use: 'yak/attribution', words: ['browser', 'attribute_writes'] },
    'yak/git',
    { use: 'yak/wrap', facets: ['graph'] },
    { use: 'yak/remake', facets: ['graph'] },
    { use: 'yak/kills', facets: ['graph'] },
  ]),
}

export let gitConfig: Config = {
  numbers: true,
  plugins: storePlugins([
    { use: '@yaks/kernel', facets: ['vocab'], words: spine },
    provenance,
    ...machine(),
    '@yaks/id',
    ...addressed,
    { use: '@yaks/blob', words: [] },
    // A path in a repository is a `file` rooted in it.
    '@yaks/file',
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

/** The mail providers the kernel Worker itself lends to its layers: letters
 * it sends (post.ts), the notices a provider posts about them
 * (mail-receipts.ts) and the letters that arrive (inbox.ts). An option names
 * the Worker's env it is read from when accessed: `{"secret": NAME}` a secret
 * or var, `{"binding": NAME}` a binding the Worker holds. */
export type Post = Config & {
  /** the sender these letters take where the deploy's MAIL_VIA names none */
  via: string
}

// The same providers carry both kinds of letter, each kind on its own Resend
// key: Resend restricts a key to one sending domain.
let mailing = (token: string): Plug[] => [
  {
    use: '@yaks/cloudflare-mail',
    facets: ['graph'],
    with: {
      // The Worker's own account sends its mail.
      account: { secret: 'CF_ACCOUNT' },
      token: { secret: 'MAIL_TOKEN' },
      base: { secret: 'MAIL_API' },
      fetch: { binding: 'MAIL_FETCH' },
      binding: { binding: 'MAIL' },
    },
  },
  {
    use: '@yaks/resend',
    facets: ['graph'],
    with: {
      token: { secret: token },
      base: { secret: 'RESEND_API' },
      fetch: { binding: 'MAIL_FETCH' },
      receipts: { secret: { secret: 'RESEND_WEBHOOK_SECRET' } },
    },
  },
]

export let posts: Record<'platform' | 'apps', Post> = {
  // The platform's own letters, sign-in codes and notices, from bot.yak.sh.
  platform: { via: 'cloudflare', plugins: mailing('RESEND_PLATFORM_TOKEN') },
  // What apps and Operators send, from yaks.app.
  apps: { via: 'binding', plugins: mailing('RESEND_TOKEN') },
}

/** The arrival that reads a letter Email Routing hands `email()` (inbox.ts). */
export let ARRIVAL = 'cloudflare'

/** Worker domains export the same store facets as packages, at local paths. */
export let domains = {
  'yak/app': {
    vocab: './facets/app-vocab.ts',
    graph: './facets/app-graph.ts',
    effects: './facets/app-effects.ts',
  },
  'yak/directory': {
    vocab: './facets/directory-vocab.ts',
    effects: './facets/directory-effects.ts',
  },
  'yak/trash': {
    vocab: './facets/trash-vocab.ts',
    graph: './facets/trash-graph.ts',
    effects: './facets/trash-effects.ts',
  },
  'yak/meter': {
    vocab: './facets/meter-vocab.ts',
    graph: './facets/meter-graph.ts',
  },
  'yak/pages': { graph: './facets/pages-graph.ts' },
  'yak/publishing': { graph: './facets/publishing-graph.ts' },
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
  'yak/wrap': { graph: './facets/wrap-graph.ts' },
  'yak/remake': { graph: './facets/remake-graph.ts' },
  'yak/kills': { graph: './facets/kills-graph.ts' },
}
