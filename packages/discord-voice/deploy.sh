#!/bin/sh
# Deploy the relay (./relay.ts) to one Compute Engine e2-micro, Google
# Cloud's free tier in us-central1, and point yaks.app at it. Run again to
# update: what exists is kept, the code is copied anew and restarted.
#
#   packages/discord-voice/deploy.sh
#
# It makes, once each, in PROJECT (justyaks): a static address, a firewall
# rule opening 80 and 443 to the VM's tag, and the VM itself (Debian 12, a
# 10 GB standard disk). On the VM: Deno, pinned; Caddy, which answers HTTPS
# at <address>.sslip.io with a Let's Encrypt certificate and passes it to the
# relay on 8080; and the relay as a systemd service, its RELAY_KEY made once
# and kept in /etc/discord-voice.env. Then yaks.app's VOICE_RELAY and
# VOICE_RELAY_KEY secrets are put (workers/yak, wrangler), so the Operator's
# joins reach it. Nothing secret is printed.
set -eu
project=${PROJECT:-justyaks}
zone=${ZONE:-us-central1-a}
region=${zone%-*}
name=discord-voice
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
deno_version=2.9.1
g() { gcloud --project "$project" --quiet "$@"; }

g compute addresses describe "$name" --region "$region" >/dev/null 2>&1 ||
  g compute addresses create "$name" --region "$region"
ip=$(g compute addresses describe "$name" --region "$region" \
  --format='value(address)')
host=$(printf %s "$ip" | tr . -).sslip.io

g compute firewall-rules describe "$name" >/dev/null 2>&1 ||
  g compute firewall-rules create "$name" --allow tcp:80,tcp:443 \
    --target-tags "$name"

g compute instances describe "$name" --zone "$zone" >/dev/null 2>&1 ||
  g compute instances create "$name" --zone "$zone" \
    --machine-type e2-micro --image-family debian-12 \
    --image-project debian-cloud --boot-disk-size 10GB \
    --boot-disk-type pd-standard --address "$ip" --tags "$name"

# The relay's code, and its dependencies alone: the workspace's own
# packages are for its tests.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp "$here/relay.ts" "$here/audio.ts" "$work/"
deno eval "
let p = JSON.parse(Deno.readTextFileSync('$here/package.json'))
Deno.writeTextFileSync('$work/package.json',
  JSON.stringify({ type: 'module', dependencies: p.dependencies }, null, 2))
"
# A new VM takes a moment before it takes ssh.
for i in 1 2 3 4 5 6 7 8 9 10; do
  g compute ssh "$name" --zone "$zone" --command true >/dev/null 2>&1 && break
  sleep 6
done
g compute scp --zone "$zone" "$work/relay.ts" "$work/audio.ts" \
  "$work/package.json" "$name:/tmp/"

g compute ssh "$name" --zone "$zone" --command "sudo sh -s" <<EOF
set -eu
if ! command -v caddy >/dev/null || ! command -v unzip >/dev/null; then
  apt-get update -q
  apt-get install -y -q caddy unzip curl
fi
if [ "\$(deno --version 2>/dev/null | head -1 | cut -d' ' -f2)" != "$deno_version" ]; then
  curl -fsSL -o /tmp/deno.zip \
    "https://github.com/denoland/deno/releases/download/v$deno_version/deno-x86_64-unknown-linux-gnu.zip"
  unzip -o -q /tmp/deno.zip -d /usr/local/bin
fi
id -u relay >/dev/null 2>&1 || useradd --system --home /opt/$name relay
mkdir -p /opt/$name
mv /tmp/relay.ts /tmp/audio.ts /tmp/package.json /opt/$name/
chown -R relay /opt/$name
[ -f /etc/$name.env ] || {
  printf 'RELAY_KEY=%s\nRELAY_HOSTS=yaks.app\nPORT=8080\n' \
    "\$(head -c 32 /dev/urandom | base64 | tr -d '/+=')" > /etc/$name.env
  chmod 600 /etc/$name.env
}
cat > /etc/systemd/system/$name.service <<UNIT
[Unit]
Description=The Discord voice relay (@yaks/discord-voice)
After=network-online.target
Wants=network-online.target

[Service]
User=relay
WorkingDirectory=/opt/$name
EnvironmentFile=/etc/$name.env
Environment=DENO_DIR=/opt/$name/.deno
ExecStart=/usr/local/bin/deno run -A --node-modules-dir=auto relay.ts
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
printf '%s {\n\treverse_proxy localhost:8080\n}\n' "$host" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable -q $name caddy
systemctl restart $name
systemctl reload-or-restart caddy
EOF

key=$(g compute ssh "$name" --zone "$zone" \
  --command "sudo sed -n 's/^RELAY_KEY=//p' /etc/$name.env")
cd "$root/workers/yak"
printf %s "https://$host" | npx wrangler secret put VOICE_RELAY >/dev/null
printf %s "$key" | npx wrangler secret put VOICE_RELAY_KEY >/dev/null

# Caddy asks for its certificate on the first request: wait for it.
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "https://$host/" && echo && break
  sleep 6
done
echo "The relay answers at https://$host"
