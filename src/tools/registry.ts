import type { Tool } from "./types.js";

const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Holds the tools the agent may use. Names must be unique and API-legal. */
export class ToolRegistry {
  private readonly byName = new Map<string, Tool>();

  register(tool: Tool): this {
    if (!NAME_PATTERN.test(tool.name)) {
      throw new Error(`Invalid tool name "${tool.name}" (letters, digits, _ and - only, max 64).`);
    }
    if (this.byName.has(tool.name)) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    this.byName.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.byName.get(name);
  }

  list(): Tool[] {
    return [...this.byName.values()];
  }

  get size(): number {
    return this.byName.size;
  }
}
