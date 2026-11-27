/**
 * The day's lines of a space's Updates shown in place of the chat
 * (./talk-views.ts), drawn in the browser (./updates-day.ts): the last day's
 * visits to the person's apps, from the page graph's `dayVisits` and the
 * side's apps, and, in their own space, the friends on yaks.app now, from
 * their friends' rows. Each is read only once the view holding it first
 * shows, then kept current.
 *
 * The slot is `[data-updates-day]`, saying what it draws for (`Day`).
 *
 * @module
 */
import { renderToStaticMarkup as renderToString } from 'react-dom/server'
import { createElement as h, Fragment } from 'react'
import type { Client, Watch } from '@yaks/client'
import { leaving, PAGE } from '@yaks/ui/navigate'
import { accountWords, FRIENDS, friendsOf } from './account-rows.ts'
import { appsOf, sideApps, sideWords } from './side-rows.ts'
import { dayOf, dayVisits, visitWords } from './visit-counts.ts'
import { DAY, type Day, dayCards, dayLine, friendsLine } from './updates-day.ts'
import { VIEW, VIEWED } from './talk-views.ts'
import { pageGraph } from './page-graph.ts'

/** Draw the day's lines in the slot `root` from `graph`, once the view
 * holding it shows; the answer lets go. */
export let bindDay = (
  root: HTMLElement,
  graph: Pick<Client, 'watch'>,
): () => void => {
  let { space, friends } = JSON.parse(root.getAttribute(DAY)!) as Day
  let view = root.closest<HTMLElement>(`[${VIEW}]`)
  let watched: Watch[] = []
  let start = () => {
    if (watched.length || view?.hidden) return
    view?.removeEventListener(VIEWED, start)
    let apps = graph.watch(sideApps(space))
    let day = graph.watch(dayVisits(space))
    let mates = friends ? graph.watch(FRIENDS) : undefined
    watched = [apps, day, ...mates ? [mates] : []]
    let drawn = ''
    let draw = () => {
      let said = renderToString(h(
        Fragment,
        null,
        dayCards(
          day.ready
            ? dayLine(appsOf(apps.value, space), dayOf(day.value, space))
            : '',
          mates?.ready ? friendsLine(friendsOf(mates.value)) : '',
        ),
      ))
      if (said != drawn) root.innerHTML = drawn = said
    }
    for (let w of watched) w.subscribe(draw)
    draw()
  }
  view?.addEventListener(VIEWED, start)
  start()
  return () => {
    view?.removeEventListener(VIEWED, start)
    for (let w of watched) w.close()
  }
}

let begin = (doc: Document = document) => {
  let bound = new Set<Element>()
  let each = () => {
    for (let root of doc.querySelectorAll<HTMLElement>(`[${DAY}]`)) {
      if (bound.has(root)) continue
      bound.add(root)
      let { person } = JSON.parse(root.getAttribute(DAY)!) as Day
      let stop = bindDay(
        root,
        pageGraph([sideWords, visitWords, accountWords], person),
      )
      leaving(doc).addEventListener('abort', () => {
        bound.delete(root)
        stop()
      }, { once: true })
    }
  }
  each()
  doc.addEventListener(PAGE, each)
}

if (typeof document != 'undefined') begin()
