// The packages and Worker domains each kind of store composes. Chosen words
// preserve the vocabulary each store already holds.
import type { Config, Plug } from '@yaks/host/config'
import type { FacetName } from '@yaks/host'
import { memoryDoc } from '@yaks/memory/vocab'

/** The rows each read as the entity they name does (@yaks/member
 * `through`): a document's pages, and a heard recording's turns. */
export let THROUGH = { document_page: 'document', heard_turn: 'recording' }

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
        'cancelled',
        'favorite',
      ],
    },
    provenance,
    ...machine(),
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
      words: ['contains', 'requires', 'task'],
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
  ]),
}

export let directoryConfig: Config = {
  numbers: true,
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
        'unchecked',
      ],
    },
    provenance,
    // Who changed a space's or an app's address or title, its seats and
    // invitations, when and from what (T-135993): read as `_change` and `_tx`
    // rows. Only these words: the rest of the directory is written on every
    // visit, spend and deploy.
    {
      use: '@yaks/journal',
      facets: ['vocab'],
      words: ['_tx', '_change'],
      with: {
        components: ['space', 'doc', 'former', 'member', 'grant', 'invite'],
      },
    },
    // The directory keeps the persona every Operator is worn on
    // (operator-persona.ts), and each skill a space publishes, at the version
    // on offer (shared-skill.ts).
    ...machine(['person', 'persona', 'skill']),
    '@yaks/id',
    ...addressed,
    '@yaks/doc',
    '@yaks/draft',
    // doc.body uses the blob keyword and graph hooks without artifact words.
    { use: '@yaks/blob', words: [] },
    { use: '@yaks/task', facets: ['vocab'], words: ['contains', 'requires'] },
    ...links,
    // A support thread (support.ts): a conversation whose messages are
    // comments, and the letter each message owes TaskMaster, as each hour's
    // refusal report is one (refusals.ts), sent by the pool
    // through the platform's own sender (graph.ts `senders`) so a mail outage
    // keeps the letter waiting rather than losing it.
    { use: '@yaks/inbox', facets: ['vocab'], words: ['conversation'] },
    {
      use: '@yaks/mail',
      words: [
        'notified',
        'mail',
        'deliver',
        'delivered',
        'bounced',
        'mail_post',
      ],
      with: { sender: { via: 'platform' } },
    },
    // A person's mobile number beside their address, the words they agreed
    // to before being texted, and the numbers their own connected phone
    // account holds (operator-line.ts). Texts themselves are kept by the
    // Operator, not here, so `text` stays free for apps.
    {
      use: '@yaks/phone',
      facets: ['vocab'],
      words: ['phone', 'own_number', 'sms_consent', 'sender'],
    },
    // The browsers a person allowed notifications on (operator-alerts.ts).
    { use: '@yaks/push', facets: ['vocab'], words: ['push_subscription'] },
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
    { use: '@yaks/topic', facets: ['vocab', 'graph'], words: ['topic'] },
    { use: '@yaks/connections', facets: toolFacets },
    { use: '@yaks/mcp-client', facets: ['vocab'] },
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
    'yak/refusals',
    { use: 'yak/pages', facets: ['graph'] },
    { use: 'yak/publishing', facets: ['graph'] },
    { use: 'yak/attribution', words: ['browser', 'attribute_writes'] },
    'yak/git',
    { use: 'yak/wrap', facets: ['graph'] },
    { use: 'yak/remake', facets: ['graph'] },
    { use: 'yak/kills', facets: ['graph'] },
    { use: 'yak/signin', facets: ['graph'] },
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

/**
 * The Operator's store (operator-store.ts): a session's store, the
 * conversations a person has with their Operator and the work it does for
 * them. The Builder object composes it beside its builds, and a person's
 * session on the box names the same list (T-163657).
 */
