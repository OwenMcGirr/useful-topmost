import { describe, expect, it, vi } from 'vitest';
import { calculateDashboardCapacity, pickRandomTiles } from '../dashboard-grid';

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
});
