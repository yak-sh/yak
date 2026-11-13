/** Markdown as structural nodes, never generated HTML or terminal escapes.
 * Uses the same GFM parser/version as the older canvas markdown renderer.
 */
import { Marked, type Token, type Tokens } from 'marked'
import { HUMAN, short, WRITTEN } from '@yaks/id'
import type { Child, H } from '@yaks/render'

export { type Token } from 'marked'

/** Where an entity id named in prose leads: an href for a reader who can open
 * the entity, or nothing, and then the id stays words. The host gives it, since
 * only the host knows its routes and its reader. It is asked for an id written
 * bare (T-123, #a1b2c3, a 40- or 64-hex SHA), for a link written to one
 * ([the plan](T-123)), and for a code span holding a hex word, the way a commit
 * is quoted (`1a2b3c4`), where a bare word like "decafed" never is. An eid
 * (a UUID) is asked about as it is drawn ({@link Ids}), so a link never
 * carries a whole uuid. */
export type Refs = (id: string) => string | undefined

/** What an entity is called where prose holds its eid: its id (`P-1`) when
 * the host has it at hand, from an entity it has already read or a series it
 * keeps in memory, or nothing, and then the eid is drawn as its short handle
 * (`#a3f19c024b`). The host never reads an entity only to answer this. */
export type Ids = (eid: string) => string | undefined

// An id is a word of its own: a T-123 at a boundary, whatever its letter (the
// number names the entity), a #hex short id, a UUID or a whole SHA. UTF-8 and
// SHA-256 stay words because their letters sit mid-word.
let UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
let ID = `${WRITTEN}|#[0-9a-fA-F]{6,64}|${UUID}|[0-9a-f]{64}|[0-9a-f]{40}`
let START = new RegExp(`(?<![\\w#-])(?:${ID})(?![\\w-])`)
let REF = new RegExp(`^(?:${ID})(?![\\w-])`)
let NAMED = new RegExp(
  `^(?:#[0-9a-fA-F]{6,64}|${UUID}|[0-9a-f]{40}|[0-9a-f]{64})$`,
)
let HEX = /^[0-9a-f]{7,64}$/i
let EID = new RegExp(`^${UUID}$`, 'i')
let EIDS = new RegExp(UUID, 'i')

/** Whether a link's target is an entity id rather than an address. */
export let named = (href: string): boolean =>
  HUMAN.test(href) || NAMED.test(href)

/** An id as prose draws it: an eid as the host calls it ({@link Ids}), or its
 * short handle; any other id as written. */
export let shown = (id: string, ids?: Ids): string =>
  EID.test(id) ? ids?.(id.toLowerCase()) ?? short(id) : id

