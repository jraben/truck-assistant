# Getting the cockpit online

The Slate has no modem. The cockpit uses whoever is driving: it joins the
**active driver's phone hotspot**. Requested 2026-11-05.

## Radios on the Pi

Two jobs need Wi-Fi at once, so the Pi gets a second radio:

| Radio | Job |
|---|---|
| Built-in Wi-Fi | Access point `slate-truck` for the ESP32 truck box (and a phone opening `/settings`). Never leaves this job. |
| USB Wi-Fi adapter (~$15, Linux-supported chipset, e.g. MT7601U/RTL8811CU class) | Client: joins the driver's hotspot, or home Wi-Fi in the driveway. |
| Built-in Bluetooth | Fallback internet: Bluetooth tethering (PAN) to the driver's phone. |

One radio doing both (AP + client) is possible on the Pi but pins both to the
same channel and breaks whenever the phone's hotspot changes channel, so it
is not the plan.

## Which network, in order

1. **Home Wi-Fi** when it is in range (driveway): sync trips, charges and
   settings to the NAS / Home Assistant.
2. **The active driver's hotspot** (SSID + password stored in their profile,
   entered on `/settings`, masked like other keys).
3. **Any other driver's hotspot** that is in range (a passenger's phone).
4. **Bluetooth tethering** to the active driver's paired phone.
5. Offline: everything local keeps working; uploads queue.

Switching driver re-orders the list at once. The brain does this through
NetworkManager (`nmcli`) on the Pi; on a desk it is simulated.

## iPhone caveats (to check on the bench)

- An iPhone only shows its hotspot while the Personal Hotspot settings screen
  is open or "Allow Others to Join" is on, and turns Wi-Fi hotspot off after a
  while with no clients. A device that has joined before can usually rejoin
  while the phone is unlocked nearby. To verify with Jeff's phone.
- **Wireless CarPlay also uses the phone's Wi-Fi.** Whether an iPhone keeps its
  Wi-Fi hotspot up while in wireless CarPlay with the Carlinkit dongle is not
  confirmed. If it does not, Bluetooth tethering (step 4) is the fallback, and
  it is slower but enough for weather, radar tiles and sync.
- Data use is shown on the cockpit (MB this trip / this month per driver) so
  nobody's plan gets surprised. Radar animation and internet radio are the big
  users; both pause when the cockpit is on a hotspot with "save data" on.

## Status in the UI

The top strip shows the link: `HOME WI-FI`, `JEFF'S HOTSPOT`, `BT · JEFF`, or
`OFFLINE`, with signal and data used. Tapping it opens a small panel to pick a
network by hand.
