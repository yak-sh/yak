# home

yaks.app's own pages: the home page and its variants, pricing, help and the
legal pages, as the `home` app in the `yak` space. The apex answers each from
here (workers/yak site.ts `HOME`), as an app answers at a custom domain's root,
so they wear the platform's scripts and the words of this release's `copy.json`.

The pages are drawn from workers/yak/site/*.tsx with @yaks/ui's parts.
`deno task content` writes them here (workers/yak/site/mod.ts `written`); commit
them with the change that drew them. `copy.json` is their words, edited on the
page or here, and never written by that step.

The box's deploy catch-up releases them once the commit that changed them is
live (packages/admin README, "The deploy catch-up"), as

```sh
yak admin push apps/home --space yak --as admin@bot.yak.sh
```

does by hand. Until the app holds a page, and whenever it can't answer one, the
Worker's own copy of it answers instead.
