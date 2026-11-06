// Slate Cockpit tier 1: the always-on watch.
//
// A LilyGO T-SIM7080G-S3 (ESP32-S3 + SIM7080G LTE-M/NB-IoT + GNSS + AXP2101)
// that sleeps almost all the time and, every CHECKIN_S (or when the vibration
// switch trips), wakes up and:
//   1. reads the truck's 12V (its own divider) and asks the truck box over a
//      3-wire UART for relays, ignition, cabin temperature ("S?");
//   2. takes a GNSS fix (the SIM7080G can't do GNSS and LTE at once, so the
//      radio is off meanwhile);
//   3. attaches to LTE-M, connects to the MQTT broker over TLS with a
//      persistent session (commands sent while it slept are queued for it),
//      publishes <prefix>/state, any alerts, and HA discovery once a day;
//   4. runs the commands that were waiting: wake/sleep the Pi, a relay, a new
//      check-in interval;
//   5. powers the modem off and deep-sleeps, unless it is holding the Pi awake,
//      in which case it stays connected until told to let go (or PI_MAX_AWAKE_S).
//
// It uses TinyGSM for the modem basics (power, network, data) and the SIM7080G's
// own MQTT (AT+SM*) and HTTP (AT+SH*) clients for TLS, so the ESP32 holds no TLS
// stack. NOT YET RUN ON HARDWARE: the AT sequences follow the SIM7080 series AT
// manual and LilyGO's examples; check them with a board on the bench.
#include <Arduino.h>
#include <Wire.h>
#include <time.h>
#include <sys/time.h>
#include <esp_sleep.h>
#include <driver/rtc_io.h>
#include <driver/gpio.h>

#define TINY_GSM_MODEM_SIM7080
#define TINY_GSM_RX_BUFFER 1024
#include <TinyGsmClient.h>

#define XPOWERS_CHIP_AXP2101
#include <XPowersLib.h>

#include "config.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#warning "include/secrets.h missing: building with secrets.example.h (placeholders)"
#include "secrets.example.h"
#endif

#define SerialAT Serial1
#define SerialTB Serial2

TinyGsm modem(SerialAT);
XPowersPMU PMU;

// ---- state that survives deep sleep -----------------------------------------
RTC_DATA_ATTR uint32_t bootCount = 0;
RTC_DATA_ATTR uint32_t checkinS = CHECKIN_S_DEFAULT;
RTC_DATA_ATTR bool parkSet = false;
RTC_DATA_ATTR float parkLat = 0, parkLon = 0;
RTC_DATA_ATTR bool parkArm = true;          // take the next fix with the ignition off as the park position
RTC_DATA_ATTR int8_t lastIgn = -1;          // -1 unknown, 0 off, 1 on
RTC_DATA_ATTR uint32_t vibCount = 0, vibReported = 0;
RTC_DATA_ATTR time_t lastVibWake = 0, lastDiscovery = 0;
RTC_DATA_ATTR time_t lastMovedAlert = 0, last12vAlert = 0, lastHotAlert = 0, lastVibAlert = 0;
RTC_DATA_ATTR float lastLat = 0, lastLon = 0;
RTC_DATA_ATTR time_t lastFixAt = 0;
RTC_DATA_ATTR bool timeSet = false;

// ---- this wake ---------------------------------------------------------------
struct TruckBox { bool ok = false; char relays[7] = "------"; int ign = -1; int rev = -1; float v = NAN; float cabinF = NAN; };
struct Fix { bool ok = false; float lat = 0, lon = 0, kmh = 0; };
static TruckBox tb;
static Fix fix;
static float v12 = NAN;
static bool mqttUp = false;
RTC_DATA_ATTR bool holdPi = false;          // holding the Pi on (survives sleep; so does the pin, via gpio hold)
RTC_DATA_ATTR time_t holdUntil = 0;

static time_t now() { return time(nullptr); }

static float haversineM(float la1, float lo1, float la2, float lo2) {
  const float R = 6371000.0f, d2r = 0.01745329252f;
  float dla = (la2 - la1) * d2r, dlo = (lo2 - lo1) * d2r;
  float a = sinf(dla / 2) * sinf(dla / 2) + cosf(la1 * d2r) * cosf(la2 * d2r) * sinf(dlo / 2) * sinf(dlo / 2);
  return 2 * R * atan2f(sqrtf(a), sqrtf(1 - a));
}

// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm): no TZ database needed.
static int64_t daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (int64_t)era * 146097 + (int64_t)doe - 719468;
}

static void setClock(int y, int mo, int d, int h, int mi, int s) {
  if (y < 2024) return;
  struct timeval tv = { (time_t)(daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s), 0 };
  settimeofday(&tv, nullptr);
  timeSet = true;
}

// ---- power -------------------------------------------------------------------

static bool pmuBegin() {
  if (!PMU.begin(Wire, AXP2101_SLAVE_ADDRESS, BOARD_I2C_SDA, BOARD_I2C_SCL)) return false;
  PMU.disableTSPinMeasure();           // no battery thermistor on this board
  PMU.setDC3Voltage(3000);             // SIM7080G main supply (LilyGO: 2700-3400 mV, 3000 typical)
  PMU.enableDC3();
  PMU.setBLDO2Voltage(3300);           // GNSS active antenna
  PMU.enableBLDO2();
  PMU.enableBattVoltageMeasure();
  return true;
}

static void pmuSleep() {
  PMU.disableBLDO2();
  PMU.disableDC3();                    // modem fully unpowered between check-ins
}

static float read12v() {
  analogSetPinAttenuation(PIN_VBAT_SENSE, ADC_11db);
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(PIN_VBAT_SENSE);
  return (mv / 8) / 1000.0f * VBAT_DIVIDER;
}

static void setWakePi(bool on) {
  gpio_hold_dis((gpio_num_t)PIN_WAKE_PI);
  pinMode(PIN_WAKE_PI, OUTPUT);
  digitalWrite(PIN_WAKE_PI, on ? HIGH : LOW);
  gpio_hold_en((gpio_num_t)PIN_WAKE_PI);   // keeps the level through deep sleep
}

// ---- truck box link ("S?" -> "S r=010000 ign=1 rev=0 v=12.61 t=78.2") -------

static void truckboxQuery() {
  SerialTB.begin(TB_BAUD, SERIAL_8N1, PIN_TB_RX, PIN_TB_TX);
  while (SerialTB.available()) SerialTB.read();
  SerialTB.print("S?\n");
  String line;
  uint32_t t0 = millis();
  while (millis() - t0 < 600) {
    while (SerialTB.available()) {
      char c = SerialTB.read();
      if (c == '\n') {
        if (line.startsWith("S ")) {
          int i;
          if ((i = line.indexOf("r=")) >= 0) line.substring(i + 2, i + 8).toCharArray(tb.relays, sizeof(tb.relays));
          if ((i = line.indexOf("ign=")) >= 0) tb.ign = line.charAt(i + 4) == '1' ? 1 : 0;
          if ((i = line.indexOf("rev=")) >= 0) tb.rev = line.charAt(i + 4) == '1' ? 1 : 0;
          if ((i = line.indexOf(" v=")) >= 0) tb.v = line.substring(i + 3).toFloat();
          if ((i = line.indexOf(" t=")) >= 0 && line.substring(i + 3, i + 6) != "nan") tb.cabinF = line.substring(i + 3).toFloat();
          tb.ok = true;
          return;
        }
        line = "";
      } else if (c != '\r' && line.length() < 120) line += c;
    }
    delay(5);
  }
}

static void truckboxSend(const char *line) {
  SerialTB.begin(TB_BAUD, SERIAL_8N1, PIN_TB_RX, PIN_TB_TX);
  SerialTB.print(line);
  SerialTB.print("\n");
  SerialTB.flush();
}

static void truckboxRelay(const char *id, bool on) {
  // "relay_3" -> "R3=1"
  const char *n = strrchr(id, '_');
  if (!n || n[1] < '1' || n[1] > '6') return;
  SerialTB.begin(TB_BAUD, SERIAL_8N1, PIN_TB_RX, PIN_TB_TX);
  SerialTB.printf("R%c=%d\n", n[1], on ? 1 : 0);
  SerialTB.flush();
}

// ---- modem -------------------------------------------------------------------

static bool at(const String &cmd, uint32_t ms = 5000) { modem.sendAT(cmd); return modem.waitResponse(ms) == 1; }

