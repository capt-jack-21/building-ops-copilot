export type AssetType = "chiller" | "ahu" | "generator" | "energy_meter" | "fuel_tank" | "pump";
export type Quantity = "power_kw" | "temp_c" | "level_pct" | "flow_lps";
export type Protocol = "bacnet" | "modbus";
export type Severity = "info" | "warning" | "critical";
export type TicketPriority = "low" | "medium" | "high" | "critical";

export interface Building {
  id: string;
  name: string;
  city: string;
  areaSqm: number;
}

export interface Asset {
  id: string;
  buildingId: string;
  name: string;
  type: AssetType;
}

export interface Meter {
  id: string;
  assetId: string;
  buildingId: string;
  name: string;
  quantity: Quantity;
  unit: string;
  protocol: Protocol;
}

/** One telemetry sample. ts is an ISO-8601 UTC timestamp. */
export interface Reading {
  ts: string;
  value: number;
}

export interface Alarm {
  id: string;
  buildingId: string;
  assetId: string;
  severity: Severity;
  code: string;
  message: string;
  raisedAt: string;
  clearedAt: string | null;
  acknowledged: boolean;
}

export interface NewTicket {
  title: string;
  description: string;
  priority: TicketPriority;
  assetId?: string;
}

export interface Ticket extends NewTicket {
  id: string;
  createdAt: string;
}

export interface MeterFilter {
  buildingId?: string;
  assetType?: AssetType;
}

export interface AlarmFilter {
  buildingId?: string;
  severity?: Severity;
  activeOnly?: boolean;
  since?: string;
}

/**
 * Everything the agent's tools may ask of the data layer.
 * Async on purpose: a real implementation (TimescaleDB, etc.) is async too.
 */
export interface TelemetryRepository {
  listBuildings(): Promise<Building[]>;
  listAssets(buildingId?: string): Promise<Asset[]>;
  listMeters(filter?: MeterFilter): Promise<Meter[]>;
  getMeter(meterId: string): Promise<Meter | undefined>;
  getLatest(meterId: string): Promise<Reading | undefined>;
  queryRange(meterId: string, fromIso: string, toIso: string): Promise<Reading[]>;
  listAlarms(filter?: AlarmFilter): Promise<Alarm[]>;
  createTicket(input: NewTicket): Promise<Ticket>;
}

