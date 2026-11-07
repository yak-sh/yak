/** `yak open`: a kit-built yaks app in this terminal. The app's view is
 * loaded from the app (@yaks/native/remote, as the iOS shell loads it),
 * rendered into @yaks/tui's in-memory DOM and painted by its painter, over
 * the app's own store on yaks.app. Tab walks its controls, a field takes what
 * is typed, Enter and Space press, as @yaks/tui/interaction does for any
 * page; `q` outside a field quits. */
import * as preact from 'preact'
import * as hooks from 'preact/hooks'
import * as ui from '@yaks/ui'
import { h } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'
import { quit, run, Scroll, type TElement, useKeys } from '@yaks/tui'
import { interaction } from '@yaks/tui/interaction'
import { composition, sheet } from '@yaks/ui'
import {
  type Carried,
  nativeOf,
  type NativeView,
  type Store,
  store,
  viewAt,
} from '@yaks/native/remote'

/** What a view loaded into this process imports its platform packages as:
 * the copies @yaks/tui renders by. */
export let carried: Carried = {
  preact,
  'preact/hooks': hooks,
  '@yaks/ui': ui,
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
  let view = await viewAt(at, carried, go)
  await run(() => h(Kit, { view, store: store(api, go) }), {
    sheet: sheet(composition),
  })
}
