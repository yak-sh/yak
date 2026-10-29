# Agent machine, not the Cloudflare builder in workers/yak/sandbox/base.
# Build context: workers/machine. Linux amd64 deliberately: the Deno download
# and Debian manifest below are architecture-specific. No host checkout/secrets.
FROM debian:trixie-slim@sha256:918311b7b6c4c6f68b232ba516584925f6c78ad82b6fd534b98979df6438e483

# The snapshot pins transitive dependencies too. Refresh it with the explicit
# package versions; never trade reproducibility for a floating apt upgrade.
RUN printf 'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20261015T000000Z trixie main\ndeb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20261015T000000Z trixie-security main\n' > /etc/apt/sources.list \
 && rm /etc/apt/sources.list.d/* \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
    bash=5.2.37-2+b10 ca-certificates=20250419 \
    curl=8.14.1-2+deb13u7 \
    git=1:2.47.3-0+deb13u1 gh=2.46.0-3 jq=1.7.1-6+deb13u4 \
    openssh-client=1:10.0p1-7+deb13u4 procps=2:4.0.4-9 \
    python3=3.13.5-1 ripgrep=14.1.1-1+b4 \
    sudo=1.9.16p2-3+deb13u2 unzip=6.0-29+deb13u1 \
 && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

ARG DENO_VERSION=2.9.1
ARG DENO_SHA256=710c54d63477d1100844ef4818f19507ce0dbf40510903b1d883f19e394446a2
RUN curl -fsSL -o /tmp/deno.zip "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip" \
 && echo "${DENO_SHA256}  /tmp/deno.zip" | sha256sum -c - \
 && unzip -q /tmp/deno.zip -d /usr/local/bin \
 && rm /tmp/deno.zip \
 && deno --version

# Docker Sandboxes' shell template contract. sudo is confined to the guest;
# no Docker daemon/socket, host state, sign-ins or provider code belongs here.
RUN groupadd --gid 1000 agent \
 && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash agent \
 && printf 'agent ALL=(ALL) NOPASSWD: ALL\nDefaults:agent env_keep += "HTTP_PROXY HTTPS_PROXY NO_PROXY http_proxy https_proxy no_proxy"\n' > /etc/sudoers.d/agent \
 && chmod 0440 /etc/sudoers.d/agent \
 && visudo -cf /etc/sudoers.d/agent \
 && touch /etc/sandbox-persistent.sh \
 && chown agent:agent /etc/sandbox-persistent.sh

# A public, shallow checkout at an immutable commit, not COPY of a developer's
# .git (which could contain credentials, other worktrees and uncommitted work).
ARG REPO_COMMIT=96ae43eb9476c3b7bc2c8f8630315e33378b65c0
LABEL org.opencontainers.image.source="https://github.com/yak-sh/yak" \
      org.opencontainers.image.revision="${REPO_COMMIT}"
ENV HOME=/home/agent \
    BASH_ENV=/etc/sandbox-persistent.sh \
    DENO_DIR=/home/agent/.cache/deno
USER agent
WORKDIR /home/agent/workspace
RUN git init . \
 && git remote add origin https://github.com/yak-sh/yak.git \
 && git -c protocol.version=2 fetch --filter=blob:none --depth=1 origin "${REPO_COMMIT}" \
 && git sparse-checkout set --no-cone '/*' '!/logo-concepts*/' '!/homepage-concepts/' \
 && git checkout --detach FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "${REPO_COMMIT}"
USER root
COPY yak /usr/local/bin/yak
RUN chmod 0755 /usr/local/bin/yak
USER agent
CMD ["/bin/bash"]
