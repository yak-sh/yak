// React and React DOM for the platform's pages, as one module their import
// map names for each of `react`, `react/jsx-runtime`, `react-dom` and
// `react-dom/client` (./page-imports.ts): each page script leaves them
// unbundled, so a page fetches and runs one React however many scripts draw
// with it. React is CommonJS, whose names an ES module must say
// (./page-react_test.ts checks each specifier's are all here); a name two of
// them share is the same value in each.
import * as react from 'react'
import * as runtime from 'react/jsx-runtime'
import * as dom from 'react-dom'
import * as client from 'react-dom/client'

// Their types leave some of their names out.
let reactNamed: typeof react & Record<string, unknown> = react
let runtimeNamed: typeof runtime & Record<string, unknown> = runtime
let domNamed: typeof dom & Record<string, unknown> = dom
let clientNamed: typeof client & Record<string, unknown> = client

export let {
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  ViewTransition,
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __COMPILER_RUNTIME,
  act,
  addTransitionType,
  cache,
  cacheSignal,
  captureOwnerStack,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  unstable_useCacheRefresh,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = reactNamed

export let {
  jsx,
  jsxs,
} = runtimeNamed

export let {
  __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  browser,
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
} = domNamed

export let {
  createRoot,
  hydrateRoot,
} = clientNamed

export default react
