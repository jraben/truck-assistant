# Security

What the cockpit protects, how, and what to do if the truck is stolen.
Written 2026-11-05 for Track D.

## Who can do what

| From | Cockpit screen `/` | `/settings`, `/truck`, the API, `/ws` |
|---|---|---|
| The dash (Chromium on the Pi, `localhost`) | open | open (can be switched off: Settings, Security, "The dash screen needs no password") |
| A phone on the truck's Wi-Fi (`slate-truck`) | page loads, data needs login | password, then a 30-day session cookie |
| Tailscale / home LAN | same | same |
| Before a password is set (first boot) | open | **open**: the setup wizard asks for one first |

- The password is set at first boot (setup wizard, on the dash or a phone)
  or in Settings, Security. At least 8 characters. Stored as a scrypt hash
  (`N=2^15, r=8, p=1`, 16-byte salt) in `DATA_DIR/ops.json`; never the
  password itself.
- Changing it needs the current one, even on the dash, and logs every other
  device out.
- Sessions: a random 256-bit token in an `HttpOnly; SameSite=Strict` cookie;
  only its SHA-256 is stored (SQLite `sessions`), so a copied database holds no
  usable session. 30 days, revocable ("Log out everywhere").
- Login is rate limited per address: 5 wrong passwords in 15 minutes locks
  that address out for 15 minutes (429 with `Retry-After`).
- `GET /api/health`, `/api/about`, `/api/update/version` and `/login` stay
  open (uptime checks, the updater's health check).
- Forgot the password: on the Pi, set `"passwordHash": null` in
  `/var/lib/slate-cockpit/ops.json` and `sudo systemctl restart slate-brain`.

The dash is trusted because anyone sitting at it already has the truck. The
real boundary is the truck's Wi-Fi password and your tailnet.

## The truck's Wi-Fi

The access point `slate-truck` (NetworkManager profile `slate-ap`,
`deploy/pi/network/setup-ap.sh`) is how the truck box and a phone reach the
brain. Its password is set at first boot: the flashed image makes a random one
and the wizard shows it on the dash and asks you to change it; `install.sh`
asks for one. The ESP32 truck box needs the same password in its ESPHome
`secrets.yaml`. Mosquitto on the Pi listens without a password, so the Wi-Fi
password is what keeps strangers off the relays: use a long one.

## Home Assistant: a limited user and its own token

The brain's HA token can read every entity HA has. Give it as little as
possible:

1. In HA, Settings, People, add a user `slate-truck`: **not** an
   administrator, "Can only log in from the local network" off only if the
   truck reaches HA over Tailscale.
2. Log in as that user once, Profile, Security, create a long-lived access
   token named for the truck, paste it on the truck's `/settings`. The brain
   only reads (`/api/states`, `/api/history`) and, if you turn on maintenance
   notifications, calls one `notify.*` service.
3. Never paste an admin's token. HA has no per-entity scopes for REST tokens,
   so a non-admin user is the boundary that exists.
4. MQTT is separate: the Pi's Mosquitto bridges `slate/#` to the home broker
   when the truck is home. Give the bridge its own broker user that may only
   write `slate/#` and `homeassistant/#` (discovery) and read
   `slate/truckbox/switch/+/command` if HA should switch relays.

## Tailscale ACL example

The truck (tag `tag:truck`) should be reachable by you, not reach your network.
In the tailnet policy file:

```jsonc
{
  "tagOwners": { "tag:truck": ["autogroup:admin"] },
  "acls": [
    // your devices may open the cockpit/settings on the truck
    { "action": "accept", "src": ["jeff@example.com"], "dst": ["tag:truck:8080"] },
    // the truck may reach Home Assistant and the NAS backup share, nothing else
    { "action": "accept", "src": ["tag:truck"], "dst": ["homeassistant:8123", "nas:445", "nas:22"] }
  ],
  "hosts": { "homeassistant": "100.x.y.z", "nas": "100.x.y.w" }
}
```

Bring the Pi up with `sudo tailscale up --advertise-tags=tag:truck` and
turn key expiry **on** for it, so a stolen truck falls off your tailnet by
itself even if you never get to it. Don't advertise routes or an exit node
from the truck.

## What is stored where

| Where (on the Pi) | What | Leaves the truck? |
|---|---|---|
| `/var/lib/slate-cockpit/settings.json` (0600) | truck + driver settings, **API keys, HA token, Wi-Fi and hotspot passwords** | Only in a backup if you opt in to "include keys" (off by default) |
| `/var/lib/slate-cockpit/ops.json` (0600) | mileage rules, reminders, backup target, admin password **hash**, setup progress | In backups, without the hash unless you opt in |
| `/var/lib/slate-cockpit/cockpit.db` | trips + GPS points, stops, places, charge sessions, mileage tags, maintenance log, TPMS history, session hashes, caches | Nightly backup to your NAS/target |
| `/var/lib/slate-cockpit/receipts/` | maintenance receipt photos | Backups |
| `/var/lib/slate-cockpit/backups/` | the last few backups | Only as backups |
| `/etc/slate-cockpit/ap-password` (root, 0600) | the access point password as first set | Never |
| `/etc/slate-cockpit/nas-credentials` (root, 0600) | the SMB user for the backup share | Never |
| `/var/lib/slate-cockpit/.ssh/` | the backup SSH key | Never (only its public half goes on the NAS) |

**Never leaves the truck:** passwords and tokens (except an opted-in backup),
the admin password hash, session tokens, the AP password, the CarPlay
dongle's data, camera video (Track C keeps video local; only a clips index is
backed up), album art.

