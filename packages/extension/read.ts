// Reading the page a tab shows: its address, its title, its visible text and
// what the person selected, as one plain value a tool's answer is made from.
//
// `read` runs inside the page. The browser glue hands it to
// `chrome.scripting.executeScript({func: read})`, which sends the function's
// source text to the tab and calls it there with no arguments, so it closes
// over nothing in this module: every helper and limit lives inside it, and its
// defaults read the page's own `document`. Its result crosses back by
// structured clone, so it is strings only.

/** What a tab gave when its page was read. */
export type Page = {
  url: string
  title: string
  text: string
  selection: string
}

/** The page a document shows, read as a person sees it: scripts, styles and
 * hidden elements skipped, whitespace collapsed to single spaces within a
 * line, one line per block, and the text and selection each cut at `limit`
 * characters with a note saying so. */
export let read = (
  doc: Document = document,
  selected: string = doc.getSelection?.()?.toString() ?? '',
  limit: number = 50_000,
): Page => {
  let SKIP =
    /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|OBJECT|EMBED|CANVAS|SVG|HEAD|SELECT|TEXTAREA|INPUT)$/
  let BLOCK =
    /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|DD|DETAILS|DIALOG|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|SUMMARY|TABLE|TD|TH|TR|UL)$/
  let HIDDEN = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)/i
  let hidden = (el: Element) =>
    el.hasAttribute('hidden') || el.getAttribute('aria-hidden') == 'true' ||
    HIDDEN.test(el.getAttribute('style') ?? '') ||
    // A browser knows what its stylesheets hid; a parsed document doesn't.
    ('checkVisibility' in el &&
      !el.checkVisibility({ visibilityProperty: true }))
  let isEl = (n: Node): n is Element => n.nodeType == 1
  // The text so far, in parts. Whitespace is collapsed as it arrives, so a
  // run that spans two text nodes still ends up one space, and a `pre` keeps
  // its own. Parts, not one string, so a long page costs one join.
  let parts: string[] = []
  let end = () => parts.at(-1)?.at(-1) ?? '\n'
  let put = (t: string, pre: boolean) => {
    if (!pre) t = t.replace(/\s+/g, ' ')
    if (!pre && (end() == ' ' || end() == '\n')) t = t.replace(/^ /, '')
    if (t) parts.push(t)
  }
  let line = () => {
    let last = parts.pop() ?? ''
    if (last.endsWith(' ')) last = last.slice(0, -1)
    if (last) parts.push(last)
    if (end() != '\n') parts.push('\n')
  }
  let walk = (node: Node, pre: boolean): void => {
    if (node.nodeType == 3) return put(node.textContent ?? '', pre)
    if (!isEl(node)) return
    let tag = node.tagName.toUpperCase()
    if (SKIP.test(tag) || hidden(node)) return
    let block = BLOCK.test(tag)
    if (block) line()
    for (let child of Array.from(node.childNodes)) {
      walk(child, pre || tag == 'PRE')
    }
    if (block) line()
  }
  let note = (n: number, what: string) =>
    `\n[${what} is cut here, at ${limit} of its ${n} characters.]`
  let cut = (text: string, what: string) =>
    text.length <= limit ? text : text.slice(0, limit) + note(text.length, what)
  walk(doc.body ?? doc.documentElement, false)
  let text = parts.join('').trim()
  return {
    url: doc.location?.href ?? doc.URL ?? '',
    title: (doc.title ?? '').replace(/\s+/g, ' ').trim(),
    text: cut(text, 'The text'),
    selection: cut(selected.trim(), 'The selection'),
  }
}