export let operatorConfig: Config = {
  plugins: [
    { use: '@yaks/kernel', facets: ['vocab'] },
    provenance,
    { use: '@yaks/doc', facets: ['vocab'] },
    { use: '@yaks/task', facets: ['vocab'] },
    // The space's goals and the work that serves them (operator-tasks.ts).
    { use: '@yaks/goal', facets: ['vocab'] },
    { use: '@yaks/project', facets: ['vocab'] },
    { use: '@yaks/persona', facets: ['vocab'] },
    { use: '@yaks/session', facets: ['vocab', 'graph'] },
    // Its model calls, and the replies of the providers that answer them
    // (`operatorProviders`); a model an input names is a row from then on
    // (`requesting`).
    { use: '@yaks/model', facets: ['vocab', 'graph'] },
    // How its persona speaks on a call (operator-persona.ts).
    { use: '@yaks/speech', facets: ['vocab'] },
    { use: '@yaks/anthropic', facets: ['vocab'] },
    { use: '@yaks/openai', facets: ['vocab'] },
    { use: '@yaks/tools', facets: ['vocab'] },
    { use: '@yaks/context', facets: ['vocab'] },
    { use: '@yaks/effects', facets: ['vocab'] },
    { use: '@yaks/edge', facets: ['vocab'] },
    { use: '@yaks/mail', facets: ['vocab'] },
    // Its own words, and the `owner{person}` a person's reads are screened
    // by, which no package owns yet (T-163656).
    { use: 'yak/operator', facets: ['vocab', 'graph'] },
    // A skill installed from another space keeps where it came from and the
    // version it took, and one someone outside yaks.app wrote keeps its
    // source and licence notice (shared-skill.ts).
    {
      use: '@yaks/platform',
      facets: ['vocab'],
      words: ['installed', 'upstream'],
    },
    // The rounds a skill is compared and improved in (operator-trials.ts),
    // which its public page shows (skill-page.ts), and the names a round's
    // file finds its rows again by.
    { use: '@yaks/trial', facets: ['vocab'] },
    // The texts it sends and receives for a person (operator-texts.ts).
    { use: '@yaks/phone', facets: ['vocab'], words: ['text', 'sender'] },
    // A person's Updates from the Operator (operator-updates.ts): what it
    // tells them, and what each has read.
    {
      use: '@yaks/notify',
      facets: ['vocab'],
      words: ['notification', 'subscription'],
    },
    { use: '@yaks/draft', facets: ['vocab', 'graph'] },
    // Its tools take back the `#id` its context names everything by; the
    // store keeps no numbers.
    { use: '@yaks/id', facets: ['graph'] },
    { use: '@yaks/key', facets: ['vocab', 'graph'] },
    { use: '@yaks/alias', facets: ['vocab', 'graph'] },
    { use: '@yaks/memory', facets: ['vocab'] },
    // The wake-ups the Operator sets for the people it works for
    // (operator-wakes.ts).
    { use: '@yaks/wake', facets: ['vocab', 'graph'] },
    { use: '@yaks/topic', facets: ['vocab', 'graph'] },
    // Bodies kept once by their address, in the store's own file.
    { use: '@yaks/blob', facets: ['vocab', 'graph'] },
  ],
}

// A provider plugin's options, with the secrets in the Worker's environment
// that its credentials are kept in.
let phone = (use: string, options: Record<string, unknown>): Plug => ({
  use,
  facets: ['graph'],
  with: options,
})

/**
 * What the kernel itself composes, outside any store: the phone providers
 * the platform texts and calls through (phones.ts). Each lends its phone
 * under its name; `PHONE_SENDER` picks the one the platform sends from, and
 * a space's `sender{via}` another. A `{"secret": "NAME"}` is read from the
 * Worker's environment at its use.
 */
export let phoneConfig: Config = {
  plugins: [
    phone('@yaks/telnyx', {
      key: { secret: 'TELNYX_API_KEY' },
      profile: 'yaks.app',
      tollFree: true,
      api: { secret: 'TELNYX_API' },
      door: { key: { secret: 'TELNYX_PUBLIC_KEY' } },
    }),
    phone('@yaks/pinnacle', {
      key: { secret: 'PINNACLE_API_KEY' },
      number: { secret: 'PINNACLE_NUMBER' },
      api: { secret: 'PINNACLE_API' },
      door: { key: { secret: 'PINNACLE_SIGNING_SECRET' } },
    }),
    phone('@yaks/voipms', {
      user: { secret: 'VOIPMS_USERNAME' },
      key: { secret: 'VOIPMS_API_PASSWORD' },
      number: { secret: 'VOIPMS_NUMBER' },
    }),
  ],
}

