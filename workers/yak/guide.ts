// The guide's pages (T-32982). `public/guide.md` stays what it is — the map,
// covering pretty much everything there is, briefly — and beside it sit the
// pages that go deep on one subject each, `public/guide/<slug>.md`, offered
// through the connector as resources of their own. Owner, 2026-09-03: "the
// guide should still list pretty much everything, but it can be very brief
// with links to read more details about each feature. like querying, i could
// imagine a whole doc giving tons of query examples."
//
// So a page is not the guide's paragraph relocated: the guide says what a
// feature IS in a passage someone can hold in their head, and the page is the
// fuller treatment — the worked examples, the whole reference, the mistakes —
// which is why several of them are longer than the section they answer. The
// two texts serve different moments, and the thing to guard against is not
// that overlap but two full copies of one explanation drifting apart.
//
// A page's uri IS the address that serves it, like the guide's: the files are
// under `public/`, so the assets binding answers them at yaks.app and nothing
// routes. What makes the split work is the DESCRIPTION — it is the only thing
// an agent sees before deciding to read, so each names the words someone with
// that question would be searching for.
export type Page = {
  slug: string
  title: string
  description: string
}

export let WHOLE = 'https://yaks.app/guide.md'

export let uriOf = (slug: string) => `https://yaks.app/guide/${slug}.md`

export let PAGES: Page[] = [
  {
    slug: 'store',
    title: 'The store, from a page',
    description:
      './api/client.js in full — apply, query, search, subscribe, upload ' +
      'and me — the shape of an entity bundle, patching and deleting, who ' +
      'may read and write, the byline on a row, and the HTTP doors ' +
      'underneath.',
  },
  {
    slug: 'querying',
    title: 'Querying: the filter line',
    description:
      'The filter grammar every door here speaks, with worked examples: ' +
      'presence and absence, contains, comparisons, ranges, time phrases, ' +
      'walking a reference, counting, paging, full text — and why a row ' +
      'carries only the components its filter named.',
  },
  {
    slug: 'components',
    title: "Components: the platform's, and your own",
    description:
      'Every component an app already has, column by column, and vocab.json ' +
      'for words of your own: the column types, what a later deploy may ' +
      'change, the names already taken, and when a column beats doc.body.',
  },
  {
    slug: 'entities',
    title: 'One entity, two apps',
    description:
      "Two of the person's apps writing about the same entity without " +
      'copying it: which app a component lives in, how a page reads a ' +
      'sibling app, and how graph_query composes one bundle out of several.',
  },
  {
    slug: 'files',
    title: 'Files and pictures',
    description:
      'upload() for a file off an <input>: where the bytes are served back ' +
      'from, the attachment and image rows it writes, the 20 MB ceiling and ' +
      'the downscale under it, and a gallery that never shows one picture ' +
      'twice.',
  },
  {
    slug: 'tools',
    title: 'Tools of your own',
    description:
      "tools.json, so the person's agent can act on an app with no page " +
      "open: an entry's description, its input types and {{arg}} holes, the " +
      'apply and query acts, what a deploy refuses, and the view an answer ' +
      'draws itself in.',
  },
  {
    slug: 'code',
    title: 'Code of your own',
    description:
      "worker.js in front of an app's files: which routes are yours, what " +
      'env holds (STORE, FILES, and the secrets you set), what a request ' +
      'says about who is asking, the CPU and subrequest limits, and whole ' +
      'workers to copy.',
  },
  {
    slug: 'sharing',
    title: 'Publishing and installing an app',
    description:
      'Who may read and write an app, and how one travels: app_publish, ' +
      'app_install and app_update, what an installed copy shares (the code, ' +
      'and nothing else), what pinning means, and what an update does to ' +
      'what people saved.',
  },
  {
    slug: 'errors',
    title: 'When something breaks',
    description:
      'What a refused call answers and how a page shows it, where a break ' +
      'is filed and how the agent hears about it once, app_errors, ' +
      'app_versions and app_rollback, and feedback for when the platform is ' +
      'what is wrong.',
  },
]
