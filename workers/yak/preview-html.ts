// Hosted HTML is already authorized for its reader. Preserve what that
// document publishes; fill gaps without opening another file or store.
import { type Host, url } from '@yaks/platform/host'
import { APP, fields, type Preview, tag } from './link-preview.ts'
import { esc } from './escape.ts'
import { decodeHTML } from 'entities'

type Html = { html: boolean }
type End = { before(s: string, o: Html): void }
type Element = End & {
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  onEndTag(fn: (end: End) => void): void
  remove(): void
}
type Rewriter = {
  on(selector: string, handlers: {
    element?: (el: Element) => void
    text?: (text: { text: string }) => void
  }): Rewriter
  onDocument(
    handlers: { end(end: { append(s: string, o: Html): void }): void },
  ): Rewriter
  transform(page: Response): Response
}
declare let HTMLRewriter: { new (): Rewriter }

export let previewed = (
  env: Host,
  page: Response,
  at: string,
  fallback: Preview = APP,
) => {
  let held: Record<string, string> = {}
  let seen = new Set<string>()
  let title = '', sent = false, titled = false
  let base = new URL(at, url(env, '/')).href, based = false
  let absolute = (ref: string) => {
    return URL.canParse(ref, base)
      ? new URL(ref, base).href
      : url(env, '/og.png')
  }
  let missing = () => {
    if (sent) return ''
    sent = true
    let of = {
      ...fallback,
      title: held['og:title'] || decodeHTML(title).trim() || fallback.title,
      description: held['og:description'] || held.description ||
        fallback.description,
      image: (held['og:image'] || fallback.image) &&
        absolute(held['og:image'] || fallback.image!),
    }
    let all = fields(env, of)
    if (held['twitter:image']) {
      all['twitter:image'] = absolute(held['twitter:image'])
    }
    return (titled ? '' : `<title>${esc(of.title)}</title>`) +
      Object.entries(all).filter(([k]) => !seen.has(k))
        .map(([k, v]) => tag(k, v)).join('\n')
  }
  return new HTMLRewriter()
    .on('base[href]', {
      element: (el) => {
        if (based) return
        let href = decodeHTML(el.getAttribute('href') || '')
        if (URL.canParse(href, base)) base = new URL(href, base).href
        based = true
      },
    })
    .on('head', {
      element: (el) => {
        el.onEndTag((end) => {
          end.before(missing(), { html: true })
        })
      },
    })
    .on('title', {
      element: () => {
        titled = true
      },
      text: (text) => {
        title += text.text
      },
    })
    .on('meta', {
      element: (el) => {
        let name =
          (el.getAttribute('property') || el.getAttribute('name') || '')
            .toLowerCase()
        let content = decodeHTML(el.getAttribute('content') || '')
        if (!content) {
          if (
            name == 'description' || name.startsWith('og:') ||
            name.startsWith('twitter:')
          ) el.remove()
          return
        }
        if (['og:image', 'twitter:image'].includes(name)) {
          // A base may follow the image tag. Resolve once the whole head
          // has been read, then put the image back beside the other tags.
          el.remove()
        } else {
          seen.add(name)
        }
        held[name] = content
      },
    })
    .onDocument({
      end: (end) => {
        end.append(missing(), { html: true })
      },
    })
    .transform(page)
}
