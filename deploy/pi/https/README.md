# The truck's secure address (HTTPS on the Pi)

The dash tablet opens the cockpit from the Pi. Over plain `http://10.42.0.1:8080`,
Chrome treats it as an insecure page: no real full-screen app (it opens as a tab),
no CarPlay over USB, no location or microphone without the `chrome://flags`
workaround. With its own name and a real certificate, all of that just works,
with or without signal:

- **One app.** "Slate Cockpit" installed from `https://truck.jeffraben.com` runs
  full screen. No Fully Kiosk, no flags, no tabs.
- **CarPlay connects by itself.** Pick the Carlinkit once. After that the cockpit
  reconnects whenever it opens or the dongle is plugged in.
- **Offline.** The truck's own Wi-Fi answers the name, and checking a certificate
  needs no internet.

How it fits together:

```
NAS (home)                                   Pi (truck)                         Tablet
renews the certificate ── push-truck-cert.sh ─▶ /var/lib/slate-cockpit/tls ─▶ brain :443 ◀── https://truck.jeffraben.com
(DNS login stays here)    (SSH, when the truck is     (swapped in live,          slate-ap Wi-Fi answers the
                           home or on Tailscale)       no restart)                name with 10.42.0.1
```

`http://10.42.0.1:8080` stays as it is (Tasker's sleep timing reads it, and the
Pi's own screen uses localhost).

## 1. Pick the name and add a DNS record

Any name in a domain you control works; these steps use `truck.jeffraben.com`.
Add a DNS **A record** `truck.jeffraben.com → 10.42.0.1`. A private address in
public DNS is fine: it only means "the truck's own Wi-Fi". It's the backup for
tablets with Android's Private DNS on, which skips the truck's own answer.

## 2. On the Pi (once)

```sh
sudo ./deploy/pi/install.sh                              # the brain may now use port 443
sudo ./deploy/pi/https/setup-https.sh truck.jeffraben.com
```

That makes the truck's Wi-Fi answer the name, makes `/var/lib/slate-cockpit/tls`
for the certificate, and lets your admin user copy into it. Log out and back in
once for the group.

## 3. On the NAS: the certificate

The NAS issues a certificate for **this name only** and renews it with the tool
it already uses for the other sites. A wildcard (`*.jeffraben.com`) also works,
but then the key to every one of your sites lives in the truck; a truck-only
certificate keeps a stolen truck from mattering. Examples (DNS challenge,
Cloudflare shown; use your DNS provider's plugin):

```sh
# acme.sh
acme.sh --issue --dns dns_cf -d truck.jeffraben.com
acme.sh --install-cert -d truck.jeffraben.com \
  --fullchain-file /volume1/certs/truck/fullchain.pem --key-file /volume1/certs/truck/privkey.pem
# or certbot
certbot certonly --dns-cloudflare --dns-cloudflare-credentials ~/.cf.ini -d truck.jeffraben.com
```

Then let the NAS reach the Pi over SSH with a key (no password):

```sh
ssh-keygen -t ed25519 -f ~/.ssh/truck_cert -N ''
ssh-copy-id -i ~/.ssh/truck_cert.pub jeff@slate-truck     # the Pi's admin user; Tailscale name or home IP
```

And send it daily (Synology Task Scheduler, or cron):

```sh
CERT_DIR=/volume1/certs/truck PI=jeff@slate-truck SSH_OPTS='-i ~/.ssh/truck_cert' \
  /path/to/truck-assistant/deploy/nas/push-truck-cert.sh
```

It only copies when the certificate changed, and says "truck not reachable"
(not an error) while the truck is away. The brain picks a new one up within a
minute, with no restart. Certificates last 90 days and renew at 60, so the
truck has a month to come home or be on Tailscale.

**Check:** `curl -s http://<pi>:8080/api/https` shows `"on": true`, the name and
days left. Settings › Logs & system shows the same.

## 4. On the tablet

1. Join the truck's Wi-Fi (`slate-truck`).
2. In Chrome open `https://truck.jeffraben.com` and sign in.
3. Chrome menu › **Install app**. Open it from its icon: it should be full screen
   with no address bar.
4. **CarPlay › Connect** and pick the Carlinkit, once.
5. **Tasker**, profile **Power Any**, task **Slate Cockpit**: replace its Browse URL
   step with **App › Launch App** › the new Slate Cockpit, and tap ✓. Unplug and
   plug in: the app comes to the front.
6. Fully Kiosk is no longer needed: turn off its *Launch on boot* if it's on, and
   uninstall it. The `chrome://flags` "insecure origins" entries can go too.

Only one page can use the dongle at a time. If CarPlay says the dongle was
refused, close any other cockpit tab or app that has it (Recents › close), unplug
the dongle for 5 seconds, then Connect again.

## For other Slate owners

This needs a domain you control (about $10 a year) whose DNS your certificate
tool can update, plus a computer at home to renew the certificate. Without
one, the fallback still works: the `chrome://flags` entry for
`http://10.42.0.1:8080` in `deploy/android/README.md`, and Fully Kiosk is not
an option for CarPlay (it can't use USB).
