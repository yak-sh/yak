import { equal, test } from '@yaks/testing'
import { BUILDER, PUBLIC_DIRECTORY, STORE, WIRE, WORKSPACES } from './index.ts'
import { Store } from './graph.ts'
import { Wire } from './stream.ts'
import { Builder } from './build.ts'
import { WorkspaceStore } from './workspaces.ts'
import { PublicDirectoryStore } from './public-directory.ts'

let methods = (C: { prototype: object }) =>
  Object.getOwnPropertyNames(C.prototype).filter((name) =>
    name != 'constructor' &&
    typeof Object.getOwnPropertyDescriptor(C.prototype, name)?.value ==
      'function'
  )

test('each deferred object answers every method its class has', () => {
  equal(
    [STORE, WIRE, BUILDER, WORKSPACES, PUBLIC_DIRECTORY].map((m) => [...m]),
    [Store, Wire, Builder, WorkspaceStore, PublicDirectoryStore].map(methods),
  )
})
