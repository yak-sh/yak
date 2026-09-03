# A domain of their own

An app here answers at `<space>.yaks.app/<app>/`. It can also answer at a domain
the person already owns — `herbusiness.com`, or `www.herbusiness.com` — serving
at the root of it, with the `.yaks.app` address still working.

This page is for you, the assistant. The person you are helping owns a domain
and probably bought it years ago from GoDaddy or Namecheap or Squarespace. They
do not know what a CNAME is and they should not have to. You already know what
those control panels look like. So: attach the domain here, then walk them
through their registrar in their own words, or do it for them if you can reach
it.

Back to the map: <https://yaks.app/guide.md>

## The three tools

- `domain_attach(app, hostname)` — provisions the hostname and answers with the
  DNS record that has to be added, as data: `records: [{type, name, value}]`.
  Only the space owner may attach one.
- `domain_status(hostname?)` — where provisioning has got to, split into the
  three things that can be outstanding. Leave `hostname` out to get every domain
  in the space.
- `domain_detach(hostname)` — hands the hostname back. The app is untouched:
  same data, same files, same `<space>.yaks.app` address.

A domain points at one app, and a hostname belongs to one app across the whole
platform. A space can have several — one per app — and `www.herbusiness.com` and
`herbusiness.com` are two hostnames, so attach both if they want both.

## The record

Always the same shape, whatever the registrar calls the fields:

    CNAME   herbusiness.com   →   origin.saas.yaks.app

`domain_attach` answers with exactly that, as data. Read it out of `records`
rather than out of the sentence — the value is the one thing that must be typed
character for character.

Nothing serves at the domain until that record resolves. Until then the hostname
answers whatever it answered before.

## The panels

The trap that catches people at half of these registrars: **the Name/Host field
is a prefix, and the panel adds the domain itself.** Typing
`www.herbusiness.com` there produces `www.herbusiness.com.herbusiness.com`. When
in doubt, type `www`, and check the record's full name after saving.

**GoDaddy** — Domain Portfolio → the domain → **DNS** → **Add New Record**.
Fields are Type, Name, Value, TTL. Name takes the prefix (`www`), not the whole
hostname. GoDaddy has no apex answer at all: see below.

**Namecheap** — Domain List → **Manage** → **Advanced DNS** → Host Records →
**Add New Record**. Fields are Type, Host, Value, TTL. Host is a prefix and
Namecheap appends the domain, so `www`, never `www.herbusiness.com`. Namecheap
refuses a CNAME at `@` — it offers a URL Redirect record instead, which is the
`www` answer below.

