import { describe, expect, it, vi } from 'vitest';
import { calculateDashboardCapacity, pickRandomTiles, pickVisibleDashboardTiles } from '../dashboard-grid';

describe('dashboard grid helpers', () => {
  it('calculates fixed tile capacity from available space', () => {
    expect(calculateDashboardCapacity(880, 680)).toEqual({
      columns: 2,
      rows: 2,
      capacity: 4
    });
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
});