/**
 * The payment provider the platform takes money through (payments.ts): its
 * plugin lends it under its name, with its key, the clock its calls wait on,
 * each plan's prices as they are sold here, by the month and the year, and
 * the secret each of its webhook doors verifies with, which it serves at
 * `/<via>/<door>` (payment-doors.ts). A `{"secret": "NAME"}` is read from the
 * Worker's environment at its use; the prices are `[vars]` (wrangler.toml),
 * and a plan whose price is unset is not on sale. The secrets are the
 * owner's to set (README.md); a door whose secret is unset answers 503.
 */
export let payments: Config & { via: string } = {
  via: 'stripe',
  plugins: [{
    use: '@yaks/stripe',
    facets: ['graph'],
    with: {
      key: { secret: 'STRIPE_KEY' },
      clock: { binding: 'CLOCK' },
      prices: {
        plus: { month: { secret: 'STRIPE_PRICE' } },
        pro: {
          month: { secret: 'STRIPE_PRICE_PRO' },
          year: { secret: 'STRIPE_PRICE_PRO_YEAR' },
        },
      },
      doors: {
        webhook: { secret: 'STRIPE_WEBHOOK_SECRET' },
        connect: { secret: 'STRIPE_CONNECT_WEBHOOK_SECRET' },
      },
    },
  }],
}

// Workers AI over the Worker's `AI` binding, which is its authorization.
let workersAi: Plug = {
  use: '@yaks/workers-ai',
  with: { ai: { binding: 'AI' }, gateway: { binding: 'AI_GATEWAY' } },
}

// OpenAI, on the platform's key or through the account's AI Gateway on the
// gateway's own token. The default key is the "yaks.app images" project's, which may
// use only the GPT Image models, so OpenAI answers an app's image asks and
// refuses the rest; no gateway is set (wrangler.toml).
let openai = (key = 'OPENAI_API_KEY'): Plug => ({
  use: '@yaks/openai',
  with: {
    key: { secret: key },
    base: { binding: 'OPENAI_API' },
    gateway: {
      account: { binding: 'CF_ACCOUNT' },
      id: { binding: 'AI_GATEWAY' },
      token: { secret: 'AI_GATEWAY_TOKEN' },
    },
    web: false,
    images: false,
  },
})

/** The model providers the platform's own layers are lent (providers.ts):
 * each a plugin exporting `./provider` (@yaks/model `ProviderFacet`), with
 * the options it is given. No layer imports one; it asks for a model by the
 * provider name it serves under. */
let supplied = (key: string): Config => ({
  plugins: [
    workersAi,
    { use: '@yaks/anthropic', with: { key: { secret: 'ANTHROPIC_API_KEY' } } },
    openai(key),
  ],
})

export let providing: Config = supplied('OPENAI_API_KEY')

/** Operator conversations may use their own scoped key; image generation and
 * apps retain the platform's existing provider configuration. */
export let operatorProviders = (separate = false): Config =>
  separate ? supplied('OPENAI_OPERATOR_API_KEY') : providing

/** What the platform's own agents run on, each a model of a provider
 * `providing` names: the builder's provider, whose models `BUILDER_MODEL_FREE`
 * and `BUILDER_MODEL_PAID` name, and the Operator's choices, the first taken
 * whose provider the Worker holds every credential of, with the stronger
 * model it hands coding to. `OPERATOR_MODEL` and `OPERATOR_DELEGATE` name
 * other models of that provider. `machine` is what the Operator of someone
 * whose own machine serves it asks that machine for instead. */
export let agents: {
  builder: string
  operator: { provider: string; model: string; delegate?: string }[]
  machine: { model: string; delegate?: string }[]
} = {
  builder: 'workers-ai',
  operator: [
    {
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      delegate: 'claude-opus-5-5',
    },
    { provider: 'workers-ai', model: '@cf/zai-org/glm-5.3' },
  ],
  // What an Operator asks its person's own machine for (operator-machine.ts):
  // a model for each provider a machine lends, by the model's own name, in
  // the order asked, with the stronger model of that provider. The machine
  // says which of its providers answers each.
  machine: [
    { model: 'sonnet', delegate: 'claude-opus-5-5' },
    { model: 'gpt-6-sol', delegate: 'gpt-6-astra' },
  ],
}

/** What the Operator makes pictures with (operator-images.ts): a provider
 * `providing` names, and the models of it the Operator may choose, the first
 * the one it uses unless asked for another. */
