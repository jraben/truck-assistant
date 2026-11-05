// Home Assistant discovery for Track D: maintenance due, last backup, updates,
// estimated odometer. One retained JSON on <truck>/brain/ops. Pure builders.
import { statusTopic, type Discovery } from '../ha.ts';
import { PROJECT_NAME } from '../project.ts';

export const opsTopic = (id: string) => `${id}/brain/ops`;

export type OpsSummary = {
  maintenanceDue: number; maintenanceSoon: number;
  dueItems: string[];               // names, due first
  lastBackupAt: string | null; lastBackupOk: boolean | null; backupTarget: string | null;
  updateAvailable: string | null;   // tag, or null
  version: string;
  odometerEst: number | null;
};

export function opsDiscovery(id: string, version: string): Discovery[] {
  const device = { identifiers: [`${id}_cockpit`], name: 'Slate Truck', manufacturer: `${PROJECT_NAME} (DIY)`, model: 'Pi brain', sw_version: version };
  const common = { availability_topic: statusTopic(id), payload_available: 'online', payload_not_available: 'offline', device, state_topic: opsTopic(id) };
  const s = (obj: string, name: string, extra: Record<string, unknown>, domain = 'sensor'): Discovery => ({
    topic: `homeassistant/${domain}/${id}/${obj}/config`,
    payload: { name, unique_id: `${id}_${obj}`, object_id: `${id}_${obj}`, ...common, ...extra },
  });
  return [
    s('maintenance_due', 'Maintenance due', { icon: 'mdi:wrench-clock', state_class: 'measurement', value_template: '{{ value_json.maintenanceDue }}', json_attributes_topic: opsTopic(id), json_attributes_template: '{{ {"items": value_json.dueItems, "soon": value_json.maintenanceSoon} | tojson }}' }),
    s('last_backup', 'Last backup', { device_class: 'timestamp', icon: 'mdi:backup-restore', value_template: '{{ value_json.lastBackupAt if value_json.lastBackupAt else None }}', json_attributes_topic: opsTopic(id), json_attributes_template: '{{ {"ok": value_json.lastBackupOk, "target": value_json.backupTarget} | tojson }}' }),
    s('backup_problem', 'Backup problem', { device_class: 'problem', value_template: "{{ 'ON' if value_json.lastBackupOk == false else 'OFF' }}" }, 'binary_sensor'),
    s('update_available', 'Software update', { icon: 'mdi:update', value_template: "{{ value_json.updateAvailable or 'up to date' }}", json_attributes_topic: opsTopic(id), json_attributes_template: '{{ {"installed": value_json.version} | tojson }}' }),
    s('odometer_est', 'Odometer (estimated)', { unit_of_measurement: 'mi', device_class: 'distance', state_class: 'total_increasing', icon: 'mdi:counter', value_template: '{{ value_json.odometerEst if value_json.odometerEst is not none else None }}' }),
  ];
}
