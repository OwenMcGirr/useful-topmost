export const TILE_MIN_WIDTH = 320;
export const TILE_MIN_HEIGHT = 240;
export const TILE_GAP = 12;
export const DASHBOARD_PADDING = 12;
export const SHUFFLE_INTERVAL_MS = 60_000;

export type TileSize = 'small' | 'wide' | 'large';

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

export interface DashboardLayoutItem {
  uuid: string;
  size?: TileSize;
}

export interface DashboardTileRect {
  uuid: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DashboardFillLayout {
  rects: DashboardTileRect[];
  capacityWeight: number;
  overflow: boolean;
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

export function tileWeight(size?: TileSize): number {
  switch (size) {
    case 'wide': return 2;
    case 'large': return 4;
    default: return 1;
  }
}

export function calculateDashboardWeightCapacity(width: number, height: number): number {
  return calculateDashboardCapacity(width, height).capacity;
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

function totalWeight<T extends { size?: TileSize }>(tiles: T[]): number {
  return tiles.reduce((sum, tile) => sum + tileWeight(tile.size), 0);
}

function weightedPages<T extends { uuid: string; size?: TileSize }>(
  tiles: T[],
  capacityWeight: number
): T[][] {
  const capacity = Math.max(1, capacityWeight);
  const pages: T[][] = [];
  let page: T[] = [];
  let pageWeight = 0;

  tiles.forEach((tile) => {
    const weight = tileWeight(tile.size);
    if (page.length > 0 && pageWeight + weight > capacity) {
      pages.push(page);
      page = [];
      pageWeight = 0;
    }
    page.push(tile);
    pageWeight += weight;
  });

  if (page.length > 0) pages.push(page);
  return pages;
}

function sameWeightedPage<T extends { uuid: string }>(left: T[], right: T[]): boolean {
  return sameUuidSet(left, right);
}

export function getDashboardPageCountByWeight<T extends { uuid: string; pinned?: boolean; size?: TileSize }>(
  tiles: T[],
  capacityWeight: number
): number {
  const capacity = Math.max(1, capacityWeight);
  if (tiles.length === 0 || totalWeight(tiles) <= capacity) return 1;

  const pinned = tiles.filter((tile) => tile.pinned === true);
  const pinnedWeight = totalWeight(pinned);
  if (pinnedWeight >= capacity) {
    return Math.max(1, weightedPages(pinned, capacity).length);
  }

  const unpinned = tiles.filter((tile) => tile.pinned !== true);
  return Math.max(1, weightedPages(unpinned, capacity - pinnedWeight).length);
}

export function pickDashboardPageByWeight<T extends { uuid: string; pinned?: boolean; size?: TileSize }>(
  tiles: T[],
  capacityWeight: number,
  pageIndex: number
): T[] {
  const capacity = Math.max(1, capacityWeight);
  if (capacity === 0 || tiles.length === 0) return [];
  if (totalWeight(tiles) <= capacity) return [...tiles];

  const pinned = tiles.filter((tile) => tile.pinned === true);
  const pinnedWeight = totalWeight(pinned);
  if (pinnedWeight >= capacity) {
    const pages = weightedPages(pinned, capacity);
    const normalizedPage = ((pageIndex % pages.length) + pages.length) % pages.length;
    return pages[normalizedPage] ?? [];
  }

  const unpinned = tiles.filter((tile) => tile.pinned !== true);
  const pages = weightedPages(unpinned, capacity - pinnedWeight);
  const normalizedPage = ((pageIndex % pages.length) + pages.length) % pages.length;
  return [...pinned, ...(pages[normalizedPage] ?? [])];
}

export function pickVisibleDashboardTilesByWeight<T extends { uuid: string; pinned?: boolean; size?: TileSize }>(
  tiles: T[],
  capacityWeight: number,
  previous: T[] = []
): T[] {
  const capacity = Math.max(1, capacityWeight);
  if (tiles.length === 0) return [];
  if (totalWeight(tiles) <= capacity) return [...tiles];

  const pageCount = getDashboardPageCountByWeight(tiles, capacity);
  let candidate = pickDashboardPageByWeight(tiles, capacity, 0);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pageIndex = Math.floor(Math.random() * pageCount);
    candidate = pickDashboardPageByWeight(tiles, capacity, pageIndex);
    if (!sameWeightedPage(candidate, previous)) return candidate;
  }

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    candidate = pickDashboardPageByWeight(tiles, capacity, pageIndex);
    if (!sameWeightedPage(candidate, previous)) return candidate;
  }

  return candidate;
}

interface DashboardLayoutRow {
  items: DashboardLayoutItem[];
  weight: number;
}

function partitionRows(tiles: DashboardLayoutItem[], rowCount: number): DashboardLayoutRow[] {
  if (rowCount <= 1) return [{ items: tiles, weight: totalWeight(tiles) }];

  const rows: DashboardLayoutRow[] = [];
  let current: DashboardLayoutItem[] = [];
  let currentWeight = 0;
  const total = totalWeight(tiles);
  const target = total / rowCount;

  tiles.forEach((tile) => {
    const weight = tileWeight(tile.size);
    const remainingItems = tiles.length - rows.reduce((sum, row) => sum + row.items.length, 0) - current.length;
    const remainingRows = rowCount - rows.length - 1;
    const shouldBreak = current.length > 0
      && rows.length < rowCount - 1
      && remainingItems > remainingRows
      && currentWeight + weight > target
      && Math.abs(target - currentWeight) <= Math.abs(target - (currentWeight + weight));

    if (shouldBreak) {
      rows.push({ items: current, weight: currentWeight });
      current = [];
      currentWeight = 0;
    }

    current.push(tile);
    currentWeight += weight;
  });

  rows.push({ items: current, weight: currentWeight });

  while (rows.length < rowCount) {
    rows.push({ items: [], weight: 0 });
  }

  return rows.filter((row) => row.items.length > 0);
}

function scoreRows(
  rows: DashboardLayoutRow[],
  availableWidth: number,
  availableHeight: number,
  total: number
): number {
  const targetAspect = 4 / 3;
  const rowGapTotal = TILE_GAP * Math.max(0, rows.length - 1);
  const drawableHeight = Math.max(1, availableHeight - rowGapTotal);
  const targetWeight = total / rows.length;
  let aspectScore = 0;
  let unevenScore = 0;

  rows.forEach((row) => {
    const rowHeight = drawableHeight * (row.weight / total);
    const itemGapTotal = TILE_GAP * Math.max(0, row.items.length - 1);
    const drawableWidth = Math.max(1, availableWidth - itemGapTotal);

    row.items.forEach((item) => {
      const itemWidth = drawableWidth * (tileWeight(item.size) / row.weight);
      const aspect = itemWidth / Math.max(1, rowHeight);
      aspectScore += Math.abs(Math.log(aspect / targetAspect)) * tileWeight(item.size);
    });

    unevenScore += Math.abs(row.weight - targetWeight) / Math.max(1, targetWeight);
  });

  return aspectScore / total + unevenScore * 0.15;
}

export function calculateDashboardFillLayout(
  width: number,
  height: number,
  visibleTiles: DashboardLayoutItem[]
): DashboardFillLayout {
  const capacityWeight = calculateDashboardWeightCapacity(width, height);
  if (visibleTiles.length === 0) {
    return { rects: [], capacityWeight, overflow: false };
  }

  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const availableWidth = Math.max(1, safeWidth - DASHBOARD_PADDING * 2);
  const availableHeight = Math.max(1, safeHeight - DASHBOARD_PADDING * 2);
  const total = Math.max(1, totalWeight(visibleTiles));
  let bestRows = partitionRows(visibleTiles, 1);
  let bestScore = scoreRows(bestRows, availableWidth, availableHeight, total);

  for (let rowCount = 2; rowCount <= visibleTiles.length; rowCount += 1) {
    const rows = partitionRows(visibleTiles, rowCount);
    const score = scoreRows(rows, availableWidth, availableHeight, total);
    if (score < bestScore) {
      bestRows = rows;
      bestScore = score;
    }
  }

  const rowGapTotal = TILE_GAP * Math.max(0, bestRows.length - 1);
  const drawableHeight = Math.max(1, availableHeight - rowGapTotal);
  const rects: DashboardTileRect[] = [];
  let top = DASHBOARD_PADDING;

  bestRows.forEach((row, rowIndex) => {
    const rowHeight = rowIndex === bestRows.length - 1
      ? Math.max(1, DASHBOARD_PADDING + availableHeight - top)
      : Math.max(1, Math.floor(drawableHeight * (row.weight / total)));
    const itemGapTotal = TILE_GAP * Math.max(0, row.items.length - 1);
    const drawableWidth = Math.max(1, availableWidth - itemGapTotal);
    let left = DASHBOARD_PADDING;

    row.items.forEach((item, itemIndex) => {
      const itemWidth = itemIndex === row.items.length - 1
        ? Math.max(1, DASHBOARD_PADDING + availableWidth - left)
        : Math.max(1, Math.floor(drawableWidth * (tileWeight(item.size) / row.weight)));
      rects.push({
        uuid: item.uuid,
        left,
        top,
        width: itemWidth,
        height: rowHeight
      });
      left += itemWidth + TILE_GAP;
    });

    top += rowHeight + TILE_GAP;
  });

  return {
    rects,
    capacityWeight,
    overflow: total > capacityWeight
  };
}