static bool modemOn() {
  SerialAT.begin(115200, SERIAL_8N1, BOARD_MODEM_RXD_PIN, BOARD_MODEM_TXD_PIN);
  pinMode(BOARD_MODEM_PWR_PIN, OUTPUT);
  for (int tries = 0; tries < 4; tries++) {
    if (modem.testAT(1500)) return true;
    // PWRKEY: a ~1 s pulse turns the SIM7080G on (or off, if it was on).
    digitalWrite(BOARD_MODEM_PWR_PIN, LOW); delay(100);
    digitalWrite(BOARD_MODEM_PWR_PIN, HIGH); delay(1000);
    digitalWrite(BOARD_MODEM_PWR_PIN, LOW);
    delay(3000);
  }
  return modem.testAT(3000);
}

static void modemOff() {
  if (mqttUp) { at("+SMDISC", 3000); mqttUp = false; }
  at("+CPOWD=1", 3000);
}

/** GNSS fix with the radio off; sets the clock from GNSS UTC as a bonus. */
static void gnssFix() {
  at("+CFUN=0", 10000);
  at("+CGNSPWR=1");
  uint32_t t0 = millis();
  while (millis() - t0 < GNSS_TIMEOUT_S * 1000UL) {
    delay(2000);
    modem.sendAT("+CGNSINF");
    String r;
    if (modem.waitResponse(2000, r) != 1) continue;
    // +CGNSINF: <run>,<fix>,<utc yyyyMMddhhmmss.sss>,<lat>,<lon>,<alt>,<speed km/h>,...
    int p = r.indexOf("+CGNSINF:");
    if (p < 0) continue;
    String f[9]; int k = 0, s = p + 10;
    for (int i = s; i <= (int)r.length() && k < 9; i++) if (i == (int)r.length() || r[i] == ',' || r[i] == '\r') { f[k++] = r.substring(s, i); s = i + 1; }
    f[0].trim();
    if (k < 7 || f[1] != "1") continue;
    fix.ok = true; fix.lat = f[3].toFloat(); fix.lon = f[4].toFloat(); fix.kmh = f[6].toFloat();
    if (f[2].length() >= 14) setClock(f[2].substring(0, 4).toInt(), f[2].substring(4, 6).toInt(), f[2].substring(6, 8).toInt(), f[2].substring(8, 10).toInt(), f[2].substring(10, 12).toInt(), f[2].substring(12, 14).toInt());
    break;
  }
  at("+CGNSPWR=0");
  at("+CFUN=1", 10000);
}

static bool network() {
  modem.setNetworkMode(38);            // LTE only
  modem.setPreferredMode(1);           // Cat-M first (3 = Cat-M and NB-IoT)
  if (!modem.waitForNetwork(NET_TIMEOUT_S * 1000UL)) return false;
  if (!modem.isGprsConnected() && !modem.gprsConnect(APN, APN_USER, APN_PASS)) return false;
  if (!timeSet) {
    // No GNSS fix this time: the network's clock (+CCLK: "yy/MM/dd,hh:mm:ss±zz", zz in quarter hours).
    modem.sendAT("+CCLK?");
    String r;
    if (modem.waitResponse(2000, r) == 1) {
      int p = r.indexOf('"');
      if (p >= 0 && r.length() > (unsigned)p + 20) {
        String c = r.substring(p + 1);
        int y = 2000 + c.substring(0, 2).toInt(), tz = c.substring(17, 20).toInt();
        setClock(y, c.substring(3, 5).toInt(), c.substring(6, 8).toInt(), c.substring(9, 11).toInt(), c.substring(12, 14).toInt(), c.substring(15, 17).toInt());
        if (timeSet) { struct timeval tv = { now() - tz * 15 * 60, 0 }; settimeofday(&tv, nullptr); }
      }
    }
  }
  return true;
}

static String q(const char *s) { String o = "\""; o += s; o += "\""; return o; }

