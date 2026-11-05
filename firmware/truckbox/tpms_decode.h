// BLE TPMS frame decoder for generic external valve-cap sensors
// (ZEEPIN / TP630 / "TPMS1_xxxxxx"). See packages/tpms_ble.yaml for the layout.
// x is the manufacturer data AFTER the 2-byte company id (0x0100).
#pragma once
#include <cstdint>
#include <vector>

struct TpmsFrame {
  bool ok;
  int sensor_no;   // 1-based, from x[0]
  float psi;
  float temp_f;
  float temp_c;
  int battery;     // %
  bool alarm;
};

static inline TpmsFrame tpms_parse(const std::vector<uint8_t> &x) {
  TpmsFrame f{};
  if (x.size() < 16) return f;
  uint32_t pa = (uint32_t) x[6] | ((uint32_t) x[7] << 8) | ((uint32_t) x[8] << 16) | ((uint32_t) x[9] << 24);
  int32_t tc = (int32_t) ((uint32_t) x[10] | ((uint32_t) x[11] << 8) | ((uint32_t) x[12] << 16) | ((uint32_t) x[13] << 24));
  f.sensor_no = (x[0] & 0x0F) + 1;
  f.psi = pa / 6894.757f;
  f.temp_c = tc / 100.0f;
  f.temp_f = f.temp_c * 9.0f / 5.0f + 32.0f;
  f.battery = x[14];
  f.alarm = (x[15] & 0x01) != 0;
  // Sanity bounds: a garbage frame must not become a reading.
  f.ok = f.psi >= 0 && f.psi <= 150 && f.temp_c >= -50 && f.temp_c <= 150 && f.battery <= 100;
  return f;
}
