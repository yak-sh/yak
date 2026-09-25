// The harness in a terminal, as a view: exported as `@yaks/harness/tui`, the
// views a `yak` command holds an answer with (`--tui`, @yaks/cli answer.ts).
// A session or an entry answered alone is drawn as the whole harness, selected
// on that session — what `yak session new "…" --tui` shows once the session has
// settled on its reply.
//
// It runs the harness the way the harness always ran in a terminal: the agent
// and the database in a worker (./remote.ts), drafts in a vault of their own
// (./draft_vault.ts), the app over both (./app.ts). The database is the file
// the answer came from. A first Ctrl-C waits for the worker to finish what it
// admitted, a second forces it (@yaks/tui `useShutdown`).

import { h } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { Bundle, Comp } from '@yaks/graph'
import type { ComponentRenderer } from '@yaks/preact'
import { parse } from '@yaks/query'
import { define, type Registry } from '@yaks/render'
import { useShutdown } from '@yaks/tui'
import { App } from './app.ts'
import { openDrafts } from './draft_vault.ts'
import { remote } from './remote.ts'

type Up = {
  backend: Awaited<ReturnType<typeof remote>>
  drafts: Awaited<ReturnType<typeof openDrafts>>
}

let boot = async (db: string | undefined, session: string): Promise<Up> => {
  let drafts = await openDrafts()
  let backend = await remote({ cwd: Deno.cwd(), db }).catch(async (error) => {
    await drafts.close()
    throw error
  })
  await backend.resume()
  await drafts.ui.patch({ selected: session })
  return { backend, drafts }
}

let Harness = ({ e, db }: { e: Bundle; db?: string }) => {
  let session = String((e.entry as Comp | undefined)?.session ?? e.entity.eid)
  let [up, set] = useState<Up | Error>()
  useEffect(() => {
    let booting = boot(db, session)
    booting.then(set, set)
    return () =>
      void booting.then(({ backend, drafts }) =>
        backend.close().finally(() => drafts.close())
      ).catch(() => {})
  }, [db, session])
  useShutdown(async () => {
    if (!up || up instanceof Error) return
    up.drafts.ui.patch({
      shuttingDown: true,
      error:
        'Shutting down—waiting for active operations; Ctrl+C again to force.',
    })
    await up.backend.close({ timeout: null })
  }, up && !(up instanceof Error) ? up.backend.force : undefined)
  if (up instanceof Error) return h('div', null, `harness: ${up.message}`)
  if (!up) return h('div', null, 'starting the harness…')
  return h(App, {
    agent: up.backend.agent,
    subscribe: up.backend.subscribe,
    frontend: up.drafts.ui,
  })
}

let page = (query: string): ComponentRenderer => ({
  view: 'Page',
  match: parse(query),
  Render: Harness as ComponentRenderer['Render'],
})

/** The views a terminal holds a harness answer with. */
export let views: Registry<ComponentRenderer> = define([
  page('.session'),
  page('.entry'),
])