static bool mqttConnect() {
  if (strlen(CA_PEM) && MQTT_TLS_VERIFY) {
    // Store the CA in the modem's file system, then convert it into the SSL context.
    at("+CFSINIT");
    modem.sendAT("+CFSWFILE=3,\"ca.pem\",0,", (int)strlen(CA_PEM), ",10000");
    if (modem.waitResponse(5000, GF("DOWNLOAD")) == 1) { modem.stream.write((const uint8_t *)CA_PEM, strlen(CA_PEM)); modem.waitResponse(5000); }
    at("+CFSTERM");
    at("+CSSLCFG=\"convert\",2,\"ca.pem\"");
  }
  at("+CSSLCFG=\"sslversion\",0,3");                      // TLS 1.2
  at(String("+CSSLCFG=\"sni\",0,") + q(MQTT_HOST));
  at(String("+SMCONF=\"URL\",") + q(MQTT_HOST) + "," + String(MQTT_PORT));
  at("+SMCONF=\"KEEPTIME\",120");
  at("+SMCONF=\"CLEANSS\",0");                              // persistent session: commands queue while asleep
  at(String("+SMCONF=\"CLIENTID\",") + q(MQTT_CLIENT_ID));
  at(String("+SMCONF=\"USERNAME\",") + q(MQTT_USER));
  at(String("+SMCONF=\"PASSWORD\",") + q(MQTT_PASS));
  at("+SMCONF=\"QOS\",1");
  at(String("+SMCONF=\"TOPIC\",\"") + MQTT_PREFIX + "/status\"");   // last will
  at("+SMCONF=\"MESSAGE\",\"offline\"");
  at("+SMCONF=\"RETAIN\",1");
  at(MQTT_TLS_VERIFY && strlen(CA_PEM) ? "+SMSSL=1,\"ca.pem\",\"\"" : "+SMSSL=1,\"\",\"\"");
  if (!at("+SMCONN", 30000)) return false;
  mqttUp = true;
  at(String("+SMSUB=\"") + MQTT_PREFIX + "/command\",1");
  return true;
}

static bool publish(const String &topic, const String &payload, bool retain, int qos = 1) {
  if (!mqttUp || payload.length() > 1024) return false;
  modem.sendAT("+SMPUB=", q(topic.c_str()), ",", (int)payload.length(), ",", qos, ",", retain ? 1 : 0);
  if (modem.waitResponse(5000, GF(">")) != 1) return false;
  modem.stream.write((const uint8_t *)payload.c_str(), payload.length());
  return modem.waitResponse(10000) == 1;
}

static String esc(const String &s) { String o; for (char c : s) { if (c == '"' || c == '\\') o += '\\'; if (c >= 32) o += c; } return o; }

/** Optional: alert straight to ntfy over HTTPS (the modem's own HTTP client). */
static void ntfy(const String &title, const String &msg) {
  if (!strlen(NTFY_HOST) || !strlen(NTFY_TOPIC)) return;
  at(String("+SHCONF=\"URL\",\"https://") + NTFY_HOST + "\"");
  at("+SHCONF=\"BODYLEN\",1024");
  at("+SHCONF=\"HEADERLEN\",350");
  at("+CSSLCFG=\"sslversion\",1,3");
  at(String("+CSSLCFG=\"sni\",1,") + q(NTFY_HOST));
  at("+SHSSL=1,\"\"");
  if (!at("+SHCONN", 20000)) return;
  at("+SHCHEAD");
  at(String("+SHAHEAD=\"Title\",") + q(esc(title).c_str()));
  at("+SHAHEAD=\"Tags\",\"warning,truck\"");
  modem.sendAT("+SHBOD=", (int)msg.length(), ",10000");
  if (modem.waitResponse(5000, GF(">")) == 1) { modem.stream.write((const uint8_t *)msg.c_str(), msg.length()); modem.waitResponse(5000); }
  at(String("+SHREQ=\"/") + NTFY_TOPIC + "\",3", 20000);   // 3 = POST
  at("+SHDISC");
}

// `url` (optional): where a tap on the push goes, e.g. a map of where the truck is now.
static void alert(const char *kind, const String &title, const String &message, const String &url = "") {
  String j = String("{\"kind\":\"") + kind + "\",\"title\":\"" + esc(title) + "\",\"message\":\"" + esc(message) + "\"" + (url.length() ? String(",\"url\":\"") + esc(url) + "\"" : String("")) + ",\"ts\":" + String((long)now()) + "}";
  publish(String(MQTT_PREFIX) + "/alert", j, false);
  ntfy(title, message);
}

