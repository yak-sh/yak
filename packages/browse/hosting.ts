// The page host declares its mount and transport. The box needs no declaration;
// an app's web door names its own address and its store's existing API wire.
// `origin` is the address handed to a person; a browser page without one
// hands out its own location.
export type Hosting = {
  home?: { title: string; query: string }
  origin?: string
  page: string
  api: string
  apply: string
  owner: string
  storage?: string
}
let declared = () => (globalThis as { YAK_WEB?: Hosting }).YAK_WEB
export let box: Hosting = {
  origin: 'https://tasks.yak.sh',
  page: '',
  api: '',
  apply: '/web/apply',
  owner: '/web/owner',
}
export let hosting = (): Hosting => declared() ?? box
export let pagePath = (path: string): string => hosting().page + path
export let localPath = (path: string): string => {
  let mount = hosting().page
  return mount && (path == mount || path.startsWith(mount + '/'))
    ? path.slice(mount.length) || '/'
    : path
}
export let apiPath = (path: string): string => hosting().api + path
export let webOrigin = (): string =>
  hosting().origin ?? globalThis.location?.origin ?? box.origin!
/** Host-only operations are never inferred from app data words. */
export let door = (_name: 'freeze'): boolean => false

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

// Only old account-named hosted queues and the single-owner box have enough
// provenance to migrate. Leave an unscoped hosted queue untouched for recovery.
export let legacyOutboxName = (): string | undefined =>
  hosting().storage
    ? storageKey('tasks-outbox')
    : declared()
    ? undefined
    : 'tasks-outbox'

// The queue a page wrote under @yaks/sync's default scope, the API and no
// person, until T-133002. Only the single-owner box knows whose those writes
// are; a hosted mount's stay where they are, unsent and kept.
export let formerOutboxScope = (api: string): string | undefined =>
  declared() ? undefined : JSON.stringify([api, {}])
