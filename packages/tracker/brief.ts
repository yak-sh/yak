// How a long thing reads in a line. An error's message, a stack's file and a
// commit are stored whole; a person scanning a list or a page reads them
// briefly, with the whole one click away. Nothing here is stored.

// deno-lint-ignore no-control-regex -- terminal colour escapes in messages.
let ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
let UUID =
  /\b([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
let URL_ = /\b([a-z][a-z0-9+.-]*:\/\/[^\s()'"<>]+)/gi
let DIGITS = /\b(\d{4})\d{8,}\b/g

/// place('file:///home/yaks/code/tasks/packages/code/source.ts') -> 'packages/code/source.ts'
/// place('ext:deno_fetch/26_fetch.js') -> 'ext:deno_fetch/26_fetch.js'
/// place('https://jsr.io/@std/assert/1.0.0/mod.ts') -> 'assert/1.0.0/mod.ts'
/** A file as a person finds it in a project: its last three segments, the
 * scheme and the checkout around them left off. */
export let place = (file: string): string => {
  let path = file.replace(/^file:\/\//, '').replace(/^[a-z]+:\/\/[^/]+/i, '')
  let parts = path.split('/').filter(Boolean)
  return parts.length > 3 ? parts.slice(-3).join('/') : file
}

/// link('http://127.0.0.1:5173/query?q=.entity.eid%3D99bf28a8') -> 'http://127.0.0.1:5173/query?…'
/// link('file:///home/yaks/code/tasks/packages/cli/args.ts') -> 'packages/cli/args.ts'
/** An address in a message: a file by its place, a URL without its query. */
export let link = (url: string): string =>
  url.startsWith('file://') ? place(url) : url.replace(/[?#].*$/, '?…')

/// headline('TypeError: error sending request for url (http://127.0.0.1:5173/query?q=a%2Cb): refused') -> 'TypeError: error sending request for url (http://127.0.0.1:5173/query?…): refused'
/// headline('Error: /mcp said 500 (request 8340c228-dc11-464e-a9fe-1655ef354a15)') -> 'Error: /mcp said 500 (request 8340c228…)'
/// headline("Error: Unknown export './sentry'.\n  Package exports:\n * .") -> "Error: Unknown export './sentry'."
/// headline('\u001b[31mError\u001b[0m: red') -> 'Error: red'
/// headline('') -> ''
/** A message as one line a person reads: its first line, terminal colours
 * left out, an address without its query, an id or a long number cut to its
 * start. The message it stands for is unchanged. */
export let headline = (text: string): string =>
  (text.replace(ANSI, '').split('\n').find((l) => l.trim()) ?? '')
    .replace(URL_, (url) => link(url))
    .replace(UUID, '$1…')
    .replace(DIGITS, '$1…')
    .replace(/\s+/g, ' ')
    .trim()

/// thrown('TypeError: no row') -> { type: 'TypeError', message: 'no row' }
/// thrown('HTTP request failed') -> { message: 'HTTP request failed' }
/// thrown('Error: /mcp said 500') -> { type: 'Error', message: '/mcp said 500' }
/** A title split where its thrown value's type ends, as the tracker writes
 * it (`type: value`). A sentence without one is all message. */
export let thrown = (title: string): { type?: string; message: string } => {
  let m = /^([A-Za-z_$][\w$.]{0,48}): ([^]*)$/.exec(title)
  return m ? { type: m[1], message: m[2] } : { message: title }
}

/// sha('9917d09d30a68730b83661652bdcaecc38670809') -> '9917d09'
/// sha('v1.2') -> 'v1.2'
/** A commit as people say it: seven characters of its sha. */
export let sha = (commit: string): string =>
  /^[0-9a-f]{40}$/i.test(commit) ? commit.slice(0, 7) : commit

/// spot('file:///home/yaks/code/tasks/packages/code/source.ts:56 Object.get') -> { place: 'packages/code/source.ts:56', fn: 'Object.get', file: 'file:///home/yaks/code/tasks/packages/code/source.ts:56' }
/// spot('ext:deno_web/03_abort_signal.js:102') -> { place: 'ext:deno_web/03_abort_signal.js:102', file: 'ext:deno_web/03_abort_signal.js:102' }
/** A stack's text frame as `bug.spot` keeps it (`file:line function`): where
 * it is, briefly, and what ran there. */
export let spot = (
  text: string,
): { place: string; fn?: string; file: string } => {
  let [file, ...rest] = text.split(' ')
  let m = /^(.*?)((?::\d+)*)$/.exec(file)!
  let fn = rest.join(' ')
  return { place: place(m[1]) + m[2], ...fn ? { fn } : {}, file }
}

/** A moment to the second, in the reader's own clock and words. */
export let moment = (at: string): string =>
  new Date(at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

/// count(1, 'hit') -> '1 hit'
/// count(1200, 'hit') -> '1,200 hits'
/** A count and its noun, plural past one. */
export let count = (n: number, noun: string): string =>
  `${n.toLocaleString('en-US')} ${noun}${n == 1 ? '' : 's'}`
