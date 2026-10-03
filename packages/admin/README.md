# @yaks/admin

Platform operations on yaks.app, exposed as `yak admin` tools by this box's
unpublished plugin. Sign-ins belong to @yaks/connections, not to admin.

## The account an operation uses

`yak auth yaks.app` signs in. Without `--as`, an operation uses the connection
whose account matches the configured person's email, else the oldest yaks.app
connection. The default is computed, never remembered; another sign-in does not
make a throwaway replace the person's account.

```sh
yak auth yaks.app
yak admin fee
yak admin query yourname/vale '.doc' --as admin@bot.yak.sh
yak admin upload probe/notes ./attachment.pdf --as probe
```

`--as` accepts the full account address or an unambiguous local part. Admin has
no account list, login, logout, use, whoami or generic tool verb, and no
`--owner` or `--admin` flags. Connector and app commands use the CLI's ordinary
command path with the same optional `--as`.

Store queries, writes, uploads, fee, client, tunnel and migration requests send
the chosen connection's bearer. The platform checks that account's existing
permissions. Infrastructure operations (`deploys`, `errors`, `tail`, `rollback`,
`revert`) use this box's Cloudflare/GitHub credentials and require the selected
account to be the platform admin or the configured person's own email. `errors`
also needs the Sentry API credential in this graph's vault.

## A throwaway without a browser

`throwaway` creates a random `@bot.yak.sh` address, or uses the name supplied,
and calls the same OAuth authorization as `yak auth`. Its sign-in code arrives
in this graph's mail. It never reads terminal input or stores a separate cookie
secret.

```sh
yak admin throwaway reviewer
yak admin query reviewer/notes '.doc' --as reviewer
```

Name the throwaway with `--as` for probes; a new sign-in is not a stored
selection.

## Browser-only operations

The code sign-in retains `website_session` inside the connection's private OAuth
record. Normal browser OAuth returns no website session. `delete`, `accept` and
`link` require that retained session and explain its absence rather than trying
to turn an OAuth bearer into browser authority.

```sh
yak auth yaks.app --as reviewer@bot.yak.sh
yak admin accept E-123 --as reviewer
yak admin link --days 90 --as reviewer
yak admin delete reviewer --as reviewer
```

The website's renewed cookie is written back under the same OAuth record's vault
lock. Neither the bearer nor the cookie is included in graph text or tool
answers. `delete` reads the website's list of what would be destroyed before
submitting the space's name back to its deletion form.

## Facets

- `./vocab` declares the admin tools, no components.
- `./tools` implements those tools over the host's graph, config and vault.
- The root exports the platform API helpers, tools and vocabulary.