// ---- Home Assistant discovery (compact: HA's abbreviations, one device) -------

static void discovery() {
  const String p = MQTT_PREFIX;
  const String dev = "\"dev\":{\"ids\":[\"slate_watch\"],\"name\":\"Slate Watch\",\"mf\":\"Slate Cockpit (DIY)\",\"mdl\":\"T-SIM7080G-S3\",\"sw\":\"" FW_VERSION "\"}";
  const String common = String("\"~\":\"") + p + "\",\"avty_t\":\"~/status\",\"exp_aft\":" + String(checkinS * 3) + "," + dev;
  struct S { const char *comp, *id, *name, *tpl, *extra; };
  const S sensors[] = {
    { "sensor", "v12", "12V battery", "{{ value_json.v12 }}", ",\"unit_of_meas\":\"V\",\"dev_cla\":\"voltage\",\"stat_cla\":\"measurement\"" },
    { "sensor", "cabin", "Cabin", "{{ value_json.cabin_f }}", ",\"unit_of_meas\":\"°F\",\"dev_cla\":\"temperature\",\"stat_cla\":\"measurement\"" },
    { "sensor", "rssi", "LTE signal", "{{ value_json.rssi }}", ",\"unit_of_meas\":\"dBm\",\"dev_cla\":\"signal_strength\",\"ent_cat\":\"diagnostic\"" },
    { "sensor", "cell", "Backup cell", "{{ value_json.batt_mv }}", ",\"unit_of_meas\":\"mV\",\"dev_cla\":\"voltage\",\"ent_cat\":\"diagnostic\"" },
    { "binary_sensor", "moved", "Moved while parked", "{{ 'ON' if value_json.moved else 'OFF' }}", ",\"dev_cla\":\"moving\"" },
    { "binary_sensor", "pi", "Pi awake", "{{ 'ON' if value_json.pi else 'OFF' }}", ",\"dev_cla\":\"power\"" },
  };
  for (const S &s : sensors) {
    String j = String("{\"name\":\"") + s.name + "\",\"uniq_id\":\"slate_watch_" + s.id + "\",\"stat_t\":\"~/state\",\"val_tpl\":\"" + s.tpl + "\"" + s.extra + "," + common + "}";
    publish(String("homeassistant/") + s.comp + "/slate_watch/" + s.id + "/config", j, true);
  }
  publish("homeassistant/device_tracker/slate_watch/location/config",
          String("{\"name\":\"Location\",\"uniq_id\":\"slate_watch_location\",\"json_attr_t\":\"~/state\",\"json_attr_tpl\":\"{{ {'latitude': value_json.lat, 'longitude': value_json.lon, 'gps_accuracy': 15} | tojson if value_json.fix else '{}' }}\",\"src_type\":\"gps\",") + common + "}", true);
  publish("homeassistant/button/slate_watch/wake_pi/config",
          String("{\"name\":\"Wake Pi\",\"uniq_id\":\"slate_watch_wake_pi\",\"cmd_t\":\"~/command\",\"pl_prs\":\"{\\\"pi\\\":\\\"wake\\\"}\",\"qos\":1,\"icon\":\"mdi:power\",") + common + "}", true);
  publish("homeassistant/button/slate_watch/sleep_pi/config",
          String("{\"name\":\"Sleep Pi\",\"uniq_id\":\"slate_watch_sleep_pi\",\"cmd_t\":\"~/command\",\"pl_prs\":\"{\\\"pi\\\":\\\"sleep\\\"}\",\"qos\":1,\"icon\":\"mdi:power-sleep\",") + common + "}", true);
  lastDiscovery = now();
}

// ---- the report --------------------------------------------------------------

static int rssiDbm() { int csq = modem.getSignalQuality(); return csq >= 0 && csq <= 31 ? -113 + 2 * csq : 0; }

