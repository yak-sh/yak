# apps

The yaks apps this repository builds and keeps. Each directory holds one app's
files exactly as yaks.app serves them: `index.html`, `vocab.json`, `icon.png`,
and whatever sits beside them.

The deploy catch-up publishes [registered apps](../packages/admin/service.ts)
from main when their source changes. To push a working directory manually, use
the same connector tools:

```sh
yak admin push apps/<name> --as admin
```

It creates the app when it does not exist yet (`app_new`), writes every file
(`app_files`), deletes each file the directory no longer has, and releases the
version (`app_deploy`). The app's slug is the directory's name unless `--app`
names another, and `--space` picks the space when the account has several.

A change made to an app on the platform is carried into git, never pushed over:
its space's Operator fixing it, or its `copy.json` (@yaks/copy) edited on the
app's page. A file the app holds that matches no text git has of it is such a
change. Before it writes, the push merges it over the checkout's file, against
the newest text git has that the app held too: `copy.json` by key (a key edited
on the page keeps the page's text), every other file by line. A manual push
commits local work on those paths before committing the merge. The deploy
catch-up lands its commit on main and releases the bytes it committed. Where git
and the platform changed the same source lines, the live lines win and git keeps
the previous version in history. If the app's generated `package-lock.json`
conflicts, the release compiler regenerates it from the merged `package.json`
and the push saves the new lock in git.

An app with a `package.json` of its own is formatted with the repository's
settings only when they are named: `deno fmt --config deno.json apps/<name>`.
Without `--config`, Deno takes the app's `package.json` as its configuration and
rewrites every file in its default style.

Git holds an app's code, not its pictures, fonts or sounds: `apps/.gitignore`
keeps their bytes out of history. They are released with the code all the same,
so an installed copy carries them. A push from a checkout that lacks one leaves
the copy the app holds, and the release takes it again; changing one is putting
the new bytes at its path and pushing, and removing one is an `app_files`
delete. The app's `icon.png` is kept in git like code. Keep it small.