export let images = {
  provider: 'openai',
  models: [
    'gpt-image-2.6-flare',
    'gpt-image-2.6-sunburst',
    'gpt-image-2.5-flare',
    'gpt-image-2.5-sunburst',
  ],
}

/** The model providers an app's store is lent (models.ts), the same way: by
 * the provider name each serves under, the first serving a model no row says
 * the provider of. A provider named bare is the app's own, called on the
 * app's connection to the integration named as it serves and refused where
 * the app has none; one given options of the Worker's is the platform's,
 * which pays. A `{"secret": NAME}` among them is a credential, which a call
 * the hosted executor makes (inference.ts) carries as a sentinel, exchanged
 * on the way to the provider's `hosts`; a `{"binding": NAME}` is what the
 * Worker holds that is no credential (a setting, a binding), carried as it
 * is. */
export let serving: Config = {
  plugins: [workersAi, '@yaks/openrouter', openai()],
}

/** The names a yaks app already asks `./api/ai/run` and its worker's `AI`
 * binding for, each the OpenAI model of matching ability that answers it:
 * GPT-6 Luna for chat with tools and for pictures, GPT-6.1 Terra for GLM's
 * larger model. */
export let aliases: Record<string, string> = {
  '@cf/zai-org/glm-5.3-flash': 'gpt-6-luna',
  '@cf/meta/llama-4-scout-17b-16e-instruct': 'gpt-6-luna',
  '@cf/google/gemma-4-26b-a4b-it': 'gpt-6-luna',
  '@cf/openai/gpt-oss-120b': 'gpt-6-luna',
  '@cf/zai-org/glm-5.3': 'gpt-6.1-terra',
}

/** The providers `./api/ai/run` asks, each through its own door (meter.ts
 * `metered`): the first whose door answers the model asked for and whose key
 * the Worker holds. OpenAI answers the names in `aliases`, on the "yaks.app
 * models" project's key, which may use only the models they name; Workers AI
 * answers the rest, embeddings among them, since an app's stored vectors were
 * made by the model it names. */
export let answering: Config = {
  plugins: [
    {
      use: '@yaks/openai',
      with: { key: { secret: 'OPENAI_MODELS_KEY' }, aliases },
    },
    workersAi,
  ],
}

/** The embedders a store's vectors may be made by (embedding.ts): each a
 * plugin whose graph facet lends one by name (@yaks/host `Host.embedders`),
 * given the store's `AI` binding, which the store holds to its space's
 * budget. embedding.json says which one makes them, and with what model. */
export let embedding: Config = {
  plugins: [{
    use: '@yaks/workers-ai',
    facets: ['graph'],
    with: { ai: { binding: 'AI' } },
  }],
}

/** The Worker itself (index.ts, @yaks/workerd `compose`): each plugin's
 * `./worker` facet, in the order the router asks them, and the kinds of store
 * its Store object serves, each by its own plugins (graph.ts `storeKind`).
 * The deploy's version answers first, before the kernel's router is loaded. */
export let worker = {
  plugins: [
    {
      use: '@yaks/workerd',
      with: { name: 'kernel', version: { binding: 'CF_VERSION_METADATA' } },
    },
    'yak/kernel',
  ],
  stores: {
    app: appConfig,
    directory: directoryConfig,
    git: gitConfig,
  },
} satisfies Config

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
  'yak/kernel': { worker: './facets/kernel-worker.ts' },
  'yak/app': {
    vocab: './facets/app-vocab.ts',
    graph: './facets/app-graph.ts',
    effects: './facets/app-effects.ts',
  },
  'yak/directory': {
    vocab: './facets/directory-vocab.ts',
    graph: './facets/directory-graph.ts',
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
  'yak/refusals': {
    vocab: './facets/refusals-vocab.ts',
    effects: './facets/refusals-effects.ts',
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
  'yak/operator': {
    vocab: './facets/operator-vocab.ts',
    graph: './facets/operator-graph.ts',
  },
  'yak/wrap': { graph: './facets/wrap-graph.ts' },
  'yak/remake': { graph: './facets/remake-graph.ts' },
  'yak/kills': { graph: './facets/kills-graph.ts' },
  'yak/signin': { graph: './facets/signin-graph.ts' },
}
