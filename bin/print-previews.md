# Print service fixture previews

`deno run -A bin/print-previews.ts <config.json>` deploys both app source
directories, uploads a private licensed font, configures deterministic preview
adapters and connects CrayonBloom to the selected PrintBound service operations.
It does not configure a payment account, Lulu credentials, domains or model
keys. The service integration remains unlisted.

Create two private apps under agent fixture accounts with `yak command app_new`
and retain their returned IDs. Use different spaces to exercise cross-app
permission. Sign in to those accounts locally with
`yak auth yaks.app --as
<fixture>@bot.yak.sh`. Give the setup command a local
configuration file:

```json
{
  "font": "/path/to/licensed/CrimsonText-Regular.ttf",
  "assets": "/path/to/curated-public-assets",
  "printer": {
    "at": "printer-fixtures/printbound",
    "id": "<PrintBound app UUID>",
    "as": "printer-fixtures"
  },
  "coloring": {
    "at": "coloring-fixtures/crayonbloom",
    "id": "<CrayonBloom app UUID>",
    "as": "coloring-fixtures"
  }
}
```

The assets directory holds the paths in `apps/crayonbloom/public-assets.json`:
original theme PNGs and their printable PDFs. Their bytes stay outside git. Omit
`assets` when the app already holds these files; source pushes preserve uploaded
images and PDFs. The setup uses each selected account's own person as the
fixture font's customer. A connection without a website session can name that
person explicitly with `buyer` in its target.

Both `/studio` routes use the app worker's customer interfaces. Private source
stores remain closed to strangers; selected service operations carry the
customer's identity separately from store membership. Quotes and receipts in
these previews are fixtures, and preparation uses the deployed PDF raster
boundary. Production adapters remain available for separately authorized account
activation and physical proofs.
