// Slate watch: pins, timings and alert thresholds. Everything you might change
// is here; secrets (APN, broker, passwords) are in secrets.h.
#pragma once

// ---- LilyGO T-SIM7080G-S3: fixed by the board (from LilyGO's pin card) -----
#define BOARD_MODEM_PWR_PIN 41
#define BOARD_MODEM_DTR_PIN 42
#define BOARD_MODEM_RI_PIN 3
#define BOARD_MODEM_RXD_PIN 4    // ESP RX  <- modem TX
#define BOARD_MODEM_TXD_PIN 5    // ESP TX  -> modem RX
#define BOARD_I2C_SDA 15         // AXP2101 power manager
#define BOARD_I2C_SCL 7
#define BOARD_PMU_IRQ 6

// ---- Ours, on the board's header. CHECK against your board's pin card -------
#define PIN_VBAT_SENSE 1         // ADC1: truck 12V through 47k (top) / 10k (bottom), 100 nF to GND
#define VBAT_DIVIDER 5.7f        // (47 + 10) / 10
#define PIN_WAKE_PI 2            // HIGH = keep the Pi on: drives a PC817 into the car power board's IGN input
#define PIN_VIBRATION 13         // SW-18010P spring switch to GND (internal pull-up, 0 uA idle). RTC GPIO: wakes deep sleep
#define PIN_TB_RX 17             // <- truck box TX (relay board GPIO5)
#define PIN_TB_TX 18             // -> truck box RX (relay board GPIO39, 10k pull-up to 3V3 there)
#define TB_BAUD 9600

// ---- Timing --------------------------------------------------------------------
#define CHECKIN_S_DEFAULT 600    // report every 10 min while parked (the "interval_s" command changes it, 60..86400)
#define GNSS_TIMEOUT_S 75        // give up on a fix after this (cold start can take longer; hot start ~5 s)
#define NET_TIMEOUT_S 90         // LTE-M attach
#define CMD_WINDOW_MS 4000       // after publishing, listen this long for queued commands (QoS 1, persistent session)
#define PI_MAX_AWAKE_S 3600      // a remote wake holds the Pi on at most this long without a "sleep" command
#define PI_STATE_EVERY_S 60      // while holding the Pi on, report this often
#define VIB_DEBOUNCE_S 20        // vibration wakes closer together than this only count, no check-in
#define DISCOVERY_EVERY_S 86400  // re-send Home Assistant discovery once a day

// ---- Alerts (published to <prefix>/alert; HA turns them into phone pushes) -----
#define MOVE_ALERT_M 200.0f      // moved this far from where it parked, ignition off
#define LOW_12V 12.0f            // V, resting lead-acid
#define LOST_12V 6.0f            // V: the watch is on its backup cell, 12V is gone
#define HOT_F 95.0f              // cabin, from the truck box's sensor
#define VIB_ALERT_COUNT 3        // vibration events between reports that count as "someone's at it"
#define COOLDOWN_MOVED_S 1800
#define COOLDOWN_12V_S 14400
#define COOLDOWN_HOT_S 1800
#define COOLDOWN_VIB_S 900

#define FW_VERSION "watch-0.1.0"
