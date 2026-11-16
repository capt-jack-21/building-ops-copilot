import type {
  Alarm,
  Asset,
  AssetType,
  Building,
  Meter,
  Protocol,
  Quantity,
  Reading,
} from "../domain/types.js";

export interface SeedData {
  buildings: Building[];
  assets: Asset[];
  meters: Meter[];
  readings: Map<string, Reading[]>;
  alarms: Alarm[];
}

const STEP_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const STEPS = 7 * 96; // 7 days of 15-minute readings

const UNITS: Record<Quantity, string> = {
  power_kw: "kW",
  temp_c: "degC",
  level_pct: "%",
  flow_lps: "L/s",
};

/** Small seeded PRNG: same seed, same sequence. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Occupancy-style load curve: low at night, peaking mid-day (UTC hour in, 0.35..1 out). */
function load(hourUtc: number): number {
  const x = (hourUtc - 7) / 6;
  return 0.35 + 0.65 * Math.exp(-x * x);
}

interface Ctx {
  ms: number;
  hour: number;
  progress: number; // 0..1 across the 7-day window
  noise: () => number; // -1..1
}
type Signal = (c: Ctx) => number;

const BUILDING_SPECS: Array<{ building: Building; scale: number; fuel: [number, number] }> = [
  {
    building: { id: "bld-01", name: "Nila Tower", city: "Chennai", areaSqm: 42000 },
    scale: 1,
    fuel: [85, 62],
  },
  {
    building: { id: "bld-02", name: "Cauvery Tech Park", city: "Coimbatore", areaSqm: 26000 },
    scale: 0.6,
    fuel: [60, 17], // ends low, so a low-fuel alarm makes sense
  },
];

export function generateSeed(now: Date = new Date(), seed = 42): SeedData {
  const rand = mulberry32(seed);
  const noise = (): number => rand() * 2 - 1;

  const end = Math.floor(now.getTime() / STEP_MS) * STEP_MS;
  const start = end - (STEPS - 1) * STEP_MS;
  const tripFrom = end - 15 * HOUR_MS;
  const tripTo = end - 11 * HOUR_MS;
  const inTrip = (buildingId: string, ms: number): boolean =>
    buildingId === "bld-01" && ms >= tripFrom && ms <= tripTo;

  const buildings: Building[] = [];
  const assets: Asset[] = [];
  const meters: Meter[] = [];
  const readings = new Map<string, Reading[]>();

  for (const { building: b, scale, fuel } of BUILDING_SPECS) {
    const n = b.id.slice(-2);
    buildings.push(b);

    const addMeter = (
      assetKey: string,
      assetName: string,
      assetType: AssetType,
      meterKey: string,
      meterName: string,
      quantity: Quantity,
      protocol: Protocol,
      signal: Signal,
    ): void => {
      const assetId = `a-${n}-${assetKey}`;
      if (!assets.some((a) => a.id === assetId)) {
        assets.push({ id: assetId, buildingId: b.id, name: assetName, type: assetType });
      }
      const meterId = `m-${n}-${meterKey}`;
      meters.push({
        id: meterId,
        assetId,
        buildingId: b.id,
        name: meterName,
        quantity,
        unit: UNITS[quantity],
        protocol,
      });
      const rows: Reading[] = [];
      for (let i = 0; i < STEPS; i++) {
        const ms = start + i * STEP_MS;
        const d = new Date(ms);
        const ctx: Ctx = {
          ms,
          hour: d.getUTCHours() + d.getUTCMinutes() / 60,
          progress: i / (STEPS - 1),
          noise,
        };
        let v = signal(ctx);
        if (quantity !== "temp_c") v = Math.max(0, v);
        rows.push({ ts: d.toISOString(), value: Math.round(v * 100) / 100 });
      }
      readings.set(meterId, rows);
    };

    addMeter("main", "Main incomer", "energy_meter", "main-kw", "Main incomer power", "power_kw", "modbus",
      (c) => 420 * scale * load(c.hour) + 8 * c.noise());

    addMeter("chiller-1", "Chiller 1", "chiller", "ch1-kw", "Chiller 1 power", "power_kw", "bacnet",
      (c) => 180 * scale * load(c.hour) + 4 * c.noise());
    addMeter("chiller-1", "Chiller 1", "chiller", "ch1-temp", "Chiller 1 supply water temp", "temp_c", "bacnet",
      (c) => 6.5 + 0.3 * c.noise());

    addMeter("chiller-2", "Chiller 2", "chiller", "ch2-kw", "Chiller 2 power", "power_kw", "bacnet",
      (c) => (inTrip(b.id, c.ms) ? 2 + Math.abs(c.noise()) : 170 * scale * load(c.hour) + 4 * c.noise()));
    addMeter("chiller-2", "Chiller 2", "chiller", "ch2-temp", "Chiller 2 supply water temp", "temp_c", "bacnet",
      (c) => (inTrip(b.id, c.ms) ? 13 + 0.6 * c.noise() : 6.6 + 0.3 * c.noise()));

    addMeter("ahu-1", "AHU 1", "ahu", "ahu1-temp", "AHU 1 supply air temp", "temp_c", "bacnet",
      (c) => 14 + 0.5 * c.noise());

    addMeter("fuel-1", "Generator 1 diesel tank", "fuel_tank", "fuel-pct", "Generator 1 fuel level", "level_pct", "modbus",
      (c) => fuel[0] + (fuel[1] - fuel[0]) * c.progress + 0.2 * c.noise());

    addMeter("pump-1", "Chilled water pump 1", "pump", "pump1-flow", "Pump 1 flow", "flow_lps", "modbus",
      (c) => 24 * scale * (0.4 + 0.6 * load(c.hour)) + 0.5 * c.noise());
  }

  const iso = (ms: number): string => new Date(ms).toISOString();
  const alarms: Alarm[] = [
    {
      id: "al-001", buildingId: "bld-01", assetId: "a-01-chiller-2", severity: "critical",
      code: "CH2_TRIP", message: "Chiller 2 compressor safety trip",
      raisedAt: iso(tripFrom), clearedAt: iso(tripTo), acknowledged: true,
    },
    {
      id: "al-002", buildingId: "bld-01", assetId: "a-01-chiller-2", severity: "warning",
      code: "CH2_HIGH_SUPPLY_TEMP", message: "Chiller 2 supply water temperature above limit",
      raisedAt: iso(tripFrom + 30 * 60 * 1000), clearedAt: iso(tripTo + HOUR_MS), acknowledged: true,
    },
    {
      id: "al-003", buildingId: "bld-02", assetId: "a-02-fuel-1", severity: "warning",
      code: "GEN1_FUEL_LOW", message: "Generator 1 diesel level below 20%",
      raisedAt: iso(end - 12 * HOUR_MS), clearedAt: null, acknowledged: false,
    },
    {
      id: "al-004", buildingId: "bld-01", assetId: "a-01-ahu-1", severity: "info",
      code: "AHU1_FILTER_DP", message: "AHU 1 filter differential pressure high",
      raisedAt: iso(end - 48 * HOUR_MS), clearedAt: null, acknowledged: false,
    },
    {
      id: "al-005", buildingId: "bld-02", assetId: "a-02-pump-1", severity: "warning",
      code: "PUMP1_LOW_FLOW", message: "Chilled water pump 1 low flow",
      raisedAt: iso(end - 72 * HOUR_MS), clearedAt: iso(end - 72 * HOUR_MS + 40 * 60 * 1000), acknowledged: true,
    },
  ];

  return { buildings, assets, meters, readings, alarms };
}
