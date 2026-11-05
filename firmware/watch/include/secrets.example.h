// Copy to secrets.h (gitignored) and fill in. Never commit real values.
#pragma once

#define APN "iot.1nce.net"                 // 1NCE; Hologram: "hologram"
#define APN_USER ""
#define APN_PASS ""

// MQTT broker reachable from the internet over TLS (docs/remote.md "Reaching the watch"):
// a free cloud broker your home Mosquitto bridges to (recommended, no open ports at home),
// or your own Mosquitto on 8883 behind a port forward.
#define MQTT_HOST "xxxxxxxx.s1.eu.hivemq.cloud"
#define MQTT_PORT 8883
#define MQTT_USER "slate-watch"
#define MQTT_PASS "change-me"
#define MQTT_CLIENT_ID "slate-watch"
#define MQTT_PREFIX "slate/watch"           // same as /settings > Remote > Watch MQTT prefix

// TLS. 1 = check the broker's certificate against CA_PEM (recommended); 0 = encrypt without checking.
#define MQTT_TLS_VERIFY 0
// For MQTT_TLS_VERIFY 1, paste the broker's root CA (e.g. ISRG Root X1 from letsencrypt.org/certs/isrgrootx1.pem).
#define CA_PEM ""

// Optional: also push alerts straight to ntfy over HTTPS (owners without Home Assistant). Empty = off.
#define NTFY_HOST ""                        // e.g. "ntfy.sh"
#define NTFY_TOPIC ""
