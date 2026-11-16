import type { Alarm, AssetType, Meter, Quantity, Severity, TelemetryRepository } from "../domain/types.js";
import { HOUR_MS } from "../tools/util.js";

export type TwinStatus = "ok" | "recovered" | "info" | "warning" | "critical";

export interface TwinAlarm {
  code: string;
  severity: Severity;
  message: string;
  raisedAt: string;
  active: boolean;
}
export interface TwinHeadline {
  meterId: string;
  quantity: Quantity;
  value: number;
  unit: string;
  ts: string;
}
export interface TwinAsset {
  id: string;
  name: string;
  type: AssetType;
  status: TwinStatus;
  alarms: TwinAlarm[];
  headline: TwinHeadline | null;
}
export interface TwinBuilding {
  id: string;
  name: string;
  city: string;
  status: TwinStatus;
  assets: TwinAsset[];
}
export interface TwinSnapshot {
  generatedAt: string;
  buildings: TwinBuilding[];
  /** meter id -> asset id, so the UI can map a tool call on a meter to a tile */
  meters: Record<string, string>;
}

const RANK: Record<TwinStatus, number> = { ok: 0, recovered: 1, info: 2, warning: 3, critical: 4 };
const HEADLINE_ORDER: Quantity[] = ["power_kw", "level_pct", "flow_lps", "temp_c"];
const RECENT_MS = 24 * HOUR_MS;

const worst = (a: TwinStatus, b: TwinStatus): TwinStatus => (RANK[b] > RANK[a] ? b : a);

/** Active alarms colour an asset by severity; alarms cleared in the last 24 h show as "recovered". */
function assessAlarms(alarms: Alarm[], nowMs: number): { status: TwinStatus; list: TwinAlarm[] } {
  let status: TwinStatus = "ok";
  const list: TwinAlarm[] = [];
  for (const alarm of alarms) {
    const clearedMs = alarm.clearedAt === null ? null : Date.parse(alarm.clearedAt);
    const active = clearedMs === null;
    const recent = clearedMs !== null && nowMs - clearedMs <= RECENT_MS;
    if (!active && !recent) continue;
    status = worst(status, active ? alarm.severity : "recovered");
    list.push({ code: alarm.code, severity: alarm.severity, message: alarm.message, raisedAt: alarm.raisedAt, active });
  }
  return { status, list };
}

export async function buildTwin(repo: TelemetryRepository, now: Date): Promise<TwinSnapshot> {
  const [buildings, assets, meters, alarms] = await Promise.all([
    repo.listBuildings(),
    repo.listAssets(),
    repo.listMeters(),
    repo.listAlarms(),
  ]);
  const nowMs = now.getTime();

  const alarmsByAsset = new Map<string, Alarm[]>();
  for (const alarm of alarms) {
    const list = alarmsByAsset.get(alarm.assetId) ?? [];
    list.push(alarm);
    alarmsByAsset.set(alarm.assetId, list);
  }
  const metersByAsset = new Map<string, Meter[]>();
  for (const meter of meters) {
    const list = metersByAsset.get(meter.assetId) ?? [];
    list.push(meter);
    metersByAsset.set(meter.assetId, list);
  }

  const headlineFor = async (assetId: string): Promise<TwinHeadline | null> => {
    const own = metersByAsset.get(assetId) ?? [];
    const meter = HEADLINE_ORDER.map((q) => own.find((m) => m.quantity === q)).find((m): m is Meter => m !== undefined);
    if (!meter) return null;
    const reading = await repo.getLatest(meter.id);
    if (!reading) return null;
    return {
      meterId: meter.id,
      quantity: meter.quantity,
      value: Math.round(reading.value * 10) / 10,
      unit: meter.unit,
      ts: reading.ts,
    };
  };

  const built = await Promise.all(
    assets.map(async (asset) => {
      const { status, list } = assessAlarms(alarmsByAsset.get(asset.id) ?? [], nowMs);
      const twin: TwinAsset = {
        id: asset.id,
        name: asset.name,
        type: asset.type,
        status,
        alarms: list,
        headline: await headlineFor(asset.id),
      };
      return { buildingId: asset.buildingId, twin };
    }),
  );

  return {
    generatedAt: now.toISOString(),
    meters: Object.fromEntries(meters.map((m) => [m.id, m.assetId])),
    buildings: buildings.map((b) => {
      const own = built.filter((x) => x.buildingId === b.id).map((x) => x.twin);
      return {
        id: b.id,
        name: b.name,
        city: b.city,
        status: own.reduce<TwinStatus>((acc, a) => worst(acc, a.status), "ok"),
        assets: own,
      };
    }),
  };
}