**Does leave, by design:** the state JSON over MQTT to your own Home Assistant
when on home Wi-Fi (location, speed, charge, driver, place); reverse-geocode
lookups to OpenStreetMap (rounded coordinates, no account); charger searches to
NREL/Open Charge Map (position); fueleconomy.gov (vehicle menus);
GitHub (update checks, no identifiers beyond the User-Agent version). Nothing
goes to a project server: there isn't one.

## Threat model: a stolen truck

Assume the thief has the Pi, its SD card/SSD and time.

- **Everything in the table above is readable** (no disk encryption: the Pi
  must boot unattended). That includes the HA token and the Wi-Fi/hotspot
  passwords. Plan to rotate them.
- **Do this, in order:**
  1. **Revoke the HA token**: in HA, the `slate-truck` user's profile,
     Security, delete the token (or disable the user). The truck loses
     everything HA gave it.
  2. **Remove the truck from Tailscale** (admin console, Machines, Remove) if
     key expiry hasn't already done it.
  3. **Rotate each driver's phone hotspot password** (the truck knew them) and,
     if you set home Wi-Fi on the truck, your **home Wi-Fi password**.
  4. Rotate the NAS backup user's password and remove the truck's SSH key from
     the NAS `authorized_keys`.
  5. Rotate the charger API keys (low value, but free to do).
  6. The cockpit admin password only guarded the truck itself; rotate it if
     you reused it anywhere (don't).
- **Location history** (trips, stops, home location) is on the disk. A thief
  learns where you live and go. Nothing on the Pi can prevent that; the
  backups on your NAS let you keep the history after the truck is gone.
- **Tracking the truck:** the cockpit only reports while it is powered and on
  home Wi-Fi or a hotspot. Track C's LTE-M watch (`docs/remote.md`) and an
  AirTag are the stolen-truck tools, not this.
- **Relays:** with the Wi-Fi password, anyone in range can switch the upfit
  relays via MQTT. The truck box's own safety rules (low-voltage cutoff,
  compressor limits) still hold; nothing reaches the truck's own systems.

## Reporting a security problem

Open a private GitHub security advisory on the repository rather than a public
issue.
