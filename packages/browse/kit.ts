/** `yak open`: a kit-built yaks app in this terminal. The app's view is
 * loaded from the app (@yaks/native/remote, as the iOS shell loads it),
 * rendered into @yaks/tui's in-memory DOM and painted by its painter, over
 * the app's own store on yaks.app. Tab walks its controls, a field takes what
 * is typed, Enter and Space press, as @yaks/tui/interaction does for any
 * page; `q` outside a field quits. */
import * as preact from 'preact'
import * as hooks from 'preact/hooks'
import * as compat from 'preact/compat'
import * as compatJsx from 'preact/jsx-runtime'
import * as compatClient from 'preact/compat/client'
import { draw as drawPreact } from '@yaks/preact/draw'
import { bundle } from '@yaks/cli/page'
import { aliases } from '@yaks/preact/renderer'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import * as ui from '@yaks/ui'
import { createElement as h, useLayoutEffect, useRef } from 'react'
import { quit, run, Scroll, type TElement, useKeys } from '@yaks/tui'
import { interaction } from '@yaks/tui/interaction'
import { composition, sheet } from '@yaks/ui'
import {
  type Carried,
  nativeOf,
  type NativeView,
  prepareView,
  type Store,
  store,
} from '@yaks/native/remote'

/** What a view loaded into this process imports its platform packages as:
 * the copies @yaks/tui renders by. */
export let carried: Carried = {
  preact,
  'preact/hooks': hooks,
  react,
  'react/jsx-runtime': jsx,
  '@yaks/ui': ui,
}

let legacy = async (): Promise<Carried> => {
  let kits = {
    preact,
    'preact/hooks': hooks,
    'preact/compat': compat,
    'preact/compat/client': compatClient,
    'preact/jsx-runtime': compatJsx,
  }
  let code = await bundle(new URL(import.meta.resolve('@yaks/ui')), undefined, {
    alias: aliases,
    external: Object.keys(kits),
    format: 'cjs',
  })
  let module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (name: keyof typeof kits) => kits[name],
    module,
    module.exports,
  )
  return {
    ...kits,
    react: compat,
    'react/jsx-runtime': compatJsx,
    '@yaks/ui': module.exports,
  }
}

let legacyKits: Promise<Carried> | undefined
export let appAt = async (
  at: string,
  go: typeof fetch,
): Promise<NativeView> => {
  let app = await prepareView(at, go)
  if (
    !app.imports.some((name) => name == 'preact' || name.startsWith('preact/'))
  ) {
    return app.open(carried)
  }
  let View = app.open(
    await (legacyKits ??= legacy().catch((error) => {
      legacyKits = undefined
      throw error
    })),
  )
  return ({ store }) => {
    let root = useRef<HTMLDivElement>(null)
    useLayoutEffect(() =>
      drawPreact(
        preact.h(View as unknown as preact.ComponentType<{ store: Store }>, {
          store,
        }),
        root.current!,
      ), [store])
    return h('div', { ref: root })
  }
}

/** The app's view over its store, its controls walked by the keyboard, the
 * first field in focus. */
export let Kit = ({ view, store }: { view: NativeView; store: Store }) => {
  let at = useRef<TElement>(null)
  let keys = useRef<ReturnType<typeof interaction> | null>(null)
  useLayoutEffect(() => {
    let root = at.current!
    keys.current = interaction(root, () => {})
    let field = root.querySelector('input,textarea')
    if (field) keys.current.focus(field)
  }, [])
  useKeys((k) => {
    let typing = keys.current?.active()?.matches('input,textarea')
    if (!typing && k.name == 'char' && k.text == 'q' && !k.ctrl && !k.alt) {
      quit()
      return true
    }
    return keys.current?.press(k) ?? false
  })
  return h(
    Scroll,
    { id: 'kit', follow: false, keyboard: false, grow: '1' },
    h('div', { ref: at }, h(view, { store })),
  )
}

/** Open the app at `page` (`https://yourname.yaks.app/packing/`), its store
 * at `api`, every request through `go`, until the person quits. */
export let open = async (
  page: string,
  api: string,
  go: typeof fetch = fetch,
): Promise<void> => {
  let at = await nativeOf(page, go)
  if (!at) {
    throw new Error(
      `${page} is not built on the kits: its page names no native view`,
    )
  }
  let view = await appAt(at, go)
  await run(() => h(Kit, { view, store: store(api, go) }), {
    sheet: sheet(composition),
  })
}
