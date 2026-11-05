// Home Assistant MQTT discovery for the brain's own entities. Pure builders.

export type Discovery = { topic: string; payload: Record<string, unknown> };

export const stateTopic = (id: string) => `${id}/brain/state`;
export const statusTopic = (id: string) => `${id}/brain/status`;
export const chargesTopic = (id: string) => `${id}/brain/charges`;
export const tripEndedTopic = (id: string) => `${id}/brain/trip/ended`;

export function discoveryConfigs(id: string, version: string): Discovery[] {
  const device = { identifiers: [`${id}_cockpit`], name: 'Slate Truck', manufacturer: 'Slate Cockpit (DIY)', model: 'Pi brain', sw_version: version };
  const common = { availability_topic: statusTopic(id), payload_available: 'online', payload_not_available: 'offline', device };
  const sensor = (obj: string, name: string, extra: Record<string, unknown>): Discovery => ({
    topic: `homeassistant/sensor/${id}/${obj}/config`,
    payload: { name, unique_id: `${id}_${obj}`, object_id: `${id}_${obj}`, state_topic: stateTopic(id), ...common, ...extra },
  });
  return [
    sensor('soc', 'State of charge', { unit_of_measurement: '%', device_class: 'battery', state_class: 'measurement', value_template: '{{ value_json.soc }}', json_attributes_topic: stateTopic(id), json_attributes_template: '{{ {"source": value_json.socSource} | tojson }}' }),
    sensor('range', 'Range estimate', { unit_of_measurement: 'mi', device_class: 'distance', state_class: 'measurement', icon: 'mdi:map-marker-distance', value_template: '{{ value_json.rangeMi | round(0) if value_json.rangeMi is not none else None }}' }),
    sensor('speed', 'Speed', { unit_of_measurement: 'mph', device_class: 'speed', state_class: 'measurement', value_template: '{{ value_json.speedMph | round(0) if value_json.speedMph is not none else None }}' }),
    sensor('now_playing', 'Now playing', { icon: 'mdi:music', value_template: '{{ value_json.nowPlaying.title if value_json.nowPlaying and value_json.nowPlaying.title else None }}', json_attributes_topic: stateTopic(id), json_attributes_template: '{{ {"artist": value_json.nowPlaying.artist, "album": value_json.nowPlaying.album, "source": value_json.nowPlaying.source} | tojson if value_json.nowPlaying else "{}" }}' }),
    sensor('trip_distance', 'Trip distance', { unit_of_measurement: 'mi', device_class: 'distance', icon: 'mdi:road-variant', value_template: '{{ value_json.trip.miles if value_json.trip else None }}' }),
    sensor('place', 'Current place', { icon: 'mdi:map-marker-radius', value_template: "{{ (value_json.place.name or 'Unnamed stop') if value_json.place else ('Driving' if value_json.trip else None) }}", json_attributes_topic: stateTopic(id), json_attributes_template: '{{ {"since": value_json.place.since, "stop_id": value_json.place.stopId} | tojson if value_json.place else "{}" }}' }),
    sensor('driver', 'Driver', { icon: 'mdi:account', value_template: '{{ value_json.driver.name if value_json.driver else None }}' }),
    {
      topic: `homeassistant/device_tracker/${id}/location/config`,
      payload: {
        name: 'Location', unique_id: `${id}_location`, object_id: id, source_type: 'gps', ...common,
        json_attributes_topic: stateTopic(id),
        json_attributes_template: '{{ {"latitude": value_json.gps.lat, "longitude": value_json.gps.lon, "gps_accuracy": 10, "heading": value_json.gps.headingDeg} | tojson if value_json.gps and value_json.gps.fix else "{}" }}',
      },
    },
    {
      topic: `homeassistant/sensor/${id}/charge_cost_month/config`,
      payload: { name: 'Charging cost this month', unique_id: `${id}_charge_cost_month`, object_id: `${id}_charge_cost_month`, state_topic: chargesTopic(id), unit_of_measurement: 'USD', device_class: 'monetary', icon: 'mdi:ev-station', value_template: '{{ value_json.monthCost }}', ...common },
    },
    {
      topic: `homeassistant/sensor/${id}/charge_cost_last/config`,
      payload: { name: 'Last charge cost', unique_id: `${id}_charge_cost_last`, object_id: `${id}_charge_cost_last`, state_topic: chargesTopic(id), unit_of_measurement: 'USD', device_class: 'monetary', icon: 'mdi:receipt-text', value_template: '{{ value_json.lastSessionCost }}', json_attributes_topic: chargesTopic(id), json_attributes_template: '{{ {"at": value_json.lastSessionAt, "place": value_json.lastSessionPlace} | tojson }}', ...common },
    },
  ];
}

/**
 * HA's entity state, if Home Assistant mirrors it over MQTT with
 * mqtt_statestream (base_topic: homeassistant). "sensor.x" -> "homeassistant/sensor/x/state".
 */
export const haEntityStateTopic = (entity: string) => {
  const [domain, obj] = entity.split('.');
  return `homeassistant/${domain}/${obj}/state`;
};