**Squarespace** (which is also where Google Domains ended up — the migration is
finished, and the panel is Squarespace's) — account.squarespace.com/domains →
the domain → **DNS** → **Custom Records** → **Add Record**. Fields are Type,
Name, Priority, TTL, Data — the target goes in **Data**. Name is a prefix and
Squarespace appends the domain. There is no apex record here at all.

**Wix** — Domains → the domain's **Domain Actions** → **Manage DNS records**.
Wix's own instruction: where another vendor tells you to put `@` in Host Name,
**leave Host Name blank instead**.

**Hover** — the domain's **Overview** → **DNS** → **Add a record**. Fields are
Type, Hostname, Target Name. Hover says plainly that it cannot hold a CNAME on
the root domain. It also only manages DNS while the domain still uses Hover's
nameservers.

**Shopify** — admin → **Settings → Domains** → the domain → DNS settings →
**Manage** → **Add custom record**. Host takes `www`. No apex answer for an
outside target.

**Porkbun** — Domain Management → **DNS** → **Add Record**. Fields are Type,
Host, Answer, TTL. Porkbun is the one consumer registrar in this list with a
real apex answer: pick the record type **ALIAS – CNAME flattening**, leave Host
blank, and put `origin.saas.yaks.app` in Answer.

**Cloudflare** — the zone → **DNS** → **Add record**. Type CNAME, Name `www` or
`@`, Target `origin.saas.yaks.app`. Set **Proxy status** to **DNS only** (the
grey cloud). Proxied, Cloudflare answers with its own address in the person's
own zone and the hostname never reaches us.

## The apex

DNS does not allow a CNAME at a domain's apex — the bare `herbusiness.com`, with
nothing in front of it. This is where a non-technical person gives up, so have
the answer ready before they hit it. Three ways through:

**Move their DNS to Cloudflare.** The best answer, and the one to lead with.
Cloudflare's DNS flattens a CNAME at the apex — it resolves the target and
serves the addresses — so `herbusiness.com` simply works. It is free, it does
not move the domain's registration, and it takes about ten minutes:

1. dash.cloudflare.com → **Add a domain** → type `herbusiness.com`.
2. Choose the **Free** plan. Cloudflare scans the existing records; check that
   their mail records came across before continuing, because a missing MX is how
   this goes wrong.
3. Cloudflare gives two nameservers. Copy both.
4. At the registrar, replace the current nameservers with those two. Every panel
   above has this under a "Nameservers" or "DNS" heading.
5. Wait. Usually an hour or two, sometimes a day.
6. Then add the CNAME in Cloudflare's own DNS tab, as above.

If the domain has DNSSEC turned on at the old registrar, turn it off there first
and give it a day before changing nameservers; otherwise resolvers see a broken
chain and the domain goes dark. Cloudflare can turn it back on afterwards.

**Use the registrar's ALIAS or ANAME.** Same value, a record type that is
allowed at the apex. Porkbun has one. GoDaddy, Namecheap, Squarespace, Hover and
Shopify do not.

**Attach `www` instead.** `domain_attach(app, hostname: 'www.herbusiness.com')`,
a CNAME at `www`, and a forwarding rule at the apex sending `herbusiness.com` to
`www.herbusiness.com`. Every registrar above has domain forwarding under some
name. It works and people accept it, but the address they say out loud is still
the bare one, so offer Cloudflare first.

While they are moving DNS, it is worth saying that Cloudflare's registrar
charges what the registry charges, with no markup added — so transferring the
domain there at its next renewal usually costs less than they pay now. A
transfer needs the domain to be at least 60 days old, unlocked at the current
registrar, and an authorization code from them, and it takes about five days.
None of that is required to point the domain here; it is just the thing they
will ask about once their DNS is on Cloudflare.

## Reading the status

`domain_status` answers three steps, each with `done`, `waiting` or `error`,
because each one waits on somebody different:

- **dns** — whether the record resolves here. Waiting means the person has not
  added it yet, or it has not propagated. This is the only step they can do
  anything about.
- **validation** — whether Cloudflare has accepted the hostname as one we may
  serve. It follows dns.
- **certificate** — whether the HTTPS certificate is issued. This is the step
  that is still running after the record has arrived, and it needs nothing from
  anybody.

So "your CNAME hasn't propagated yet" and "the certificate is still issuing" are
different answers, and the tool tells you which one is true. Say the one it
says. A step in `error` carries the reason in its own words, and those words are
Cloudflare's, not a paraphrase.

Timing: DNS is usually minutes and can be a day, depending on what the old
record's TTL was. The certificate is usually minutes after that. Nothing needs
doing in between — check again in five minutes rather than changing anything.

## When it stays stuck

- **A CAA record on their domain.** If they have one, it lists which certificate
  authorities may issue for the domain, and ours has to be on the list. The
  certificate step says so.
- **Another record at the same name.** DNS forbids a CNAME sitting beside an A,
  AAAA or another CNAME at one name. An old A record at `www` pointing at a site
  they replaced years ago has to be deleted, not left alongside.
- **The domain is already on Cloudflare in somebody else's account, on hold.**
  The error names it. Only that account's owner can lift it.
- **An old custom hostname from a previous platform.** If they moved from
  another site builder, the hostname may still be registered there and will keep
  winning. They have to remove it at the old platform.
- **The record went in with the domain doubled** —
  `www.herbusiness.com.herbusiness.com`. See the panels above. This is the most
  common one by a distance.

## Detaching

`domain_detach(hostname)` gives the hostname back and leaves the app exactly as
it was, still serving at `<space>.yaks.app`. It does not touch the person's DNS
— that record is theirs, in their registrar, and after detaching it points at
nothing, so tell them to delete it.

Detach before re-attaching a domain somewhere else. A hostname belongs to one
app on the whole platform, and `domain_attach` refuses a name that is taken
rather than moving it out from under whoever has it.
