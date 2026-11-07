/**
 * @yaks/admin — the owner's verbs on yaks.app, as `yak admin …`.
 *
 * Unpublished: it is this box's plugin, named in `~/.yak/yak.json` beside the
 * published ones. The platform's names and rules it shares with the kernel
 * are @yaks/platform's (`./names`, `./cookie`, `./bots`, `./budget`,
 * `./mover`), and it deploys from this checkout's `workers/yak`.
 *
 * @module
 */

export * from './api.ts'
export * from './tools.ts'
export * from './vocab.ts'
