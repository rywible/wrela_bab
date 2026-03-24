import { describe, expect, test } from "vite-plus/test";
import { planDesiredChunks } from "./GameApp";

describe("chunk planning", () => {
  test("plans a square ring around the player and sorts by lod", () => {
    const desired = planDesiredChunks({ x: 4, z: -3 }, 42, 2);

    expect(desired).toHaveLength(25);
    expect(desired[0]).toEqual({
      coord: { x: 0, z: -1 },
      lod: 0,
    });
    expect(desired.filter((entry) => entry.lod === 0)).toHaveLength(1);
    expect(desired.filter((entry) => entry.lod === 1)).toHaveLength(8);
    expect(desired.filter((entry) => entry.lod === 2)).toHaveLength(16);
  });
});
