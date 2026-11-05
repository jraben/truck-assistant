// Slate Cockpit P4 screen: parsed brain state, kept between MQTT messages.
//
// The rule this file exists to keep: a value the brain sent as null (or never
// sent) is NAN / -1 here and is drawn as an em dash, never as 0. A screen that
// shows "0%" for "the brain doesn't know the charge" is lying in the one place
// the driver looks.
#pragma once

#include <cmath>
#include <cstdio>
#include <string>

#include <ArduinoJson.h>

namespace cockpit {

static const char *const DASH = "\xE2\x80\x94";  // U+2014 em dash

static const char *const TIRE_KEYS[4] = {"fl", "fr", "rl", "rr"};
static const char *const TIRE_NAMES[4] = {"FL", "FR", "RL", "RR"};

// docs/contract.md default relay names; the brain's state overrides them.
static const char *const DEFAULT_RELAY_NAMES[6] = {"Bed lights",     "Light bar", "Rock lights",
                                                   "Air compressor", "Bed fridge", "Inverter"};

static const uint32_t PENDING_TIMEOUT_MS = 5000;   // tap -> no state change -> "no response"
static const uint32_t REFUSED_SHOW_MS = 12000;     // how long the "no response" alert stays
static const uint32_t DIRECT_WINS_MS = 2500;       // truck box topic beats the brain's copy
static const uint32_t TAP_DEBOUNCE_MS = 700;

struct State {
  bool have_state = false;     // at least one brain state parsed since boot
  uint32_t last_state_ms = 0;  // millis() of the last parsed state
  bool brain_online = true;    // slate/brain/status; assumed until told otherwise

  float speed = NAN, soc = NAN, range = NAN, aux = NAN;
  float psi[4] = {NAN, NAN, NAN, NAN};
  bool truckbox = false;  // only meaningful once have_state

  std::string relay_name[6];
  int8_t relay_on[6] = {-1, -1, -1, -1, -1, -1};  // 1 on, 0 off, -1 unknown
  uint32_t direct_ms[6] = {0};    // last update from the truck box's own topic
  uint32_t pending_ms[6] = {0};   // tap sent, waiting for the state to move
  int8_t pending_from[6] = {-1, -1, -1, -1, -1, -1};
  int8_t pending_want[6] = {-1, -1, -1, -1, -1, -1};
  uint32_t refused_ms[6] = {0};   // tap timed out with no change
  uint32_t last_tap_ms[6] = {0};

  State() {
    for (int i = 0; i < 6; i++)
      relay_name[i] = DEFAULT_RELAY_NAMES[i];
  }
};

inline State &st() {
  static State s;
  return s;
}

// A JSON number, or NAN for null / missing / not-a-number.
inline float num(JsonVariantConst v) {
  if (v.isNull())
    return NAN;
  if (v.is<float>() || v.is<double>() || v.is<long>() || v.is<int>())
    return v.as<float>();
  return NAN;
}

inline void set_relay(int i, int8_t v, uint32_t now) {
  State &s = st();
  s.relay_on[i] = v;
  if (s.pending_ms[i] != 0 && v != s.pending_from[i]) {
    s.pending_ms[i] = 0;  // it moved: the command landed
    s.refused_ms[i] = 0;
  }
}

// slate/truckbox/switch/relay_N/state, straight from the truck box.
inline void on_direct_relay(int i, const std::string &payload, uint32_t now) {
  int8_t v = payload == "ON" ? 1 : payload == "OFF" ? 0 : -1;
  st().direct_ms[i] = now;
  set_relay(i, v, now);
}

inline void parse_state(JsonObjectConst x, uint32_t now) {
  State &s = st();
  s.have_state = true;
  s.last_state_ms = now;

  s.speed = num(x["speedMph"]);
  s.soc = num(x["soc"]);
  s.range = num(x["rangeMi"]);
  s.aux = num(x["aux12v"]);

  JsonVariantConst tb = x["truckbox"];
  s.truckbox = tb.is<bool>() ? tb.as<bool>() : false;

  JsonVariantConst tp = x["tpms"];
  for (int i = 0; i < 4; i++)
    s.psi[i] = tp.isNull() ? NAN : num(tp[TIRE_KEYS[i]]["psi"]);

  JsonVariantConst rl = x["relays"];
  if (!rl.isNull()) {
    char key[10];
    for (int i = 0; i < 6; i++) {
      snprintf(key, sizeof(key), "relay_%d", i + 1);
      JsonVariantConst r = rl[key];
      if (r.isNull())
        continue;
      const char *name = r["name"].as<const char *>();
      if (name != nullptr && name[0] != '\0')
        s.relay_name[i] = name;
      // The brain's copy of a relay lags the truck box's own topic by up to a
      // second; don't let a stale copy flip a button back just after a tap.
      if (s.direct_ms[i] != 0 && now - s.direct_ms[i] < DIRECT_WINS_MS)
        continue;
      JsonVariantConst on = r["on"];
      set_relay(i, on.is<bool>() ? (on.as<bool>() ? 1 : 0) : -1, now);
    }
  }
}

// Expire taps that never changed anything (low-voltage lockout, compressor
// cooldown, truck box gone). Returns true if something changed.
inline bool tick(uint32_t now) {
  State &s = st();
  bool changed = false;
  for (int i = 0; i < 6; i++) {
    if (s.pending_ms[i] != 0 && now - s.pending_ms[i] > PENDING_TIMEOUT_MS) {
      s.pending_ms[i] = 0;
      s.refused_ms[i] = now;
      changed = true;
    }
    if (s.refused_ms[i] != 0 && now - s.refused_ms[i] > REFUSED_SHOW_MS) {
      s.refused_ms[i] = 0;
      changed = true;
    }
  }
  return changed;
}

inline std::string fmt(float v, const char *f) {
  if (std::isnan(v))
    return DASH;
  char buf[24];
  snprintf(buf, sizeof(buf), f, v);
  return buf;
}

// Alerts, worst first. red=true if any line is critical.
inline std::string alerts(bool link_up, bool &red) {
  State &s = st();
  std::string out;
  red = false;
  auto add = [&](const std::string &line, bool crit) {
    if (!out.empty())
      out += "\n";
    out += line;
    red = red || crit;
  };
  if (!link_up) {
    add("NO LINK TO THE PI  (Wi-Fi or MQTT down)", true);
  } else if (!s.have_state) {
    add("WAITING FOR THE BRAIN", false);
  }
  if (!s.brain_online)
    add("BRAIN OFFLINE  (numbers below are its last report)", true);
  if (s.have_state && !s.truckbox)
    add("TRUCK BOX OFFLINE  (relays unavailable)", true);
  if (!std::isnan(s.aux) && s.aux < 11.8f) {
    char b[48];
    snprintf(b, sizeof(b), "12V BATTERY LOW  %.1f V", s.aux);
    add(b, true);
  }
  std::string tires;
  for (int i = 0; i < 4; i++) {
    if (!std::isnan(s.psi[i]) && s.psi[i] < 30.0f) {
      char b[24];
      snprintf(b, sizeof(b), "%s%s %.0f", tires.empty() ? "" : "   ", TIRE_NAMES[i], s.psi[i]);
      tires += b;
    }
  }
  if (!tires.empty())
    add("TIRE PRESSURE LOW  " + tires + " psi", true);
  for (int i = 0; i < 6; i++) {
    if (s.refused_ms[i] != 0)
      add(s.relay_name[i] + ": no response  (lockout or cooldown?)", false);
  }
  return out;
}

}  // namespace cockpit
