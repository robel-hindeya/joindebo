# Deploying to the VPS

Staging runs on a VPS with Docker Compose: Caddy in front (HTTPS, path routing, staging password) and
one container each for the API and the four apps. Production will use the same files. The database
stays on Supabase until the move described in [docs/DATABASE.md](../docs/DATABASE.md).

```
https://SITE_DOMAIN/            -> customer:3000
https://SITE_DOMAIN/staff       -> staff:3000
https://SITE_DOMAIN/owner       -> owner:3000
https://SITE_DOMAIN/administrator -> admin:3000
https://SITE_DOMAIN/api/...     -> api:4000
```

Every push to `main` that passes CI builds the five images, pushes them to GHCR
(`ghcr.io/robel-hindeya/temelash-card-<service>`, tagged with the commit and `latest`) and, once the
secrets below exist, deploys them. Until then the deploy job stops after pushing images.

## What you need

- A VPS with Ubuntu 22.04 or 24.04, 2 GB RAM or more, a public IPv4 address, root SSH access.
- A domain or subdomain (for example `staging.joindebo.com`) with an **A record pointing at the VPS IP**.

## One-time setup

1. **Deploy key** (on your computer):
   ```bash
   ssh-keygen -t ed25519 -N "" -C temelash-deploy -f temelash-deploy
   ```
   This makes `temelash-deploy` (private) and `temelash-deploy.pub` (public).
2. **Prepare the server.** Copy the script over, then run it as root with the contents of
   `temelash-deploy.pub`:
   ```bash
   scp deploy/setup-vps.sh root@<vps-ip>:/root/
   ```
   ```bash
   ssh root@<vps-ip> 'bash /root/setup-vps.sh "ssh-ed25519 AAAA... temelash-deploy"'
   ```
3. **Server secrets**: as the `deploy` user create `/opt/temelash/.env` from
   [server.env.example](server.env.example) (`chmod 600`). Generate the staging password hash with
   `docker run --rm caddy:2.8-alpine caddy hash-password --plaintext '<password>'`.
4. **GitHub** (repo Settings → Secrets and variables → Actions):
   - secret `VPS_HOST`: the VPS IP or hostname
   - secret `VPS_SSH_KEY`: the contents of the private `temelash-deploy` file
   - secret `VPS_USER` (optional, default `deploy`)
   - variable `STAGING_URL`: `https://staging.joindebo.com` (enables the post-deploy health check)
5. Run **Actions → Deploy staging → Run workflow**, or push to `main`.

## Day to day

- Roll back: on the server, `cd /opt/temelash && IMAGE_TAG=<older commit sha> docker compose up -d`.
- Logs: `docker compose logs -f api` (structured JSON, one line per request).
- Database migrations are not run by the deploy; apply them first (see docs/DATABASE.md).
