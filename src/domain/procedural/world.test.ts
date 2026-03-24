import { describe, expect, test } from "vite-plus/test";
import {
  buildChunk,
  buildRedwoodArchetypes,
  createWorldSimulationData,
  getSurfaceHeight,
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

  test("world simulation data is deterministic", () => {
    const first = createWorldSimulationData(3421907);
    const second = createWorldSimulationData(3421907);

    expect(second.summary).toEqual(first.summary);
    expect(Array.from(second.fields.baseElevation.slice(0, 128))).toEqual(
      Array.from(first.fields.baseElevation.slice(0, 128)),
    );
    expect(Array.from(second.fields.redwoodSuitability.slice(2_048, 2_176))).toEqual(
      Array.from(first.fields.redwoodSuitability.slice(2_048, 2_176)),
    );
  });

  test("terrain is continuous across chunk seams", () => {
    const world = createWorldSimulationData(3421907);
    const left = buildChunk(world, {
      coord: { x: 0, z: 0 },
      lod: 1,
      seed: 3421907,
      chunkSize: 42,
      resolution: terrainResolutionForLod(1),
    });
    const right = buildChunk(world, {
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
    const world = createWorldSimulationData(3421907);
    const request = {
      coord: { x: -1, z: 2 },
      lod: 0 as const,
      seed: 3421907,
      chunkSize: 42,
      resolution: terrainResolutionForLod(0),
    };
    const first = buildChunk(world, request);
    const second = buildChunk(world, request);

    expect(second.treeSpawns).toEqual(first.treeSpawns);
    expect(second.rockSpawns).toEqual(first.rockSpawns);
    expect(second.fernSpawns).toEqual(first.fernSpawns);
    expect(second.id).toBe(makeChunkId(request.coord));
  });

  test("terrain sample matches chunk vertex heights", () => {
    const world = createWorldSimulationData(3421907);
    const chunk = buildChunk(world, {
      coord: { x: 0, z: 0 },
      lod: 0,
      seed: 3421907,
      chunkSize: 42,
      resolution: terrainResolutionForLod(0),
    });

    for (let vertex = 0; vertex < chunk.positions.length; vertex += 3) {
      const x = chunk.positions[vertex]!;
      const height = chunk.positions[vertex + 1]!;
      const z = chunk.positions[vertex + 2]!;
      expect(sampleTerrain(world, x, z).height).toBeCloseTo(height, 6);
    }
  });

  test("coastal strip world has coherent moisture and drainage gradients", () => {
    const world = createWorldSimulationData(3421907);
    const nearCoast = sampleTerrain(world, -1_500, 0);
    const groveBelt = sampleTerrain(world, 0, 0);
    const inland = sampleTerrain(world, 22_000, 0);

    expect(nearCoast.coastDistance).toBeLessThan(groveBelt.coastDistance);
    expect(groveBelt.coastDistance).toBeLessThan(inland.coastDistance);
    expect(groveBelt.redwoodSuitability).toBeGreaterThan(inland.redwoodSuitability);
    expect(world.summary.streamCoverage).toBeGreaterThan(0.005);
    expect(world.summary.landCoverage).toBeGreaterThan(0.5);
  });

  test("spawn point lands on a fog-belt shoulder above the floodplain", () => {
    const world = createWorldSimulationData(3421907);
    const spawn = sampleTerrain(world, world.spawn.x, world.spawn.z);

    expect(world.spawn.y).toBeCloseTo(getSurfaceHeight(world, world.spawn.x, world.spawn.z), 6);
    expect(spawn.redwoodSuitability).toBeGreaterThan(0.34);
    expect(spawn.fogExposure).toBeGreaterThan(0.38);
    expect(spawn.floodplain).toBeLessThan(0.45);
    expect(spawn.shoulderness > 0.12 || spawn.slope < 0.26).toBe(true);
  });

  test("sampled routed land cells drain to the coast", () => {
    const world = createWorldSimulationData(3421907);
    const sampledLandIndices: number[] = [];

    for (let index = 0; index < world.macroElevation.length; index += 997) {
      if (
        world.fields.coastDistance[index]! > 0 &&
        world.macroElevation[index]! > world.config.seaLevel
      ) {
        sampledLandIndices.push(index);
      }
    }

    for (const start of sampledLandIndices.slice(0, 48)) {
      const visited = new Set<number>();
      let current = start;
      let safety = 0;

      while (current >= 0 && world.fields.coastDistance[current]! > 0 && safety < 8_192) {
        expect(visited.has(current)).toBe(false);
        visited.add(current);

        const receiver = world.receivers[current]!;
        if (receiver >= 0) {
          expect(world.filledElevation[current]).toBeGreaterThan(world.filledElevation[receiver]);
        }
        current = receiver;
        safety += 1;
      }

      expect(safety).toBeLessThan(8_192);
      expect(current).toBeGreaterThanOrEqual(0);
      expect(world.fields.coastDistance[current]!).toBe(0);
    }
  });

  test("surface height clamps ocean terrain to sea level for traversal", () => {
    const world = createWorldSimulationData(3421907);
    let oceanX = world.config.worldMinX;
    let oceanFloor = sampleTerrain(world, oceanX, 0).height;

    for (let offset = 0; offset <= 1_536; offset += 64) {
      oceanX = world.config.worldMinX + offset;
      oceanFloor = sampleTerrain(world, oceanX, 0).height;
      if (oceanFloor <= world.config.seaLevel - 0.25) {
        break;
      }
    }

    const surfaceHeight = getSurfaceHeight(world, oceanX, 0);

    expect(oceanFloor).toBeLessThanOrEqual(world.config.seaLevel);
    expect(surfaceHeight).toBeGreaterThanOrEqual(world.config.seaLevel);
  });
});
