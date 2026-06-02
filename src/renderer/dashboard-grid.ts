export const TILE_MIN_WIDTH = 320;
export const TILE_MIN_HEIGHT = 240;
export const TILE_GAP = 12;
export const DASHBOARD_PADDING = 12;
export const SHUFFLE_INTERVAL_MS = 60_000;

export interface DashboardCapacity {
  columns: number;
  rows: number;
  capacity: number;
}

export interface DashboardLayout extends DashboardCapacity {
  tileWidth: number;
  tileHeight: number;
  gap: number;
  padding: number;
}

export function calculateDashboardLayout(width: number, height: number): DashboardLayout {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const availableWidth = Math.max(TILE_MIN_WIDTH, safeWidth - DASHBOARD_PADDING * 2);
  const availableHeight = Math.max(TILE_MIN_HEIGHT, safeHeight - DASHBOARD_PADDING * 2);
  const columns = Math.max(1, Math.floor((availableWidth + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP)));
  const rows = Math.max(1, Math.floor((availableHeight + TILE_GAP) / (TILE_MIN_HEIGHT + TILE_GAP)));
  const tileWidth = Math.floor((availableWidth - TILE_GAP * (columns - 1)) / columns);
  const tileHeight = Math.floor((availableHeight - TILE_GAP * (rows - 1)) / rows);

  return {
    columns,
    rows,
    capacity: columns * rows,
    tileWidth,
    tileHeight,
    gap: TILE_GAP,
    padding: DASHBOARD_PADDING
  };
}

export function calculateDashboardCapacity(width: number, height: number): DashboardCapacity {
  const { columns, rows, capacity } = calculateDashboardLayout(width, height);
  return { columns, rows, capacity };
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

export function pickDashboardPage<T extends { uuid: string; pinned?: boolean }>(
  tiles: T[],
  capacity: number,
  pageIndex: number
): T[] {
  const boundedCapacity = Math.max(0, capacity);
  if (boundedCapacity === 0) return [];
  if (tiles.length <= boundedCapacity) return [...tiles];

  const pinned = tiles.filter((tile) => tile.pinned === true);
  if (pinned.length >= boundedCapacity) {
    return pinned.slice(0, boundedCapacity);
  }

  const unpinned = tiles.filter((tile) => tile.pinned !== true);
  const slots = boundedCapacity - pinned.length;
  const pages = Math.max(1, Math.ceil(unpinned.length / slots));
  const normalizedPage = ((pageIndex % pages) + pages) % pages;
  const start = normalizedPage * slots;
  const slice = unpinned.slice(start, start + slots);

  return [...pinned, ...slice];
}

export function pickVisibleDashboardTiles<T extends { uuid: string; pinned?: boolean }>(
  tiles: T[],
  capacity: number,
  previous: T[] = []
): T[] {
  const boundedCapacity = Math.max(0, capacity);
  if (boundedCapacity === 0) return [];
  if (tiles.length <= boundedCapacity) return [...tiles];

  const pinnedTiles = tiles.filter((tile) => tile.pinned === true);
  if (pinnedTiles.length === 0) {
    return pickRandomTiles(tiles, boundedCapacity, previous);
  }

  if (pinnedTiles.length > boundedCapacity) {
    const previousPinned = previous.filter((tile) => tile.pinned === true);
    return pickRandomTiles(pinnedTiles, boundedCapacity, previousPinned);
  }

  const unpinnedSlots = boundedCapacity - pinnedTiles.length;
  const previousUnpinned = previous.filter((tile) => tile.pinned !== true);
  const unpinnedTiles = tiles.filter((tile) => tile.pinned !== true);

  return [
    ...pinnedTiles,
    ...pickRandomTiles(unpinnedTiles, unpinnedSlots, previousUnpinned)
  ];
}
