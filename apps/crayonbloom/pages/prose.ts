/** A page that is read: an article, a policy, an answer. Its words are kept
 * as written (public/), a title and a description over the HTML of what it
 * says, and are drawn as a `Body` in a reading column. */
import { h } from 'preact'
import { Body } from '@yaks/ui/parts'
import { Desk } from '../look/parts/Desk.ts'
import { answered, type Place } from './frame.ts'

/** A kept page, read apart: what a browser's tab and a search result say,
 * and its HTML. */
export let written = (text: string) => {
  let said = (pattern: RegExp) =>
    (text.match(pattern)?.[1] ?? '').replaceAll('&amp;', '&')
      .replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll(
        '&gt;',
        '>',
      )
  return {
    title: said(/<title>([\s\S]*?)<\/title>/),
    description: said(/<meta\s+name="description"\s+content="([^"]*)"/),
    html: text.replace(/^<title>[\s\S]*?<\/title>\s*(<meta[^>]*>\s*)?/, ''),
  }
}

/** The kept page at `text`, answered, its links under `place`. */
export let prose = (place: Place, text: string): Response => {
  let { title, description, html } = written(text)
  return answered({
    place,
    title,
    description,
    children: h(
      Desk,
      { mod: 'read', id: 'main' },
      h(Body, {
        as: 'article',
        dangerouslySetInnerHTML: {
          __html: html.replace(
            /\b(href|src)="\/(?!\/)/g,
            (_, name) => `${name}="${place.at('/')}`,
          ),
        },
      }),
    ),
  })
}
