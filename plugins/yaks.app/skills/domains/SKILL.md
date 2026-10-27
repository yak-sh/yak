---
name: domains
description: 'Custom Domains (yaks.app). Serving a space or one of its apps at a domain the person already owns: domain_attach, domain_status and domain_detach, the CNAME and ownership TXT DNS records and where to add them at GoDaddy, Namecheap, Squarespace and the other registrars, apex domains and the three ways to serve one, what each provisioning status means, the HTTPS certificate, and why a domain stays pending.'
---

# Custom Domains

A space is served at `<space>.yaks.app` and each of its apps at
`<space>.yaks.app/<app>/`. Either can also be served at a domain the person
already owns, such as `example.com` or `www.example.com`, and the `.yaks.app`
address keeps working.

A domain can be attached in two ways, depending on what you name:

- **The space.** `ourbookclub.com` serves the space exactly as
  `yourname.yaks.app` does: the front page at `/`, every app at `/<app>/`. Each
  app is a path under the domain.
- **One app.** `example.com` serves that app at its root, and nothing else.

A space can have both at once, and an app in it can still have a domain of its
own: at the app's domain the app is served at the root, and at the space's
domain it is served at `/<app>/`.

A domain is attached to the space or the app itself, never to the `.yaks.app`
address it currently has. So when `space_set(slug)` or `app_set(app, slug)`
moves the `.yaks.app` address, the domain keeps serving exactly what it served
before, with nothing to re-attach and no DNS to change
(<https://yaks.app/docs/home.md>).

This page is written for you, the assistant. The person you are helping owns a
domain and probably bought it years ago from GoDaddy, Namecheap or Squarespace.
They do not know what a CNAME is, and they should not need to. You already know
what those registrars' control panels look like. Attach the domain with
`domain_attach`, then guide them through their registrar's DNS settings in plain
language, or make the changes yourself if you have access to them.

Back to the map: <https://yaks.app/docs.md>

## Plan requirement

Custom domains require the Plus plan (or a space that is explicitly exempt). If
the space is not eligible, `domain_attach` returns a message carrying the
space's plan-settings link, and provisions no hostname. Give the person that
link to compare paid plans; never link directly to checkout. The link is their
space's `https://yaks.app/manage/billing?space=<space>` page. If they need to
sign in, the normal sign-in flow returns them to that page. The sign-in email
already offers a single-use link; do not create or expose a login token in the
conversation.

Wait for the plan change before continuing with DNS setup. Keep using the
existing `.yaks.app` address in the meantime.

## Tools: `domain_attach`, `domain_status`, `domain_detach`

- `domain_attach(app?, hostname)` — provisions the hostname and returns the
  CNAME and ownership TXT record to add, with each record's full name and exact
  value. With `app`, the domain is attached to that app; without it, to the
  space. Only the space owner may attach a domain.
- `domain_status(hostname?)` — reports what each domain points at and how far
  provisioning has progressed, as the four steps that can be outstanding
  (described below). Omit `hostname` to list every domain in the space.
- `domain_detach(hostname)` — releases the hostname. What it served is
  unchanged: same data, same files, same `<space>.yaks.app` address.

A domain points at one space or app, and a hostname can be attached to only one
place on the whole platform. `www.example.com` and `example.com` are two
hostnames, so attach both if the person wants both.

## DNS records: CNAME and ownership TXT

The **CNAME** directs traffic to yaks.app:

    CNAME   example.com   →   origin.saas.yaks.app

The **ownership TXT record** proves control of this hostname's DNS. Its name is
`_cf-custom-hostname.<hostname>` and its value is a token unique to this
attachment. Copy the exact name and value from `domain_attach` or
`domain_status`; a token from an earlier attachment does not verify this one.

Add both records where the domain's DNS is managed. For `www.example.com`, a
panel that appends `example.com` needs `www` for the CNAME and
`_cf-custom-hostname.www` for the TXT record. The TXT record's name is separate
from the CNAME's, so they can coexist.

The domain serves the space or app only after the TXT record is verified,
Cloudflare accepts the hostname, and its certificate is ready. A CNAME already
pointing here proves where traffic goes, not who owns the hostname. Existing
active hostnames keep serving. After ownership is verified, the TXT record can
be removed; keep the CNAME for as long as the domain should serve here.

## Adding the records at each registrar

The mistake people make at half of these registrars: **the Name/Host field is a
prefix, and the panel appends the domain itself.** Typing `www.example.com`
there produces `www.example.com.example.com`. When in doubt, type `www`, and
check the record's full name after saving.

**GoDaddy** — Domain Portfolio → the domain → **DNS** → **Add New Record**.
Fields are Type, Name, Value, TTL. Name is the prefix (`www`), not the whole
hostname. GoDaddy has no apex option at all: see "Apex domains" below.

**Namecheap** — Domain List → **Manage** → **Advanced DNS** → Host Records →
**Add New Record**. Fields are Type, Host, Value, TTL. Host is a prefix and
Namecheap appends the domain, so `www`, never `www.example.com`. Namecheap
refuses a CNAME at `@`; it offers a URL Redirect record instead, which is the
`www` approach below.

**Squarespace** (Google Domains was migrated to Squarespace; the migration is
complete, and the panel is Squarespace's) — account.squarespace.com/domains →
the domain → **DNS** → **Custom Records** → **Add Record**. Fields are Type,
Name, Priority, TTL, Data; the target goes in **Data**. Name is a prefix and
Squarespace appends the domain. Squarespace has no apex record at all.

**Wix** — Domains → the domain's **Domain Actions** → **Manage DNS records**.
Wix's own instruction: where another vendor tells you to put `@` in Host Name,
**leave Host Name blank instead**.

**Hover** — the domain's **Overview** → **DNS** → **Add a record**. Fields are
Type, Hostname, Target Name. Hover states that it cannot hold a CNAME on the
root domain. It also only manages DNS while the domain still uses Hover's
nameservers.

**Shopify** — admin → **Settings → Domains** → the domain → DNS settings →
**Manage** → **Add custom record**. Host is `www`. No apex option for an outside
target.

**Porkbun** — Domain Management → **DNS** → **Add Record**. Fields are Type,
Host, Answer, TTL. Porkbun is the only consumer registrar in this list with a
working apex option: pick the record type **ALIAS – CNAME flattening**, leave
Host blank, and put `origin.saas.yaks.app` in Answer.

**Cloudflare** — the zone → **DNS** → **Add record**. Type CNAME, Name `www` or
`@`, Target `origin.saas.yaks.app`. Set **Proxy status** to **DNS only** (the
grey cloud). When the record is proxied, Cloudflare answers with its own
addresses in the person's zone and the request never reaches yaks.app.

## Apex domains

DNS does not allow a CNAME at a domain's apex: the bare `example.com`, with no
subdomain in front of it. Non-technical people often give up at this step, so
have the answer ready before they reach it. There are three ways to serve an
apex domain:

**Move their DNS to Cloudflare.** This is the best option; recommend it first.
Cloudflare's DNS flattens a CNAME at the apex (it resolves the target and serves
its addresses), so `example.com` works. It is free, it does not transfer the
domain's registration, and it takes about ten minutes:

1. dash.cloudflare.com → **Add a domain** → type `example.com`.
2. Choose the **Free** plan. Cloudflare scans the existing records; check that
   their mail records were copied before continuing, because a missing MX record
   is the usual way this step goes wrong.
3. Cloudflare gives two nameservers. Copy both.
4. At the registrar, replace the current nameservers with those two. Every panel
   above has this under a "Nameservers" or "DNS" heading.
5. Wait. Usually an hour or two, sometimes a day.
6. Then add the CNAME in Cloudflare's own DNS tab, as above.

If the domain has DNSSEC turned on at the old registrar, turn it off there first
and wait a day before changing nameservers; otherwise resolvers see a broken
DNSSEC chain and the domain stops resolving. Cloudflare can turn DNSSEC back on
afterwards.

**Use the registrar's ALIAS or ANAME record.** It takes the same value as the
CNAME, in a record type that is allowed at the apex. Porkbun has one. GoDaddy,
Namecheap, Squarespace, Hover and Shopify do not.

**Attach `www` instead.** `domain_attach(app, hostname: 'www.example.com')`, a
CNAME at `www`, and a forwarding rule at the apex sending `example.com` to
`www.example.com`. Every registrar above offers domain forwarding under some
name. It works and people accept it, but the address they share is still the
bare domain, so offer Cloudflare first.

While they are moving DNS, tell them that Cloudflare's registrar charges what
the registry charges, with no markup, so transferring the domain there at its
next renewal usually costs less than they pay now. A transfer requires the
domain to be at least 60 days old, unlocked at the current registrar, and an
authorization code from that registrar, and it takes about five days. None of
that is required to point the domain at yaks.app; people usually ask about it
once their DNS is on Cloudflare.

## Provisioning status

`domain_status` reports four steps, each `done`, `waiting` or `error`, because
each step waits on a different party:

- **ownership** — whether the ownership TXT record matches this attachment.
  Waiting means the person must add the exact TXT name and value the tool gives.
- **dns** — whether the CNAME resolves to yaks.app. Waiting means the person has
  not added it yet, or it has not propagated. The ownership TXT record and CNAME
  are the two records the person adds.
- **validation** — whether Cloudflare has accepted the hostname as one yaks.app
  may serve. It completes after dns.
- **certificate** — whether the HTTPS certificate is issued. This step can still
  be running after the records have propagated, and it needs no action from
  anybody.

So "your CNAME hasn't propagated yet" and "the certificate is still issuing" are
different answers, and the tool reports which one applies. Tell the person the
one it reports. A step in `error` carries the reason as Cloudflare gave it, in
Cloudflare's words, not a paraphrase.

Timing: DNS propagation usually takes minutes and can take a day, depending on
the old record's TTL. The certificate is usually issued a few minutes after
that. Nothing needs to be done in between; check again in five minutes rather
than changing anything.

## Troubleshooting a domain that stays pending

- **A CAA record on their domain.** A CAA record lists which certificate
  authorities may issue certificates for the domain, and the one yaks.app uses
  has to be on the list. The certificate step reports this.
- **Another record at the same name.** DNS forbids a CNAME beside an A, AAAA or
  another CNAME at one name. An old A record at `www` pointing at a site they
  replaced years ago has to be deleted, not left alongside.
- **The domain is in somebody else's Cloudflare account, on hold.** The error
  says so. Only that account's owner can remove the hold.
- **An old custom hostname from a previous platform.** If they moved from
  another site builder, the hostname may still be registered there, and that
  registration keeps taking precedence. They have to remove it at the old
  platform.
- **The record was saved with the domain doubled**:
  `www.example.com.example.com`. See "Adding the records at each registrar"
  above. This is by far the most common cause.

## Detaching a domain

`domain_detach(hostname)` releases the hostname and leaves the app unchanged,
still served at `<space>.yaks.app`. It does not change the person's DNS: those
records are theirs, in their registrar. Tell them to delete the CNAME and
ownership TXT record for the detached hostname.

Detach before attaching a domain somewhere else. A hostname belongs to one app
on the whole platform, and `domain_attach` refuses a hostname that is already
attached rather than moving it away from whoever holds it.
