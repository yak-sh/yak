# apps

The yaks apps this repository builds and keeps. Each directory holds one app's
files exactly as yaks.app serves them: `index.html`, `vocab.json`, `icon.png`,
and whatever sits beside them.

Git is an app's only source. A push sends a directory to its space through the
connector's own tools, the ones any assistant calls:

```sh
yak admin push apps/<name> --owner
```

It creates the app when it does not exist yet (`app_new`), writes every file
(`app_files`), deletes each file the directory no longer has, and releases the
version (`app_deploy`). The app's slug is the directory's name unless `--app`
names another, and `--space` picks the space when the account has several.

An app kept here is never edited on the platform: the next push would undo the
edit.
