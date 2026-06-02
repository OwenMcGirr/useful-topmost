import { describe, expect, it, vi } from 'vitest';
import {
  DASHBOARD_PADDING,
  TILE_GAP,
  TILE_MIN_HEIGHT,
  TILE_MIN_WIDTH,
  calculateDashboardFillLayout,
  calculateDashboardCapacity,
  calculateDashboardLayout,
  calculateDashboardWeightCapacity,
  pickDashboardPageByWeight,
  pickDashboardPage,
  pickRandomTiles,
  pickVisibleDashboardTilesByWeight,
  tileWeight,
  pickVisibleDashboardTiles
} from '../dashboard-grid';

describe('dashboard grid helpers', () => {
  it('calculates responsive tile capacity from available space', () => {
    expect(calculateDashboardCapacity(880, 680)).toEqual({
      columns: 2,
      rows: 2,
      capacity: 4
    });
  });

  it('calculates responsive tile dimensions for a small viewport', () => {
    const layout = calculateDashboardLayout(880, 680);

    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(2);
    expect(layout.capacity).toBe(4);
    expect(layout.tileWidth).toBeGreaterThan(TILE_MIN_WIDTH);
    expect(layout.tileHeight).toBeGreaterThan(TILE_MIN_HEIGHT);
  });

  it('uses more of a large viewport', () => {
    const layout = calculateDashboardLayout(1920, 1080);

    expect(layout.columns).toBeGreaterThanOrEqual(5);
    expect(layout.rows).toBeGreaterThanOrEqual(4);
    expect(layout.capacity).toBeGreaterThanOrEqual(20);
    expect(layout.tileWidth).toBeGreaterThanOrEqual(TILE_MIN_WIDTH);
    expect(layout.tileHeight).toBeGreaterThanOrEqual(TILE_MIN_HEIGHT);
  });

  it('keeps at least one tile on tiny viewports', () => {
    const layout = calculateDashboardLayout(200, 140);

    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(1);
    expect(layout.capacity).toBe(1);
    expect(layout.tileWidth).toBeGreaterThanOrEqual(TILE_MIN_WIDTH);
    expect(layout.tileHeight).toBeGreaterThanOrEqual(TILE_MIN_HEIGHT);
  });

  it('weights unknown and small tiles the same', () => {
    expect(tileWeight()).toBe(1);
    expect(tileWeight('small')).toBe(1);
    expect(tileWeight('wide')).toBe(2);
    expect(tileWeight('large')).toBe(4);
  });

  it('calculates at least 20 small-widget weight units on a large viewport', () => {
    expect(calculateDashboardWeightCapacity(1920, 1080)).toBeGreaterThanOrEqual(20);
  });

  it('fills the dashboard with one widget', () => {
    const layout = calculateDashboardFillLayout(880, 680, [{ uuid: 'a' }]);

    expect(layout.rects).toEqual([{
      uuid: 'a',
      left: DASHBOARD_PADDING,
      top: DASHBOARD_PADDING,
      width: 880 - DASHBOARD_PADDING * 2,
      height: 680 - DASHBOARD_PADDING * 2
    }]);
  });

  it('splits two equal widgets across the full dashboard', () => {
    const layout = calculateDashboardFillLayout(880, 680, [{ uuid: 'a' }, { uuid: 'b' }]);
    const [first, second] = layout.rects;

    expect(first.top).toBe(DASHBOARD_PADDING);
    expect(second.top).toBe(DASHBOARD_PADDING);
    expect(first.width + second.width + TILE_GAP).toBe(880 - DASHBOARD_PADDING * 2);
    expect(first.height).toBe(680 - DASHBOARD_PADDING * 2);
    expect(second.height).toBe(680 - DASHBOARD_PADDING * 2);
  });

  it('fills the dashboard with three widgets without unused outer area', () => {
    const layout = calculateDashboardFillLayout(880, 680, [
      { uuid: 'a' },
      { uuid: 'b' },
      { uuid: 'c' }
    ]);

    const rightEdge = Math.max(...layout.rects.map((rect) => rect.left + rect.width));
    const bottomEdge = Math.max(...layout.rects.map((rect) => rect.top + rect.height));

    expect(rightEdge).toBe(880 - DASHBOARD_PADDING);
    expect(bottomEdge).toBe(680 - DASHBOARD_PADDING);
  });

  it('produces balanced full-width rows for five equal widgets', () => {
    const layout = calculateDashboardFillLayout(1200, 800, ['a', 'b', 'c', 'd', 'e'].map((uuid) => ({ uuid })));
    const rowTops = new Set(layout.rects.map((rect) => rect.top));

    expect(rowTops.size).toBeGreaterThan(1);
    expect(Math.max(...layout.rects.map((rect) => rect.left + rect.width))).toBe(1200 - DASHBOARD_PADDING);
    expect(Math.max(...layout.rects.map((rect) => rect.top + rect.height))).toBe(800 - DASHBOARD_PADDING);
  });

  it('allocates weighted widget area proportionally', () => {
    const layout = calculateDashboardFillLayout(1200, 800, [
      { uuid: 'large', size: 'large' },
      { uuid: 'small-1' },
      { uuid: 'small-2' }
    ]);
    const area = (uuid: string) => {
      const rect = layout.rects.find((item) => item.uuid === uuid);
      if (!rect) return 0;
      return rect.width * rect.height;
    };
    const totalArea = layout.rects.reduce((sum, rect) => sum + rect.width * rect.height, 0);

    expect(area('large') / totalArea).toBeGreaterThan(0.6);
    expect(area('large') / totalArea).toBeLessThan(0.72);
  });

  it('subtracts gaps and padding from fill layout rectangles', () => {
    const layout = calculateDashboardFillLayout(880, 680, [{ uuid: 'a' }, { uuid: 'b' }]);
    const [first, second] = layout.rects;

    expect(first.left).toBe(DASHBOARD_PADDING);
    expect(second.left).toBe(first.left + first.width + TILE_GAP);
    expect(second.left + second.width).toBe(880 - DASHBOARD_PADDING);
  });

  it('picks a random subset with the requested size', () => {
    const tiles = ['a', 'b', 'c', 'd', 'e'].map((uuid) => ({ uuid }));

    const picked = pickRandomTiles(tiles, 4);

    expect(picked).toHaveLength(4);
  });

  it('does not duplicate picked uuids', () => {
    const tiles = ['a', 'b', 'c', 'd', 'e'].map((uuid) => ({ uuid }));

    const picked = pickRandomTiles(tiles, 4);

    expect(new Set(picked.map((tile) => tile.uuid)).size).toBe(4);
  });

  it('avoids returning the same visible set when another set is possible', () => {
    const random = vi.spyOn(Math, 'random');
    random
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.3)
      .mockReturnValueOnce(0.4)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.8)
      .mockReturnValueOnce(0.7)
      .mockReturnValueOnce(0.6);
    const tiles = ['a', 'b', 'c', 'd', 'e'].map((uuid) => ({ uuid }));
    const previous = tiles.slice(0, 4);

    const picked = pickRandomTiles(tiles, 4, previous);

    expect(new Set(picked.map((tile) => tile.uuid))).not.toEqual(new Set(previous.map((tile) => tile.uuid)));
    random.mockRestore();
  });

  it('returns all visible dashboard tiles when they fit capacity', () => {
    const tiles = ['a', 'b'].map((uuid) => ({ uuid }));

    expect(pickVisibleDashboardTiles(tiles, 4)).toEqual(tiles);
  });

  it('always includes pinned widgets when pinned count fits', () => {
    const tiles = [
      { uuid: 'a', pinned: true },
      { uuid: 'b' },
      { uuid: 'c' },
      { uuid: 'd' }
    ];

    const picked = pickVisibleDashboardTiles(tiles, 2);

    expect(picked.map((tile) => tile.uuid)).toContain('a');
    expect(picked).toHaveLength(2);
  });

  it('fills remaining capacity with random unpinned widgets', () => {
    const tiles = [
      { uuid: 'a', pinned: true },
      { uuid: 'b' },
      { uuid: 'c' },
      { uuid: 'd' }
    ];

    const picked = pickVisibleDashboardTiles(tiles, 3);

    expect(picked.filter((tile) => tile.pinned).map((tile) => tile.uuid)).toEqual(['a']);
    expect(picked.filter((tile) => !tile.pinned)).toHaveLength(2);
  });

  it('returns only pinned widgets when pinned count exceeds capacity', () => {
    const tiles = [
      { uuid: 'a', pinned: true },
      { uuid: 'b', pinned: true },
      { uuid: 'c', pinned: true },
      { uuid: 'd' }
    ];

    const picked = pickVisibleDashboardTiles(tiles, 2);

    expect(picked).toHaveLength(2);
    expect(picked.every((tile) => tile.pinned)).toBe(true);
  });

  it('does not duplicate visible dashboard uuids', () => {
    const tiles = [
      { uuid: 'a', pinned: true },
      { uuid: 'b' },
      { uuid: 'c' },
      { uuid: 'd' }
    ];

    const picked = pickVisibleDashboardTiles(tiles, 3);

    expect(new Set(picked.map((tile) => tile.uuid)).size).toBe(3);
  });

  it('avoids the same visible dashboard set when possible', () => {
    const tiles = [
      { uuid: 'a', pinned: true },
      { uuid: 'b' },
      { uuid: 'c' },
      { uuid: 'd' }
    ];
    const previous = [tiles[0], tiles[1]];

    const picked = pickVisibleDashboardTiles(tiles, 2, previous);

    expect(new Set(picked.map((tile) => tile.uuid))).not.toEqual(new Set(previous.map((tile) => tile.uuid)));
  });

  it('does not mutate input order', () => {
    const tiles = [
      { uuid: 'a', pinned: true },
      { uuid: 'b' },
      { uuid: 'c' },
      { uuid: 'd' }
    ];
    const original = tiles.map((tile) => tile.uuid);

    pickVisibleDashboardTiles(tiles, 2);

    expect(tiles.map((tile) => tile.uuid)).toEqual(original);
  });

  it('pickDashboardPage returns deterministic page slices with pinned always present', () => {
    const tiles = [
      { uuid: 'pin1', pinned: true },
      { uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' },
      { uuid: 'd' }, { uuid: 'e' }, { uuid: 'f' }
    ];

    const page0 = pickDashboardPage(tiles, 3, 0);
    const page1 = pickDashboardPage(tiles, 3, 1);
    const page2 = pickDashboardPage(tiles, 3, 2);

    expect(page0.map((tile) => tile.uuid)).toEqual(['pin1', 'a', 'b']);
    expect(page1.map((tile) => tile.uuid)).toEqual(['pin1', 'c', 'd']);
    expect(page2.map((tile) => tile.uuid)).toEqual(['pin1', 'e', 'f']);
  });

  it('pickDashboardPage wraps the page index modulo page count', () => {
    const tiles = [{ uuid: 'a' }, { uuid: 'b' }, { uuid: 'c' }, { uuid: 'd' }];

    expect(pickDashboardPage(tiles, 2, 2).map((tile) => tile.uuid)).toEqual(['a', 'b']);
    expect(pickDashboardPage(tiles, 2, -1).map((tile) => tile.uuid)).toEqual(['c', 'd']);
  });

  it('pickDashboardPage returns all tiles when capacity is enough for everything', () => {
    const tiles = [{ uuid: 'a' }, { uuid: 'b' }];

    expect(pickDashboardPage(tiles, 4, 0).map((tile) => tile.uuid)).toEqual(['a', 'b']);
  });

  it('weighted page selection returns all widgets when total weight fits', () => {
    const tiles = [{ uuid: 'a', size: 'wide' as const }, { uuid: 'b' }];

    expect(pickDashboardPageByWeight(tiles, 3, 0)).toEqual(tiles);
  });

  it('weighted page selection pages widgets when total weight exceeds capacity', () => {
    const tiles = [
      { uuid: 'large', size: 'large' as const },
      { uuid: 'small-1' },
      { uuid: 'small-2' }
    ];

    expect(pickDashboardPageByWeight(tiles, 4, 0).map((tile) => tile.uuid)).toEqual(['large']);
    expect(pickDashboardPageByWeight(tiles, 4, 1).map((tile) => tile.uuid)).toEqual(['small-1', 'small-2']);
  });

  it('weighted visible selection includes pinned widgets when pinned weight fits', () => {
    const tiles = [
      { uuid: 'pin', pinned: true },
      { uuid: 'a' },
      { uuid: 'b' },
      { uuid: 'c' },
      { uuid: 'd' }
    ];

    const picked = pickVisibleDashboardTilesByWeight(tiles, 4);

    expect(picked.map((tile) => tile.uuid)).toContain('pin');
    expect(picked.reduce((sum, tile) => sum + tileWeight(tile.size), 0)).toBeLessThanOrEqual(4);
  });

  it('weighted page selection pages pinned widgets alone when pinned weight exceeds capacity', () => {
    const tiles = [
      { uuid: 'large-pin', pinned: true, size: 'large' as const },
      { uuid: 'small-pin', pinned: true },
      { uuid: 'unpinned' }
    ];

    expect(pickDashboardPageByWeight(tiles, 4, 0).map((tile) => tile.uuid)).toEqual(['large-pin']);
    expect(pickDashboardPageByWeight(tiles, 4, 1).map((tile) => tile.uuid)).toEqual(['small-pin']);
  });
});
