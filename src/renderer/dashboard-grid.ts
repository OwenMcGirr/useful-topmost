export const TILE_WIDTH = 400;
export const TILE_HEIGHT = 300;
export const TILE_GAP = 16;
export const DASHBOARD_PADDING = 24;
export const SHUFFLE_INTERVAL_MS = 60_000;

export interface DashboardCapacity {
  columns: number;
  rows: number;
  capacity: number;
}

export function calculateDashboardCapacity(width: number, height: number): DashboardCapacity {
  const availableWidth = Math.max(0, width - DASHBOARD_PADDING * 2);
  const availableHeight = Math.max(0, height - DASHBOARD_PADDING * 2);
  const columns = Math.max(1, Math.floor((availableWidth + TILE_GAP) / (TILE_WIDTH + TILE_GAP)));
  const rows = Math.max(1, Math.floor((availableHeight + TILE_GAP) / (TILE_HEIGHT + TILE_GAP)));

  return { columns, rows, capacity: columns * rows };
}

export function shuffleTiles<T>(items: T[]): T[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function sameUuidSet<T extends { uuid: string }>(left: T[], right: T[]): boolean {
  if (left.length !== right.length) return false;

  const leftIds = left.map((item) => item.uuid).sort();
  const rightIds = right.map((item) => item.uuid).sort();
  return leftIds.every((id, index) => id === rightIds[index]);
}

export function pickRandomTiles<T extends { uuid: string }>(
  items: T[],
  count: number,
  previous: T[] = []
): T[] {
  const boundedCount = Math.max(0, Math.min(count, items.length));
  if (items.length <= boundedCount) return [...items];
  if (boundedCount === 0) return [];

  let candidate = items.slice(0, boundedCount);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    candidate = shuffleTiles(items).slice(0, boundedCount);
    if (!sameUuidSet(candidate, previous)) return candidate;
  }

  if (previous.length === boundedCount) {
    const previousIds = new Set(previous.map((item) => item.uuid));
    const replacement = items.find((item) => !previousIds.has(item.uuid));

    if (replacement) {
      return [...candidate.slice(0, boundedCount - 1), replacement];
    }
  }

  return candidate;
}
