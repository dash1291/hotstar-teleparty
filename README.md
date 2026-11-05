# Hotstar Party

A Chrome extension for two people watching Hotstar together from different
places. When either of you plays, pauses or seeks, the other player follows.
The person who created the room is the host, and the host's player is the
reference the other one drifts back to.

The extension needs a tiny relay server that both browsers connect to. It
only forwards messages between the two browsers; it never sees the video.

## Layout

- `extension/` is the unpacked Chrome extension (Manifest V3).
- `server/` is the WebSocket relay (Node, one dependency).

## 1. Run the relay

Both of you need to reach the same relay over the internet, so run it on a
server with a public hostname and TLS. Chrome refuses plain `ws://` from an
`https://` page unless the host is `localhost`, so a remote relay must be
`wss://`.

```sh
cd server
npm install
PORT=8790 node server.js
```

Or build the container and run it anywhere that gives you a `https://`
hostname (Fly.io, Railway, Render, or your own box behind Caddy):

```sh
cd server
docker build -t hotstar-party-relay .
docker run -p 8790:8790 hotstar-party-relay
```

A plain `GET /` returns `hotstar-party relay`, which is enough for health
checks.

## 2. Install the extension

Both people do this once.

1. Open `chrome://extensions`.
2. Turn on Developer mode (top right).
3. Click "Load unpacked" and choose the `extension/` folder.
4. Pin "Hotstar Party" to the toolbar.
5. Click the icon, open "Relay server" and enter your relay URL, for example
   `wss://party.example.com`. The default `ws://localhost:8790` only works
   when the relay runs on the same machine as the browser.

## 3. Watch together

1. Both open the same title on hotstar.com and let it start playing.
2. One person clicks the icon and presses "Create a room", then sends the
   six-letter code to the other.
3. The other person clicks the icon, types the code and presses "Join".

From then on, play, pause and seeking are mirrored both ways. A small toast
in the corner tells you when your friend joins or leaves. If one of you
navigates to a different title the popup says so and sync pauses until you
are on the same page again. If the page reloads, the extension rejoins the
same room on its own.

## How the sync works

- Each browser sends `sync` messages when the local player plays, pauses or
  finishes a seek, with the current time and the page path.
- The host also sends a `tick` every two seconds. The other side seeks only
  if it has drifted by more than 1.5 seconds, so normal buffering jitter does
  not cause constant seeking.
- Remote commands are applied with a short echo window, so the resulting
  local events are not sent straight back.
- The relay keeps members in join order. The first member is the host, and if
  the host leaves, the next member is promoted.

## Limits

- Hotstar ad breaks are not synchronised. Free-tier accounts will fall out of
  step during ads and catch up on the next host tick.
- Each person needs their own Hotstar login. Nothing about the stream is
  shared, only player commands.
- No chat or voice. Use a call alongside it.
- Hotstar's keyboard shortcuts and the on-screen controls all work, since
  the extension listens to the player itself rather than the buttons.

## Deploying without root

`deploy/` holds the files used on a plain Ubuntu host where the deploy user
has no Docker access and no passwordless sudo. Everything lives under the
user's home and runs as user-level systemd services, which survive logout
because lingering is enabled for the user.

1. Clone this repository to `~/hotstar-party`.
2. Install Node under the home directory, for example by unpacking the
   official tarball into `~/.local/opt/node` and linking `node` into
   `~/.local/bin`. Run `npm ci --omit=dev` in `server/`.
3. Download the Caddy release tarball, verify it against the published
   checksums, and put the binary at `~/.local/bin/caddy`.
4. Copy both unit files from `deploy/` into `~/.config/systemd/user/`, then
   `systemctl --user daemon-reload` and `systemctl --user enable --now` each
   of them.
5. Two steps need root once. `setcap cap_net_bind_service=+ep` on the Caddy
   binary lets it bind 80 and 443 as the unprivileged user. Writing
   `net.mptcp.enabled = 0` to `/etc/sysctl.d/99-no-mptcp.conf` and applying
   it turns off MPTCP on the host, matching the `GODEBUG=multipathtcp=0` set
   on the Caddy unit, as a mitigation for CVE-2026-98432.

The Caddyfile uses an sslip.io hostname that resolves to the host's own IP,
so no DNS record is required. Replace it with a real hostname if you have
one.
