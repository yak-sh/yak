// What a person reads in place of a tool's name. A tool's `title` is an
// imperative phrase ("Read or write app files"); a view showing a call says it
// in the tense of the call: "Reading or writing app files…" while it runs,
// "Read or wrote app files" once it answered. A tool without a title is its
// name in words ("graph_schema" is "Graph schema").

/** A tool's English name: its title, or its name in words. */
export let titleOf = (
  t: { name?: string | null; title?: string | null },
): string =>
  t.title?.trim() ||
  (t.name ?? '').replace(/[_-]+/g, ' ').trim().replace(/^./, (c) =>
    c.toUpperCase())

// The past tense of the verbs whose past is not their base plus -ed.
let PAST: Record<string, string> = {
  begin: 'began',
  bring: 'brought',
  build: 'built',
  buy: 'bought',
  choose: 'chose',
  cut: 'cut',
  do: 'did',
  draw: 'drew',
  find: 'found',
  get: 'got',
  give: 'gave',
  hold: 'held',
  keep: 'kept',
  know: 'knew',
  leave: 'left',
  lend: 'lent',
  let: 'let',
  make: 'made',
  pay: 'paid',
  put: 'put',
  read: 'read',
  run: 'ran',
  say: 'said',
  see: 'saw',
  sell: 'sold',
  send: 'sent',
  set: 'set',
  spend: 'spent',
  take: 'took',
  tell: 'told',
  think: 'thought',
  write: 'wrote',
}

// The verbs that double their last letter before -ing and -ed.
let DOUBLE = new Set([
  'cut',
  'drop',
  'get',
  'let',
  'log',
  'plan',
  'put',
  'run',
  'set',
  'ship',
  'stop',
  'swap',
  'tag',
])

// The verbs a title may begin with. A title beginning with any other word is
// said as it is.
let VERBS = new Set([
  ...Object.keys(PAST),
  ...DOUBLE,
  'add',
  'answer',
  'apply',
  'archive',
  'arm',
  'ask',
  'attach',
  'call',
  'cancel',
  'change',
  'check',
  'claim',
  'close',
  'compact',
  'complete',
  'connect',
  'copy',
  'count',
  'create',
  'decide',
  'delete',
  'deploy',
  'describe',
  'detach',
  'download',
  'edit',
  'erase',
  'explain',
  'export',
  'fetch',
  'file',
  'fix',
  'grant',
  'import',
  'inspect',
  'install',
  'invite',
  'land',
  'link',
  'list',
  'load',
  'look',
  'mark',
  'merge',
  'move',
  'mute',
  'name',
  'note',
  'open',
  'peek',
  'post',
  'preview',
  'publish',
  'query',
  'recall',
  'record',
  'release',
  'remove',
  'rename',
  'reopen',
  'reply',
  'report',
  'reshare',
  'resolve',
  'restart',
  'restore',
  'retry',
  'revert',
  'review',
  'roll',
  'save',
  'search',
  'show',
  'sign',
  'start',
  'supply',
  'sync',
  'unarchive',
  'unpublish',
  'update',
  'upload',
  'visualize',
  'wait',
  'watch',
  'wrap',
])

let stem = (verb: string) => DOUBLE.has(verb) ? verb + verb.at(-1) : verb

let ing = (verb: string) =>
  verb.endsWith('ie')
    ? verb.slice(0, -2) + 'ying'
    : verb.endsWith('e') && !verb.endsWith('ee')
    ? verb.slice(0, -1) + 'ing'
    : stem(verb) + 'ing'

let ed = (verb: string) =>
  PAST[verb] ??
    (verb.endsWith('e')
      ? verb + 'd'
      : /[^aeiou]y$/.test(verb)
      ? verb.slice(0, -1) + 'ied'
      : stem(verb) + 'ed')

// The title with each of its leading verbs ("Read or write", "Rename, move or
// reshare") put in a tense; null when it does not begin with a verb.
let tensed = (title: string, tense: (verb: string) => string) => {
  let words = title.split(' ')
  let i = 0
  while (i < words.length) {
    let [, word, comma] = /^(.*?)(,?)$/.exec(words[i])!
    let verb = word.toLowerCase()
    if (!VERBS.has(verb)) break
    let said = tense(verb)
    words[i] =
      (word[0] == verb[0] ? said : said[0].toUpperCase() + said.slice(1)) +
      comma
    i++
    if (comma) continue
    if (words[i] == 'or' || words[i] == 'and') i++
    else break
  }
  return i ? words.join(' ') : null
}

/** The call while it runs: "Listing app versions…". */
export let doing = (title: string): string =>
  (tensed(title, ing) ?? title) + '…'

/** The call once it answered: "Listed app versions". */
export let did = (title: string): string => tensed(title, ed) ?? title