static void report(bool moved) {
  bool parked = tb.ign != 1;
  String j = "{\"ts\":" + String((long)now());
  j += ",\"fix\":" + String(fix.ok ? "true" : "false");
  if (fix.ok || lastFixAt) { j += ",\"lat\":" + String(fix.ok ? fix.lat : lastLat, 6) + ",\"lon\":" + String(fix.ok ? fix.lon : lastLon, 6) + ",\"gps_at\":" + String((long)(fix.ok ? now() : lastFixAt)); }
  if (!isnan(v12)) j += ",\"v12\":" + String(v12, 2);
  if (!isnan(tb.cabinF)) j += ",\"cabin_f\":" + String(tb.cabinF, 1);
  j += ",\"vib\":" + String(vibCount - vibReported);
  j += ",\"moved\":" + String(moved ? "true" : "false");
  if (tb.ign >= 0) j += ",\"ign\":" + String(tb.ign ? "true" : "false");
  if (tb.ok) j += ",\"relays\":\"" + String(tb.relays) + "\"";
  j += ",\"parked\":" + String(parked ? "true" : "false");
  j += ",\"pi\":" + String(holdPi ? "true" : "false");
  j += ",\"rssi\":" + String(rssiDbm());
  j += ",\"batt_mv\":" + String(PMU.getBattVoltage());
  j += ",\"interval_s\":" + String(checkinS);
  j += ",\"fw\":\"" FW_VERSION "\"}";
  publish(String(MQTT_PREFIX) + "/status", "online", true);
  publish(String(MQTT_PREFIX) + "/state", j, true);
}

// ---- commands ----------------------------------------------------------------

static void handleCommand(const String &msg) {
  Serial.printf("[cmd] %s\n", msg.c_str());
  // The truck box keeps its Wi-Fi on while the Pi is up (W1), and may turn it off again after (W0).
  if (msg.indexOf("\"pi\":\"wake\"") >= 0) { holdPi = true; holdUntil = now() + PI_MAX_AWAKE_S; setWakePi(true); truckboxSend("W1"); }
  else if (msg.indexOf("\"pi\":\"sleep\"") >= 0) { holdPi = false; setWakePi(false); truckboxSend("W0"); }
  int r = msg.indexOf("\"relay\":\"");
  if (r >= 0) {
    String id = msg.substring(r + 9, msg.indexOf('"', r + 9));
    bool on = msg.indexOf("\"on\":true") >= 0;
    truckboxRelay(id.c_str(), on);
  }
  int iv = msg.indexOf("\"interval_s\":");
  if (iv >= 0) { long s = msg.substring(iv + 13).toInt(); if (s >= 60 && s <= 86400) checkinS = s; }
}

/** Read URCs for `ms`, running every +SMSUB command that arrives. */
static void listen(uint32_t ms) {
  String line;
  uint32_t t0 = millis();
  while (millis() - t0 < ms) {
    while (SerialAT.available()) {
      char c = SerialAT.read();
      if (c == '\n') {
        // +SMSUB: "slate/watch/command","{"pi":"wake"}"
        if (line.startsWith("+SMSUB:")) {
          int a = line.indexOf("\",\"");
          if (a > 0) handleCommand(line.substring(a + 3, line.lastIndexOf('"')));
        } else if (line.startsWith("+SMSTATE: 0")) mqttUp = false;
        line = "";
      } else if (c != '\r' && line.length() < 512) line += c;
    }
    delay(10);
  }
}

// ---- alerts on this wake -------------------------------------------------------

