import { describe, expect, test } from "vite-plus/test";
import {
  buildChunk,
  buildRedwoodArchetypes,
  makeChunkId,
  sampleTerrain,
  terrainResolutionForLod,
} from "./world";

describe("procedural world", () => {
  test("redwood archetypes are deterministic", () => {
    const first = buildRedwoodArchetypes(1234);
    const second = buildRedwoodArchetypes(1234);
    expect(second).toEqual(first);
  });

  test("terrain is continuous across chunk seams", () => {
    const left = buildChunk({
      coord: { x: 0, z: 0 },
      lod: 1,
      seed: 3421907,
      chunkSize: 42,
      resolution: terrainResolutionForLod(1),
    });
    const right = buildChunk({
      coord: { x: 1, z: 0 },
      lod: 1,
      seed: 3421907,
      chunkSize: 42,
      resolution: terrainResolutionForLod(1),
    });

    for (let row = 0; row <= left.resolution; row++) {
      const leftIndex = (row * (left.resolution + 1) + left.resolution) * 3 + 1;
      const rightIndex = row * (right.resolution + 1) * 3 + 1;
      expect(left.positions[leftIndex]).toBeCloseTo(right.positions[rightIndex], 6);
    }
  });

  test("tree placement is repeatable for the same chunk request", () => {
    const request = {
      coord: { x: -1, z: 2 },
      lod: 0 as const,
      seed: 3421907,
      chunkSize: 42,
      resolution: terrainResolutionForLod(0),
    };
    const first = buildChunk(request);
    const second = buildChunk(request);

    expect(second.treeSpawns).toEqual(first.treeSpawns);
    expect(second.rockSpawns).toEqual(first.rockSpawns);
    expect(second.fernSpawns).toEqual(first.fernSpawns);
    expect(second.id).toBe(makeChunkId(request.coord));
  });

  test("terrain samples stay within a navigable band near origin", () => {
    const sample = sampleTerrain(3421907, 0, 0);
    expect(sample.height).toBeGreaterThan(-4);
    expect(sample.height).toBeLessThan(24);
    expect(sample.slope).toBeGreaterThanOrEqual(0);
    expect(sample.slope).toBeLessThanOrEqual(1);
  });
});
