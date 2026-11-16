import type {
  Alarm,
  AlarmFilter,
  Asset,
  Building,
  Meter,
  MeterFilter,
  NewTicket,
  Reading,
  TelemetryRepository,
  Ticket,
} from "../domain/types.js";
import type { SeedData } from "./seed.js";

export class InMemoryRepository implements TelemetryRepository {
  private readonly tickets: Ticket[] = [];

  constructor(private readonly data: SeedData) {}

  async listBuildings(): Promise<Building[]> {
    return this.data.buildings;
  }

  async listAssets(buildingId?: string): Promise<Asset[]> {
    return this.data.assets.filter((a) => !buildingId || a.buildingId === buildingId);
  }

  async listMeters(filter: MeterFilter = {}): Promise<Meter[]> {
    return this.data.meters.filter((m) => {
      if (filter.buildingId && m.buildingId !== filter.buildingId) return false;
      if (filter.assetType) {
        const asset = this.data.assets.find((a) => a.id === m.assetId);
        if (asset?.type !== filter.assetType) return false;
      }
      return true;
    });
  }

  async getMeter(meterId: string): Promise<Meter | undefined> {
    return this.data.meters.find((m) => m.id === meterId);
  }

  async getLatest(meterId: string): Promise<Reading | undefined> {
    const rows = this.data.readings.get(meterId);
    return rows?.[rows.length - 1];
  }

  async queryRange(meterId: string, fromIso: string, toIso: string): Promise<Reading[]> {
    const rows = this.data.readings.get(meterId);
    if (!rows) return [];
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    return rows.filter((r) => {
      const ms = Date.parse(r.ts);
      return ms >= from && ms <= to;
    });
  }

  async listAlarms(filter: AlarmFilter = {}): Promise<Alarm[]> {
    const since = filter.since ? Date.parse(filter.since) : undefined;
    return this.data.alarms
      .filter((a) => {
        if (filter.buildingId && a.buildingId !== filter.buildingId) return false;
        if (filter.severity && a.severity !== filter.severity) return false;
        if (filter.activeOnly && a.clearedAt !== null) return false;
        if (since !== undefined && Date.parse(a.raisedAt) < since) return false;
        return true;
      })
      .sort((x, y) => Date.parse(y.raisedAt) - Date.parse(x.raisedAt));
  }

  async createTicket(input: NewTicket): Promise<Ticket> {
    const ticket: Ticket = {
      ...input,
      id: `T-${String(this.tickets.length + 1).padStart(4, "0")}`,
      createdAt: new Date().toISOString(),
    };
    this.tickets.push(ticket);
    return ticket;
  }
}

