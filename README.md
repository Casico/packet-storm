# Packet Storm

Real-time co-op network defense party game for 4–10 engineers. See [RULES.md](./RULES.md) for the design.

## Status

**v0.1 — movement prototype.** Lobby, room codes, 8-node Small Office topology, arrow-key token movement, link contention (one token per link at a time). No threats, tasks, roles, or bandwidth yet.

**Default port: 4000.** (3000 is reserved for SkyChat on the host. Override with `PORT=…`.)

## Run locally (Node)

```bash
npm install
npm run dev
```

Open <http://localhost:4000> in 2+ browser tabs / windows. Create a room in one, join with the code from another. Use arrow keys to move tokens.

For LAN multiplayer testing, point other devices at `http://<your-mac-ip>:4000`.

## Run locally (Docker)

```bash
docker compose up --build
```

Same port (4000). `Ctrl+C` to stop, `docker compose down` to clean up.

## Deploy to the Raspberry Pi 5

**Recommended path: build natively on the Pi.** This Mac is x86_64 but the Pi 5 is arm64, so a `docker save` from here won't run there without cross-compilation. The Pi has plenty of horsepower to do its own build.

On the Pi (assumes Raspberry Pi OS 64-bit, Docker installed):

```bash
# one-time setup
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker $USER     # log out / back in after this

# clone + build + run
git clone <repo-url> packet-storm
cd packet-storm
docker compose up -d --build
```

`restart: unless-stopped` in `docker-compose.yml` makes the container survive reboots.

**Updates:** `git pull && docker compose up -d --build` from inside the project dir.

**Logs:** `docker compose logs -f packet-storm`

### Alternative: cross-build on the Mac

If you'd rather build here and ship the image:

```bash
# one-time
docker buildx create --use --name xbuild

# build for Pi (arm64) and save to a tarball
docker buildx build --platform linux/arm64 -t packet-storm:latest --load .
docker save packet-storm:latest -o packet-storm.tar

# transfer + load
scp packet-storm.tar pi@<pi-ip>:~/
ssh pi@<pi-ip> 'docker load -i ~/packet-storm.tar && docker run -d --name packet-storm --restart unless-stopped -p 4000:4000 packet-storm:latest'
```

Slower (QEMU emulation) and more fiddly — only worth it if the Pi has no internet during build.

## Cloudflare Tunnel (public URL)

On the Pi, after the container is healthy on `localhost:4000`:

```bash
# install cloudflared (arm64)
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb

# auth, create tunnel, point at port 4000 (interactive — we'll walk through this together)
cloudflared tunnel login
cloudflared tunnel create packet-storm
# ...config file + DNS routing, then:
cloudflared tunnel run packet-storm
```

We'll do this step-by-step tomorrow when the Pi is up.

## Stack

- **Server:** Node 20 + Express + Socket.IO. Single `server.js`, in-memory room state.
- **Client:** Vanilla JS + Canvas. `public/index.html`, `public/client.js`, `public/style.css`.
- **Container:** `node:20-alpine`, production deps only.

## Project layout

```
.
├── RULES.md              # game design doc
├── README.md             # this file
├── package.json
├── Dockerfile
├── .dockerignore
├── docker-compose.yml
├── server.js             # express + socket.io, room/state mgmt
└── public/
    ├── index.html        # lobby + game view
    ├── style.css
    └── client.js         # canvas render + input + sockets
```
