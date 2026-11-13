import { equal, test } from '@yaks/testing'
import * as io from '@yaks/file/io'
import { parse } from 'smol-toml'
import { VERSION } from '@yaks/workerd'
import { methods as answered } from '@yaks/tracker/instrument'
import yak, * as entry from './index.ts'
import {
  BUILDER,
  LEXICON,
  OUTLAST,
  PUBLIC_DIRECTORY,
  PURGER,
  STORE,
  WIRE,
  WORKSPACES,
} from './facets/kernel-worker.ts'
import { Store } from './graph.ts'
import { Wire } from './stream.ts'
import { Builder } from './build.ts'
import { WorkspaceStore } from './workspaces.ts'
import { PublicDirectoryStore } from './public-directory.ts'
import { Purger } from './purge.ts'
import { Outlast } from './outlast-object.ts'
import { LexiconStore } from './lexicon.ts'

// Every method the tracker's wrap gives the class, inherited ones too.
let methods = (C: { prototype: object }) =>
  answered(C.prototype).map(([name]) => name).sort()

test('each deferred object answers every method its class has', () => {
  equal(
    [
      STORE,
      WIRE,
      BUILDER,
      WORKSPACES,
      PUBLIC_DIRECTORY,
      PURGER,
      OUTLAST,
      LEXICON,
    ]
      .map((m) => [...m].sort()),
    [
      Store,
      Wire,
      Builder,
      WorkspaceStore,
      PublicDirectoryStore,
      Purger,
      Outlast,
      LexiconStore,
    ]
      .map(methods),
  )
})

// The entry as the runtime loads it: its classes, and its default export.
type Toml = {
  durable_objects: { bindings: { class_name: string; script_name?: string }[] }
  exports: Record<string, unknown>
}
let toml = parse(
  io.readTextFileSync(new URL('./wrangler.toml', import.meta.url)),
) as Toml

test('the entry exports every class wrangler.toml binds or exports here', () => {
  let named = [
    ...toml.durable_objects.bindings.filter((b) => !b.script_name)
      .map((b) => b.class_name),
    ...Object.keys(toml.exports).filter((name) => name != 'default'),
  ]
  equal(
    named.filter((name) =>
      typeof (entry as Record<string, unknown>)[name] != 'function'
    ),
    [],
  )
})

test('the entry says its deploy, and hands every other request to the router', async () => {
  let version = await yak.fetch(
    new Request(`https://yaks.app${VERSION}`),
    { CF_VERSION_METADATA: { id: 'v1' } },
  )
  equal(await version.json(), { kernel: 'v1' })
  let door = { fetch: () => Promise.resolve(new Response('platform')) }
  let routed = await yak.fetch(
    new Request('https://yaks.app/login'),
    { SITE: door, APPS: door, ASSETS: door, IDENTITY: door },
  )
  equal(
    [await routed.text(), routed.headers.has('strict-transport-security')],
    ['platform', true],
  )
})
