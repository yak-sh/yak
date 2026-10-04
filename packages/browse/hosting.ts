// The page host declares its mount and transport. The box needs no declaration;
// an app's web door names its own address and its store's existing API wire.
export type Hosting = {
  home?: { title: string; query: string }
  page: string
  api: string
  apply: string
  owner: string
  inspect?: string
  storage?: string
}
let declared = () => (globalThis as { YAK_WEB?: Hosting }).YAK_WEB
export let hosting = (): Hosting =>
  declared() ?? {
    page: '',
    api: '',
    apply: '/web/apply',
    owner: '/web/owner',
    inspect: '/inspect',
  }
export let pagePath = (path: string): string => hosting().page + path
export let localPath = (path: string): string => {
  let mount = hosting().page
  return mount && (path == mount || path.startsWith(mount + '/'))
    ? path.slice(mount.length) || '/'
    : path
}
export let apiPath = (path: string): string => hosting().api + path
export let webOrigin = (): string =>
  declared() ? globalThis.location.origin : 'https://tasks.yak.sh'
/** Host-only operations are never inferred from app data words. */
export let door = (name: 'freeze' | 'inspect'): boolean =>
  name == 'inspect' && !!hosting().inspect

// New app mounts have no legacy browser state. Box keys stay unchanged; an
// app/account never replays another store's cached rows, drafts or writes.
export let storageKey = (key: string): string =>
  hosting().storage ? `${key}:${hosting().storage}` : key
export let scopedStorage = (store: Storage): Storage => {
  let scope = hosting().storage
  if (!scope) return store
  let prefix = `yak-web:${scope}:`
  let keys = () =>
    Array.from({ length: store.length }, (_, i) => store.key(i)!)
      .filter((key) => key.startsWith(prefix))
  return {
    get length() {
      return keys().length
    },
    key: (i) => keys()[i]?.slice(prefix.length) ?? null,
    getItem: (key) => store.getItem(prefix + key),
    setItem: (key, value) => store.setItem(prefix + key, value),
    removeItem: (key) => store.removeItem(prefix + key),
    clear: () => keys().forEach((key) => store.removeItem(key)),
  }
}