let lexer = new Marked({
  gfm: true,
  extensions: [{
    name: 'ref',
    level: 'inline',
    start: (src: string) => src.match(START)?.index,
    // `start` is asked about the text after a line's first character, so it
    // cannot see that character: the token before says what the id follows,
    // and one glued to a word (`xT-12`) is no id.
    tokenizer: (src: string, before: Token[]) => {
      if (/[\w#-]$/.test(before.at(-1)?.raw ?? '')) return undefined
      let m = REF.exec(src)
      return m ? { type: 'ref', raw: m[0], text: m[0], id: m[0] } : undefined
    },
  }],
})

/** Parse GFM. `breaks` turns a single newline into a line break, which is what
 * a chat message or a terminal line wants and what a document does not: prose
 * wrapped at 80 columns would keep every one of those wraps. An entity id in
 * the prose is a `ref` token of its own; code keeps its ids literal. */
export let parse = (
  source: string,
  { breaks = true }: { breaks?: boolean } = {},
): Token[] => lexer.lexer(source, { ...lexer.defaults, breaks })

/** Parse a line of GFM, such as a label or a title: its inline markup only,
 * with no paragraph around it. */
export let parseInline = (source: string): Token[] =>
  lexer.Lexer.lexInline(source, lexer.defaults)

/** Something a document points at: an entity, by the id it was written as,
 * or an address. */
export type Mention =
  | { kind: 'entity'; id: string }
  | { kind: 'link'; href: string }

/** What a document points at, in reading order, read the way it is drawn: an
 * id written bare, a link written to an id, and a hex word quoted in code
 * (which the host may know as a commit) are entities; any other link or image
 * is its address, unless the renderer would refuse it or it carries a quote
 * or a backslash, the debris of prose around a bare URL. Code keeps its ids
 * literal. */
export let mentions = (tokens: Token[]): Mention[] => {
  let out: Mention[] = []
  lexer.walkTokens(tokens, (t) => {
    if (t.type == 'ref') {
      out.push({ kind: 'entity', id: String((t as Tokens.Generic).id) })
    } else if (t.type == 'codespan' && HEX.test((t as Tokens.Codespan).text)) {
      out.push({ kind: 'entity', id: (t as Tokens.Codespan).text })
    } else if (t.type == 'link' || t.type == 'image') {
      let href = (t as Tokens.Link).href.trim()
      if (named(href)) out.push({ kind: 'entity', id: href })
      else if (href && !/["'\\]/.test(href) && safeHref(href) != null) {
        out.push({ kind: 'link', href })
      }
    }
  })
  return out
}

/** Prose as its reader reads it, still as text: each eid it holds, written
 * bare or as a link's target, drawn as {@link shown} draws it, so a model or a
 * printout never reads a whole uuid. Code keeps its ids literal, and a link
 * keeps its own words. What the renderer does to the same text, for a reader
 * of text rather than nodes. */
export let drawn = (source: string, ids?: Ids): string => {
  if (!EIDS.test(source)) return source
  // Marked keeps no offsets, but every leaf's raw text stands in the source
  // in reading order, so each is found from where the last one ended.
  let edits: [number, number, string][] = []
  let at = 0
  let found = (raw: string) => {
    let i = source.indexOf(raw, at)
    return i < 0 ? undefined : i
  }
  lexer.walkTokens(parse(source, { breaks: false }), (t) => {
    if (t.type == 'code' || t.type == 'codespan') {
      let i = found(t.raw)
      if (i != null) at = i + t.raw.length
    } else if (t.type == 'ref' && EID.test(t.raw)) {
      let i = found(t.raw)
      if (i == null) return
      edits.push([i, i + t.raw.length, shown(t.raw, ids)])
      at = i + t.raw.length
    } else if (t.type == 'link' && EID.test((t as Tokens.Link).href)) {
      let { href } = t as Tokens.Link
      let i = found(t.raw)
      if (i == null) return
      let j = i + t.raw.lastIndexOf(href)
      edits.push([j, j + href.length, shown(href, ids)])
      // The link's words come next, and may hold ids of their own.
      at = i + 1
    }
  })
  return edits.sort((a, b) => b[0] - a[0]).reduce(
    (text, [from, to, word]) => text.slice(0, from) + word + text.slice(to),
    source,
  )
}

/** The words a heading is made of, with the markup dropped: a reader sees
 * these words, so the anchor is named after them. */
let words = (tokens: Token[]): string =>
  tokens.map((t) => {
    let inner = (t as { tokens?: Token[] }).tokens
    return inner ? words(inner) : (t as { text?: string }).text ?? ''
  }).join('')

/** A document's anchor names, handed out in reading order: lowercase words
 * joined by hyphens, everything that is not a letter or a number dropped — so
 * a name can never carry a quote or an angle bracket into an attribute — and
 * a number on any name the document says twice. */
export let slugs = (): (text: string) => string => {
  let seen = new Map<string, number>()
  return (text) => {
    let base = text.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').trim()
      .replace(/\s+/g, '-') || 'section'
    let n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n > 1 ? `${base}-${n}` : base
  }
}

/** Every heading of a document in reading order, each under the id `render`
 * gives it — which is how a contents list links what is on the page without
 * drawing the page a second time. */
export let headings = (
  tokens: Token[],
): { depth: number; text: string; id: string }[] => {
  let name = slugs()
  let found = (
    items: Token[],
  ): { depth: number; text: string; id: string }[] =>
    items.flatMap((t) => {
      if (t.type == 'heading') {
        let text = words((t as Tokens.Heading).tokens)
        return [{ depth: (t as Tokens.Heading).depth, text, id: name(text) }]
      }
      let inner = (t as { tokens?: Token[] }).tokens
      return inner ? found(inner) : []
    })
  return found(tokens)
}

/** Only navigable links: no scripting, data, or control-byte URL schemes. */
export let safeHref = (href: string): string | undefined => {
  if ([...href].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) == 127)) {
    return undefined
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^(https?:|mailto:)/i.test(href)) {
    return undefined
  }
  return href
}

let parts: Record<string, string> = {
  p: 'Paragraph',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
  strong: 'Strong',
  em: 'Emphasis',
  del: 'Deleted',
  code: 'Code',
  pre: 'Source',
  br: 'Break',
  hr: 'Rule',
  blockquote: 'Quote',
  ol: 'Ordered',
  ul: 'Unordered',
  li: 'Item',
  a: 'Link',
  table: 'Table',
  thead: 'Head',
  tbody: 'Rows',
  tr: 'Row',
  th: 'HeadingCell',
  td: 'Cell',
}

let bodyClass = (tag: string) =>
  `Body_${parts[tag]}` +
  (/^h[1-6]$/.test(tag) ? ` Body_Heading-${tag.slice(1)}` : '')

/** What a host gives the renderer: where an entity id leads (`Refs`), what an
 * eid is called (`Ids`), and how a fenced block's code is coloured, as runs of
 * text each with its classes. */
export type Options = {
  refs?: Refs
  ids?: Ids
  code?: (text: string, language?: string) => Run[]
  /** Links, images and ids drawn as their words, for a line that is itself
   * the thing pressed, such as a title. */
  flat?: boolean
}

/** A run of code text and the classes it is coloured with. */
export type Run = { text: string; classes: string[] }

/** The parsed tree's blocks through any @yaks/render host (including
 * Preact), for a caller that holds them in an element of its own, such as a
 * page's `Body`. HTML tokens remain text. Images are descriptive links, never
 * remote fetches.
 */
export let blocks = <Node>(
  tokens: Token[],
  host: H<Node>,
  { refs, ids, code, flat }: Options = {},
): Child<Node>[] => {
  let name = slugs()
  // An id the host can open is an anchor carrying the id, so a host can give
  // it its own click; one it cannot open is the words it was written as. An
  // eid is drawn short, and leads where its short form does.
  let ref = (id: string, ...words: Child<Node>[]): Child<Node>[] => {
    let href = flat ? undefined : refs?.(shown(id, ids))
    let link = href == null ? undefined : safeHref(href)
    return link == null ? words : [
      element(
        'a',
        { href: link, 'data-ref': id, class: 'Body_Ref' },
        ...words,
      ),
    ]
  }
  let element = (
    tag: string,
    props: Record<string, unknown> | null,
    ...children: Child<Node>[]
  ) => {
    return host(tag, {
      ...props,
      class: [
        bodyClass(tag),
        props?.class,
      ].filter(Boolean).join(' '),
    }, ...children)
  }
  let children = (items: Token[]): Child<Node>[] => items.flatMap(token)
  let token = (t: Token): Child<Node>[] => {
    switch (t.type) {
      case 'space':
        return []
      case 'paragraph':
        return [element('p', null, ...children((t as Tokens.Paragraph).tokens))]
      case 'heading': {
        let v = t as Tokens.Heading
        // The id is the anchor a contents list points at (`headings` hands
        // out the same names in the same order), so every consumer of a
        // document gets headings it can link to.
        let at = { id: name(words(v.tokens)) }
        return [element('h' + v.depth, at, ...children(v.tokens))]
      }
      case 'strong':
        return [
          element('strong', null, ...children((t as Tokens.Strong).tokens)),
        ]
      case 'em':
        return [element('em', null, ...children((t as Tokens.Em).tokens))]
      case 'del':
        return [element('del', null, ...children((t as Tokens.Del).tokens))]
      case 'codespan': {
        let { text } = t as Tokens.Codespan
        let quoted = element('code', null, text)
        return HEX.test(text) ? ref(text, quoted) : [quoted]
      }
      case 'ref': {
        let id = String((t as Tokens.Generic).id)
        return ref(id, shown(id, ids))
      }
      case 'code': {
        let v = t as Tokens.Code
        let lang = v.lang?.split(/\s/)[0] || undefined
        let runs = code?.(v.text, lang)
        return [
          element(
            'pre',
            null,
            element(
              'code',
              { class: lang ? 'language-' + lang : undefined },
              ...runs
                ? runs.map((r) =>
                  r.classes.length
                    ? host('span', { class: r.classes.join(' ') }, r.text)
                    : r.text
                )
                : [v.text],
            ),
          ),
        ]
      }
      case 'br':
        return [element('br', null)]
      case 'hr':
        return [element('hr', null)]
      case 'blockquote':
        return [
          element(
            'blockquote',
            null,
            ...children((t as Tokens.Blockquote).tokens),
          ),
        ]
      case 'list': {
        let v = t as Tokens.List
        return [
          element(
            v.ordered ? 'ol' : 'ul',
            { start: v.ordered ? v.start : undefined },
            ...v.items.map((item, i) =>
              element(
                'li',
                {
                  'data-marker': v.ordered
                    ? String(Number(v.start) + i) + '. '
                    : '• ',
                },
                item.task ? (item.checked ? '[x] ' : '[ ] ') : '',
                ...children(item.tokens),
              )
            ),
          ),
        ]
      }
      case 'link': {
        let v = t as Tokens.Link
        if (named(v.href)) return ref(v.href, ...children(v.tokens))
        if (flat) return children(v.tokens)
        return [
          element(
            'a',
            { href: safeHref(v.href), title: v.title },
            ...children(v.tokens),
          ),
        ]
      }
      case 'image': {
        let v = t as Tokens.Image
        if (flat) return [v.text]
        return [
          element(
            'a',
            { href: safeHref(v.href), title: v.title },
            v.text || '[image]',
          ),
        ]
      }
      case 'table': {
        let v = t as Tokens.Table
        return [
          element(
            'table',
            null,
            element(
              'thead',
              null,
              element(
                'tr',
                null,
                ...v.header.map((cell, col) =>
                  element(
                    'th',
                    { align: v.align[col] ?? undefined },
                    ...children(cell.tokens),
                  )
                ),
              ),
            ),
            element(
              'tbody',
              null,
              ...v.rows.map((row) =>
                element(
                  'tr',
                  null,
                  ...row.map((cell, col) =>
                    element(
                      'td',
                      { align: v.align[col] ?? undefined },
                      ...children(cell.tokens),
                    )
                  ),
                )
              ),
            ),
          ),
        ]
      }
      case 'text': {
        // A soft line break, kept as a newline when `breaks` is off, is a
        // space in Markdown. Left as a newline, a terminal would break the
        // line there, and a renderer that joins wrapped rows would run its
        // two words together.
        let v = t as Tokens.Text
        return v.tokens ? children(v.tokens) : [v.text.replace(/ *\n */g, ' ')]
      }
      case 'escape':
        return [(t as Tokens.Escape).text]
      case 'html': {
        // Markup is text here, never markup. A comment is not even that: it
        // is the author writing to whoever opens the file, which every other
        // renderer drops and this one used to paint as words on the page.
        let { text } = t as Tokens.HTML
        return /^\s*<!--[\s\S]*-->\s*$/.test(text) ? [] : [text]
      }
      default:
        return [t.raw]
    }
  }
  return children(tokens)
}

/** Render the parsed tree through any @yaks/render host: its blocks, in the
 * document's own element. */
export let render = <Node>(
  tokens: Token[],
  host: H<Node>,
  options?: Options,
): Node =>
  host(
    'div',
    { class: 'Markdown', wrap: '1' },
    ...blocks(tokens, host, options),
  )
