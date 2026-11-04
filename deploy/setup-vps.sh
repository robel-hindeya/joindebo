#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 22.04/24.04 VPS for Join Debo.
# Run as root:  bash setup-vps.sh "<public key of the deploy key>"
# Installs Docker, opens only SSH/HTTP/HTTPS, and creates a "deploy" user
# that the GitHub deploy workflow logs in as.
set -euo pipefail

DEPLOY_PUBKEY="${1:?usage: setup-vps.sh \"ssh-ed25519 AAAA... deploy\"}"

apt-get update
apt-get install -y ca-certificates curl ufw unattended-upgrades

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# Firewall: SSH, HTTP, HTTPS (and HTTP/3) only.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Deploy user: may run docker, nothing else.
if ! id deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
fi
usermod -aG docker deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
grep -qxF "$DEPLOY_PUBKEY" /home/deploy/.ssh/authorized_keys 2>/dev/null \
  || echo "$DEPLOY_PUBKEY" >> /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

install -d -m 750 -o deploy -g deploy /opt/temelash

# Security updates install themselves.
dpkg-reconfigure -f noninteractive unattended-upgrades

echo
echo "Done. Next: create /opt/temelash/.env from deploy/server.env.example (owner: deploy, mode 600)."