static bool checkAlerts() {
  time_t t = now();
  bool parked = tb.ign != 1;
  bool moved = false;
  if (fix.ok) {
    if (parked && (parkArm || !parkSet)) { parkLat = fix.lat; parkLon = fix.lon; parkSet = true; parkArm = false; }
    if (!parked) parkArm = true;                         // re-arm at the next park
    if (parked && parkSet) {
      float m = haversineM(parkLat, parkLon, fix.lat, fix.lon);
      if (m > MOVE_ALERT_M) {
        moved = true;
        if (t - lastMovedAlert > COOLDOWN_MOVED_S) {
          lastMovedAlert = t;
          // Miles, not meters; no coordinates in the text: the tap opens a map of where it is now.
          float mi = m / 1609.344f;
          String dist = mi < 0.1f ? String((int)(m * 3.28084f / 10) * 10) + " ft" : String(mi, 1) + " mi";
          alert("theft", "Truck moved", String("The truck is ") + dist + " from where it parked" + (tb.ok ? ", ignition off" : ", and the truck box isn't answering") + ". Tap to see where it is.",
                String("https://maps.apple.com/?q=Truck&ll=") + String(fix.lat, 5) + "," + String(fix.lon, 5));
        }
      }
    }
  }
  if (!isnan(v12) && v12 < LOST_12V && t - last12vAlert > COOLDOWN_12V_S) { last12vAlert = t; alert("low12v", "12V power lost", "The watch is running on its backup cell: the truck's 12V is gone or disconnected."); }
  else if (!isnan(v12) && parked && v12 < LOW_12V && t - last12vAlert > COOLDOWN_12V_S) { last12vAlert = t; alert("low12v", String("12V battery ") + String(v12, 2) + " V", String("The 12V battery is at ") + String(v12, 2) + " V."); }
  if (!isnan(tb.cabinF) && tb.cabinF >= HOT_F && t - lastHotAlert > COOLDOWN_HOT_S) { lastHotAlert = t; alert("cabinHot", String("Cabin ") + String((int)tb.cabinF) + "°F", String("The cab is at ") + String((int)tb.cabinF) + "°F. Check for pets or kids."); }
  if (parked && vibCount - vibReported >= VIB_ALERT_COUNT && t - lastVibAlert > COOLDOWN_VIB_S) { lastVibAlert = t; alert("motionParked", "Vibration at the truck", String(vibCount - vibReported) + " vibration events while parked."); }
  return moved;
}

// ---- sleep ---------------------------------------------------------------------

static void deepSleep() {
  // Holding the Pi: check back every minute so a "sleep" command isn't kept waiting.
  uint32_t s = holdPi && checkinS > PI_STATE_EVERY_S ? PI_STATE_EVERY_S : checkinS;
  esp_sleep_enable_timer_wakeup((uint64_t)s * 1000000ULL);
  // Vibration wakes only while parked (a moving truck shakes all the time).
  if (tb.ign != 1) {
    rtc_gpio_pullup_en((gpio_num_t)PIN_VIBRATION);
    rtc_gpio_pulldown_dis((gpio_num_t)PIN_VIBRATION);
    esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_VIBRATION, 0);
  }
  gpio_deep_sleep_hold_en();
  Serial.printf("[watch] sleeping %lu s\n", (unsigned long)s);
  Serial.flush();
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  bootCount++;
  esp_sleep_wakeup_cause_t why = esp_sleep_get_wakeup_cause();
  gpio_hold_dis((gpio_num_t)PIN_VIBRATION);

  if (why == ESP_SLEEP_WAKEUP_EXT0) {
    vibCount++;
    // A shake every few seconds shouldn't cost a modem session each time.
    if (timeSet && now() - lastVibWake < VIB_DEBOUNCE_S && vibCount - vibReported < VIB_ALERT_COUNT) { lastVibWake = now(); deepSleep(); }
    lastVibWake = now();
  }

  bool pmu = pmuBegin();
  v12 = read12v();
  truckboxQuery();
  if (tb.ign >= 0) lastIgn = tb.ign;

  if (!pmu || !modemOn()) { Serial.println("[watch] modem did not start"); if (pmu) pmuSleep(); deepSleep(); }
  modem.init();
  gnssFix();
  if (fix.ok) { lastLat = fix.lat; lastLon = fix.lon; lastFixAt = now(); }

  if (network() && mqttConnect()) {
    if (!lastDiscovery || now() - lastDiscovery > DISCOVERY_EVERY_S) discovery();
    bool moved = checkAlerts();
    report(moved);
    vibReported = vibCount;
    listen(CMD_WINDOW_MS);
    // Holding the Pi awake: stay connected, report every minute, until "sleep" or the limit.
    while (holdPi && mqttUp && now() < holdUntil) {
      listen(PI_STATE_EVERY_S * 1000UL);
      truckboxQuery();
      v12 = read12v();
      fix.ok = false;
      report(false);
    }
    if (holdPi && now() >= holdUntil) { holdPi = false; setWakePi(false); truckboxSend("W0"); }
  } else {
    Serial.println("[watch] no network this time");
  }
  modemOff();
  pmuSleep();
  if (!holdPi) setWakePi(false);
  deepSleep();
}

void loop() {}
