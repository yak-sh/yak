# apps

The yaks apps this repository builds and keeps. Each directory holds one app's
files exactly as yaks.app serves them: `index.html`, `vocab.json`, `icon.png`,
and whatever sits beside them.

Git is an app's only source of code. A push sends a directory to its space
through the connector's own tools, the ones any assistant calls:

```sh
yak admin push apps/<name> --as admin
```

It creates the app when it does not exist yet (`app_new`), writes every file
(`app_files`), deletes each file the directory no longer has, and releases the
version (`app_deploy`). The app's slug is the directory's name unless `--app`
names another, and `--space` picks the space when the account has several.

An app kept here is never edited on the platform, since the next push would undo
the edit. Its copy is the exception. `copy.json` (@yaks/copy) is edited on the
app's page, and a push never undoes that edit. Before it writes, the push reads
the live `copy.json` and merges it into the checkout's by key: a key edited on
the page keeps the page's text, and a key new in the checkout is added. The
merged file is written into the checkout, so the page's edits show in
`git diff`. Commit them with the change you pushed.

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
