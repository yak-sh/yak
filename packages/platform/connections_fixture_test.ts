import { createElement as h } from 'react'
import { renderToString } from 'preact-render-to-string'
import { parseHTML } from 'linkedom'
import type { Connections, Face, Offered, Shown } from './connections-page.ts'
import { type ConnectionsView, connectionsView } from './connections-view.ts'

export let SPACE = 'space-1'
export let ADA = 'person-1'

export let face = (name: string, title = name): Face => ({
  name,
  title,
  tagline: '',
  site: '',
  logo: '',
  image: '',
  instructions: '',
  theirs: false,
  fields: [{ name: 'key', label: 'Key' }],
})

/** A connection through `name`, connected unless `status` says. */
export let shown = (
  name: string,
  status: Shown['status'] = 'connected',
): Shown => ({
  eid: `c-${name}`,
  integration: name,
  face: face(name),
  own: false,
  each: false,
  status,
  account: '',
  title: '',
  keyed: true,
  hosts: [`api.${name}.test`],
  about: null,
  listed: false,
  scopes: [],
  lacking: [],
  apps: [],
  binding: name.toUpperCase(),
  available: [],
  saving: '',
  instructions: '',
  failed: '',
})

export let offered = (name: string): Offered => ({
  name,
  keyed: true,
  face: face(name),
})

/** A page holding the weather connection and offering cal. */
export let connections = (over: Partial<Connections> = {}): Connections => ({
  on: true,
  list: [shown('weather')],
  services: [],
  built: [offered('cal')],
  borrowed: [],
  ...over,
})

export let connectionsViewOf = (ask = ''): ConnectionsView => ({
  person: ADA,
  space: { eid: SPACE, slug: 'ada' },
  env: { APEX: 'yaks.test' },
  spaces: [],
  ask,
})

/** The page as the server draws it, in a document of its own. */
export let page = (view = connectionsViewOf(), c = connections()) => {
  let html = renderToString(
    h(
      'div',
      {
        'data-view': 'connections',
        'data-connections-view': JSON.stringify(view),
      },
      connectionsView(view, c),
    ),
  )
  let { document } = parseHTML(`<html><body>${html}</body></html>`)
  return document.querySelector<HTMLElement>('[data-view]')!
}
