import { clamp01, hash01, lerp, mixColor, smoothstep } from "./mathUtils";
import { sampleTerrain } from "./gridOps";
import type { WorldSimulationData } from "./worldSimulation";
import type {
  ChunkCoord,
  ChunkRequest,
  TreeArchetype,
  TreeSpawn,
  PropSpawn,
  LogSpawn,
  CollisionBatch,
  TerrainChunkData,
  TerrainDebugView,
  BiomeFields,
} from "./world";

const CHUNK_TREE_CELL_SIZE = 8;
const ROCK_CELL_SIZE = 11;
const FERN_CELL_SIZE = 5;
const LOG_CELL_SIZE = 26;

export function chunkCoordFromPosition(x: number, z: number, chunkSize: number): ChunkCoord {
  return {
    x: Math.floor(x / chunkSize),
    z: Math.floor(z / chunkSize),
  };
}

export function chunkOrigin(coord: ChunkCoord, chunkSize: number) {
  return {
    x: coord.x * chunkSize,
    z: coord.z * chunkSize,
  };
}

export function buildRedwoodArchetypes(seed: number): TreeArchetype[] {
  return Array.from({ length: 3 }, (_, index) => {
    const h = hash01(seed + 17, index * 13, 11);
    const h2 = hash01(seed + 41, index * 17, 23);
    const h3 = hash01(seed + 73, index * 19, 31);

    return {
      id: index,
      height: lerp(15, 22, h),
      baseRadius: lerp(0.9, 1.45, h2),
      crownStart: lerp(0.56, 0.72, h3),
      crownRadius: lerp(2.2, 3.6, hash01(seed + 91, index * 29, 7)),
      lean: lerp(0.04, 0.12, hash01(seed + 109, index * 7, 3)),
      branchCount: Math.round(lerp(4, 8, hash01(seed + 151, index * 11, 13))),
      canopyClusters: Math.round(lerp(10, 16, hash01(seed + 211, index * 7, 19))),
      barkWarmth: lerp(0.2, 0.85, hash01(seed + 317, index * 13, 29)),
      crownLift: lerp(0.9, 1.45, hash01(seed + 401, index * 5, 17)),
    };
  });
}

export function buildChunk(world: WorldSimulationData, request: ChunkRequest): TerrainChunkData {
  const { chunkSize, resolution, coord, lod, seed } = request;
  const origin = chunkOrigin(coord, chunkSize);
  const positions: number[] = [];
  const indices: number[] = [];
  const normals = Array.from({ length: (resolution + 1) * (resolution + 1) * 3 }, () => 0);
  const colors: number[] = [];
  const debugColors: Record<TerrainDebugView, number[]> = {
    coastDistance: [],
    flowAccumulation: [],
    floodplain: [],
    fogExposure: [],
    redwoodSuitability: [],
  };
  const heights: number[][] = [];

  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let moistureSum = 0;
  let groveSum = 0;
  let glenSum = 0;
  let suitabilitySum = 0;
  let fogExposureSum = 0;
  let streamVertices = 0;

  for (let z = 0; z <= resolution; z++) {
    const row: number[] = [];
    for (let x = 0; x <= resolution; x++) {
      const worldX = origin.x + (x / resolution) * chunkSize;
      const worldZ = origin.z + (z / resolution) * chunkSize;
      const fields = sampleTerrain(world, worldX, worldZ);
      row.push(fields.height);

      minHeight = Math.min(minHeight, fields.height);
      maxHeight = Math.max(maxHeight, fields.height);
      moistureSum += fields.moisture;
      groveSum += fields.grove;
      glenSum += fields.glen;
      suitabilitySum += fields.redwoodSuitability;
      fogExposureSum += fields.fogExposure;
      if (fields.streamOrder >= 1) {
        streamVertices += 1;
      }

      positions.push(worldX, fields.height, worldZ);
      colors.push(...terrainColor(world, fields), 1);
      debugColors.coastDistance.push(...terrainDebugColor("coastDistance", world, fields), 1);
      debugColors.flowAccumulation.push(...terrainDebugColor("flowAccumulation", world, fields), 1);
      debugColors.floodplain.push(...terrainDebugColor("floodplain", world, fields), 1);
      debugColors.fogExposure.push(...terrainDebugColor("fogExposure", world, fields), 1);
      debugColors.redwoodSuitability.push(
        ...terrainDebugColor("redwoodSuitability", world, fields),
        1,
      );
    }
    heights.push(row);
  }

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const base = z * (resolution + 1) + x;
      indices.push(base, base + resolution + 1, base + 1);
      indices.push(base + 1, base + resolution + 1, base + resolution + 2);
    }
  }

  for (let z = 0; z <= resolution; z++) {
    for (let x = 0; x <= resolution; x++) {
      const left = heights[z]![Math.max(0, x - 1)]!;
      const right = heights[z]![Math.min(resolution, x + 1)]!;
      const down = heights[Math.max(0, z - 1)]![x]!;
      const up = heights[Math.min(resolution, z + 1)]![x]!;
      const nx = left - right;
      const ny = 2;
      const nz = down - up;
      const length = Math.hypot(nx, ny, nz) || 1;
      const index = (z * (resolution + 1) + x) * 3;
      normals[index] = nx / length;
      normals[index + 1] = ny / length;
      normals[index + 2] = nz / length;
    }
  }

  const treeSpawns = generateTreeSpawns(world, seed, coord, chunkSize, lod);
  const rockSpawns = generateRockSpawns(world, seed, coord, chunkSize, lod);
  const fernSpawns = generateFernSpawns(world, seed, coord, chunkSize, lod);
  const logSpawns = generateLogSpawns(world, seed, coord, chunkSize, lod);
  injectHeroGrove(world, coord, chunkSize, treeSpawns, rockSpawns, fernSpawns, logSpawns);

  const collisions: CollisionBatch = {
    trunks: treeSpawns.map((tree) => ({
      x: tree.x,
      z: tree.z,
      radius: tree.radius * 0.55,
      minY: tree.y,
      maxY: tree.y + 5.8 * tree.scale,
    })),
    logs: logSpawns.map((log) => ({
      x: log.x,
      z: log.z,
      radius: Math.min(log.length * 0.22, 1.3),
      minY: log.y - log.radius,
      maxY: log.y + log.radius,
    })),
  };

  const sampleCount = (resolution + 1) * (resolution + 1);

  return {
    id: `${coord.x}:${coord.z}`,
    coord,
    lod,
    chunkSize,
    resolution,
    positions,
    indices,
    normals,
    colors,
    debugColors,
    minHeight,
    maxHeight,
    treeSpawns,
    rockSpawns,
    fernSpawns,
    logSpawns,
    collisions,
    biomeSummary: {
      grove: groveSum / sampleCount,
      glen: glenSum / sampleCount,
      moisture: moistureSum / sampleCount,
      redwoodSuitability: suitabilitySum / sampleCount,
      fogExposure: fogExposureSum / sampleCount,
      streamCoverage: streamVertices / sampleCount,
    },
  };
}

function terrainColor(world: WorldSimulationData, fields: BiomeFields): [number, number, number] {
  if (fields.height <= world.config.seaLevel) {
    return mixColor([0.12, 0.09, 0.07], [0.22, 0.18, 0.12], smoothstep(-18, 0, fields.height));
  }

  const grove = clamp01(fields.grove * 0.64 + fields.redwoodSuitability * 0.26);
  const rockiness = clamp01(fields.slope * 0.88 + fields.vista * 0.12);
  const damp = clamp01(fields.moisture * 0.74 + fields.fogPersistence * 0.18 + fields.creek * 0.12);
  const clearing = clamp01(fields.glen * 0.82 + fields.canopyOpenness * 0.18);
  const alluvial = clamp01(fields.floodplain * 0.62 + fields.soilDepth * 0.38);
  const shoulder = clamp01(fields.shoulderness * 0.72 + fields.northness * 0.18);
  const saltBurn = smoothstep(0.24, 1, fields.saltExposure);

  const soil = mixColor([0.18, 0.12, 0.08], [0.42, 0.31, 0.18], clearing);
  const moss = mixColor([0.12, 0.2, 0.08], [0.26, 0.44, 0.18], damp);
  const alluvialLift = mixColor(moss, [0.46, 0.49, 0.24], alluvial);
  const rock = mixColor(
    [0.29, 0.31, 0.32],
    [0.56, 0.56, 0.52],
    smoothstep(10, 92, fields.baseElevation),
  );
  const shoulderTint = mixColor(alluvialLift, [0.34, 0.4, 0.22], shoulder);
  const woodWarm = mixColor(
    mixColor(soil, shoulderTint, grove * 0.7),
    [0.46, 0.39, 0.23],
    saltBurn * 0.22,
  );

  return mixColor(woodWarm, rock, rockiness * 0.82);
}

function terrainDebugColor(
  mode: TerrainDebugView,
  world: WorldSimulationData,
  fields: BiomeFields,
): [number, number, number] {
  if (fields.height <= world.config.seaLevel) {
    return [0.05, 0.16, 0.26];
  }

  switch (mode) {
    case "coastDistance": {
      const t = clamp01(fields.coastDistance / 18_000);
      return mixColor([0.15, 0.36, 0.74], [0.96, 0.76, 0.26], t);
    }
    case "flowAccumulation": {
      const t = clamp01(
        Math.log1p(fields.flowAccumulation) / Math.log1p(world.config.fieldResolution ** 2),
      );
      return mixColor([0.1, 0.12, 0.16], [0.1, 0.88, 0.96], t);
    }
    case "floodplain":
      return mixColor([0.12, 0.08, 0.05], [0.96, 0.88, 0.42], fields.floodplain);
    case "fogExposure":
      return mixColor([0.22, 0.18, 0.15], [0.86, 0.94, 0.98], fields.fogExposure);
    case "redwoodSuitability":
      return mixColor([0.33, 0.12, 0.08], [0.2, 0.72, 0.28], fields.redwoodSuitability);
  }
}

function generateTreeSpawns(
  world: WorldSimulationData,
  seed: number,
  coord: ChunkCoord,
  chunkSize: number,
  lod: 0 | 1 | 2,
) {
  const origin = chunkOrigin(coord, chunkSize);
  const spawns: TreeSpawn[] = [];
  const accepted: Array<TreeSpawn & { influenceRadius: number }> = [];

  const minCellX = Math.floor(origin.x / CHUNK_TREE_CELL_SIZE) - 1;
  const maxCellX = Math.floor((origin.x + chunkSize) / CHUNK_TREE_CELL_SIZE) + 1;
  const minCellZ = Math.floor(origin.z / CHUNK_TREE_CELL_SIZE) - 1;
  const maxCellZ = Math.floor((origin.z + chunkSize) / CHUNK_TREE_CELL_SIZE) + 1;

  const lodDensity = lod === 0 ? 1 : lod === 1 ? 0.72 : 0.48;

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const jitterX = hash01(seed + 509, cellX, cellZ) * CHUNK_TREE_CELL_SIZE;
      const jitterZ = hash01(seed + 541, cellX, cellZ) * CHUNK_TREE_CELL_SIZE;
      const x = cellX * CHUNK_TREE_CELL_SIZE + jitterX;
      const z = cellZ * CHUNK_TREE_CELL_SIZE + jitterZ;

      const insideChunk =
        x >= origin.x && x < origin.x + chunkSize && z >= origin.z && z < origin.z + chunkSize;
      const fields = sampleTerrain(world, x, z);
      if (
        fields.height <= world.config.seaLevel + 0.5 ||
        fields.coastDistance < 260 ||
        fields.redwoodSuitability < 0.12
      ) {
        continue;
      }

      const shoulderBand =
        fields.shoulderness * 0.32 +
        smoothstep(120, 460, fields.distanceToStream) *
          (1 - smoothstep(520, 1_600, fields.distanceToStream)) *
          0.28;
      const density =
        fields.redwoodSuitability * 0.88 +
        fields.oldGrowth * 0.42 +
        shoulderBand +
        fields.soilDepth * 0.18 +
        fields.northness * 0.1 +
        fields.fogPersistence * 0.12 -
        fields.floodplain * 0.12 -
        fields.glen * 0.44 -
        fields.slope * 0.34 -
        fields.saltExposure * 0.22;

      if (density < 0.14 || hash01(seed + 577, cellX, cellZ) > density * lodDensity) {
        continue;
      }

      const influenceRadius = lerp(
        4.2,
        7.4,
        clamp01(fields.oldGrowth * 0.58 + fields.redwoodSuitability * 0.42),
      );
      const tooClose = accepted.some((acceptedTree) => {
        const dx = acceptedTree.x - x;
        const dz = acceptedTree.z - z;
        const minDistance = Math.max(influenceRadius, acceptedTree.influenceRadius) * 0.9;
        return dx * dx + dz * dz < minDistance * minDistance;
      });
      if (tooClose) {
        continue;
      }

      const scale = lerp(
        0.8,
        1.42,
        clamp01(
          fields.oldGrowth * 0.56 +
            fields.redwoodSuitability * 0.24 +
            fields.shoulderness * 0.08 +
            hash01(seed + 601, cellX, cellZ) * 0.16,
        ),
      );
      const spawn: TreeSpawn & { influenceRadius: number } = {
        x,
        y: fields.height,
        z,
        yaw: hash01(seed + 617, cellX, cellZ) * Math.PI * 2,
        scale,
        radius: lerp(0.84, 1.54, clamp01(fields.oldGrowth * 0.64 + fields.soilDepth * 0.36)),
        archetypeId: Math.floor(hash01(seed + 641, cellX, cellZ) * 3) % 3,
        crownScale: lerp(
          0.84,
          1.24,
          clamp01(fields.fogPersistence * 0.42 + fields.moisture * 0.42 + fields.northness * 0.16),
        ),
        influenceRadius,
      };
      accepted.push(spawn);
      if (insideChunk) {
        spawns.push(spawn);
      }
    }
  }

  return spawns;
}

function generateRockSpawns(
  world: WorldSimulationData,
  seed: number,
  coord: ChunkCoord,
  chunkSize: number,
  lod: 0 | 1 | 2,
) {
  const origin = chunkOrigin(coord, chunkSize);
  const spawns: PropSpawn[] = [];

  const minCellX = Math.floor(origin.x / ROCK_CELL_SIZE);
  const maxCellX = Math.floor((origin.x + chunkSize) / ROCK_CELL_SIZE);
  const minCellZ = Math.floor(origin.z / ROCK_CELL_SIZE);
  const maxCellZ = Math.floor((origin.z + chunkSize) / ROCK_CELL_SIZE);

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const x = cellX * ROCK_CELL_SIZE + hash01(seed + 683, cellX, cellZ) * ROCK_CELL_SIZE;
      const z = cellZ * ROCK_CELL_SIZE + hash01(seed + 701, cellX, cellZ) * ROCK_CELL_SIZE;
      if (x < origin.x || x >= origin.x + chunkSize || z < origin.z || z >= origin.z + chunkSize) {
        continue;
      }

      const fields = sampleTerrain(world, x, z);
      if (fields.height <= world.config.seaLevel + 0.2) {
        continue;
      }

      const chance = clamp01(
        fields.slope * 0.28 +
          fields.vista * 0.24 +
          (1 - fields.redwoodSuitability) * 0.18 +
          (1 - fields.soilDepth) * 0.12 +
          fields.saltExposure * 0.16 +
          0.06,
      );
      if (hash01(seed + 727, cellX, cellZ) > chance * (lod === 2 ? 0.5 : 0.8)) {
        continue;
      }

      spawns.push({
        x,
        y: fields.height + 0.15,
        z,
        yaw: hash01(seed + 751, cellX, cellZ) * Math.PI * 2,
        scale: lerp(0.65, 1.45, hash01(seed + 769, cellX, cellZ)),
        variant: Math.floor(hash01(seed + 787, cellX, cellZ) * 3),
      });
    }
  }

  return spawns;
}

function generateFernSpawns(
  world: WorldSimulationData,
  seed: number,
  coord: ChunkCoord,
  chunkSize: number,
  lod: 0 | 1 | 2,
) {
  const origin = chunkOrigin(coord, chunkSize);
  const spawns: PropSpawn[] = [];
  if (lod === 2) {
    return spawns;
  }

  const minCellX = Math.floor(origin.x / FERN_CELL_SIZE);
  const maxCellX = Math.floor((origin.x + chunkSize) / FERN_CELL_SIZE);
  const minCellZ = Math.floor(origin.z / FERN_CELL_SIZE);
  const maxCellZ = Math.floor((origin.z + chunkSize) / FERN_CELL_SIZE);

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const x = cellX * FERN_CELL_SIZE + hash01(seed + 809, cellX, cellZ) * FERN_CELL_SIZE;
      const z = cellZ * FERN_CELL_SIZE + hash01(seed + 827, cellX, cellZ) * FERN_CELL_SIZE;
      if (x < origin.x || x >= origin.x + chunkSize || z < origin.z || z >= origin.z + chunkSize) {
        continue;
      }

      const fields = sampleTerrain(world, x, z);
      if (fields.height <= world.config.seaLevel + 0.25) {
        continue;
      }

      const shade = 1 - fields.canopyOpenness;
      const chance = clamp01(
        fields.moisture * 0.34 +
          fields.redwoodSuitability * 0.18 +
          fields.floodplain * 0.16 +
          fields.fogPersistence * 0.14 +
          shade * 0.22 +
          fields.northness * 0.08 -
          fields.slope * 0.18,
      );
      if (hash01(seed + 853, cellX, cellZ) > chance * (lod === 1 ? 0.55 : 0.95)) {
        continue;
      }

      spawns.push({
        x,
        y: fields.height + 0.05,
        z,
        yaw: hash01(seed + 877, cellX, cellZ) * Math.PI * 2,
        scale: lerp(0.55, 1.12, hash01(seed + 907, cellX, cellZ)),
        variant: Math.floor(hash01(seed + 929, cellX, cellZ) * 2),
      });
    }
  }

  return spawns;
}

function generateLogSpawns(
  world: WorldSimulationData,
  seed: number,
  coord: ChunkCoord,
  chunkSize: number,
  lod: 0 | 1 | 2,
) {
  const origin = chunkOrigin(coord, chunkSize);
  const spawns: LogSpawn[] = [];
  if (lod === 2) {
    return spawns;
  }

  const minCellX = Math.floor(origin.x / LOG_CELL_SIZE);
  const maxCellX = Math.floor((origin.x + chunkSize) / LOG_CELL_SIZE);
  const minCellZ = Math.floor(origin.z / LOG_CELL_SIZE);
  const maxCellZ = Math.floor((origin.z + chunkSize) / LOG_CELL_SIZE);

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      if (hash01(seed + 953, cellX, cellZ) > 0.22) {
        continue;
      }

      const x = cellX * LOG_CELL_SIZE + hash01(seed + 971, cellX, cellZ) * LOG_CELL_SIZE;
      const z = cellZ * LOG_CELL_SIZE + hash01(seed + 991, cellX, cellZ) * LOG_CELL_SIZE;
      if (x < origin.x || x >= origin.x + chunkSize || z < origin.z || z >= origin.z + chunkSize) {
        continue;
      }

      const fields = sampleTerrain(world, x, z);
      if (
        fields.height <= world.config.seaLevel + 0.4 ||
        fields.oldGrowth < 0.34 ||
        fields.glen > 0.74 ||
        fields.slope > 0.48 ||
        fields.floodplain > 0.62
      ) {
        continue;
      }

      spawns.push({
        x,
        y: fields.height + 0.28,
        z,
        yaw: hash01(seed + 1_013, cellX, cellZ) * Math.PI * 2,
        pitch: lerp(-0.08, 0.08, hash01(seed + 1_031, cellX, cellZ)),
        length: lerp(5.8, 10.2, hash01(seed + 1_051, cellX, cellZ)),
        radius: lerp(0.24, 0.48, hash01(seed + 1_069, cellX, cellZ)),
      });
    }
  }

  return spawns;
}

function injectHeroGrove(
  world: WorldSimulationData,
  coord: ChunkCoord,
  chunkSize: number,
  treeSpawns: TreeSpawn[],
  rockSpawns: PropSpawn[],
  fernSpawns: PropSpawn[],
  logSpawns: LogSpawn[],
) {
  const spawnChunk = chunkCoordFromPosition(world.spawn.x, world.spawn.z, chunkSize);
  if (coord.x !== spawnChunk.x || coord.z !== spawnChunk.z) {
    return;
  }

  const heroTrees: Array<{
    x: number;
    z: number;
    yaw: number;
    scale: number;
    archetypeId: number;
    crownScale: number;
  }> = [
    {
      x: world.spawn.x + 10.5,
      z: world.spawn.z + 12.5,
      yaw: 0.1,
      scale: 1.18,
      archetypeId: 1,
      crownScale: 1.12,
    },
    {
      x: world.spawn.x + 17.2,
      z: world.spawn.z + 15.8,
      yaw: 0.46,
      scale: 1.32,
      archetypeId: 2,
      crownScale: 1.18,
    },
    {
      x: world.spawn.x + 24.4,
      z: world.spawn.z + 13.4,
      yaw: 0.78,
      scale: 1.1,
      archetypeId: 0,
      crownScale: 1.08,
    },
    {
      x: world.spawn.x + 12.4,
      z: world.spawn.z + 22.6,
      yaw: 0.94,
      scale: 1.24,
      archetypeId: 1,
      crownScale: 1.14,
    },
    {
      x: world.spawn.x + 20.6,
      z: world.spawn.z + 24.8,
      yaw: 1.21,
      scale: 1.36,
      archetypeId: 2,
      crownScale: 1.2,
    },
    {
      x: world.spawn.x + 28.8,
      z: world.spawn.z + 19.2,
      yaw: 0.38,
      scale: 1.16,
      archetypeId: 0,
      crownScale: 1.06,
    },
  ];

  for (const tree of heroTrees) {
    const fields = sampleTerrain(world, tree.x, tree.z);
    if (fields.height <= world.config.seaLevel + 0.5) {
      continue;
    }
    treeSpawns.push({
      x: tree.x,
      y: fields.height,
      z: tree.z,
      yaw: tree.yaw,
      scale: tree.scale,
      radius: lerp(1.08, 1.44, clamp01(fields.oldGrowth * 0.52 + 0.34)),
      archetypeId: tree.archetypeId,
      crownScale: tree.crownScale,
    });
  }

  const heroRocks: Array<{ x: number; z: number; yaw: number; scale: number; variant: number }> = [
    { x: world.spawn.x + 13.6, z: world.spawn.z + 9.8, yaw: 0.32, scale: 1.2, variant: 0 },
    { x: world.spawn.x + 22.7, z: world.spawn.z + 21.4, yaw: 1.12, scale: 1.38, variant: 2 },
    { x: world.spawn.x + 30.2, z: world.spawn.z + 16.8, yaw: 2.04, scale: 0.94, variant: 1 },
  ];

  for (const rock of heroRocks) {
    const sample = sampleTerrain(world, rock.x, rock.z);
    rockSpawns.push({
      x: rock.x,
      y: sample.height + 0.18,
      z: rock.z,
      yaw: rock.yaw,
      scale: rock.scale,
      variant: rock.variant,
    });
  }

  const heroFerns: Array<{ x: number; z: number; yaw: number; scale: number; variant: number }> = [
    { x: world.spawn.x + 9.8, z: world.spawn.z + 16.7, yaw: 0.4, scale: 1.08, variant: 0 },
    { x: world.spawn.x + 15.4, z: world.spawn.z + 19.3, yaw: 1.7, scale: 0.92, variant: 1 },
    { x: world.spawn.x + 19.2, z: world.spawn.z + 11.1, yaw: 2.22, scale: 1.02, variant: 0 },
    { x: world.spawn.x + 26.8, z: world.spawn.z + 24.2, yaw: 0.9, scale: 1.12, variant: 1 },
  ];

  for (const fern of heroFerns) {
    const sample = sampleTerrain(world, fern.x, fern.z);
    fernSpawns.push({
      x: fern.x,
      y: sample.height + 0.05,
      z: fern.z,
      yaw: fern.yaw,
      scale: fern.scale,
      variant: fern.variant,
    });
  }

  const logX = world.spawn.x + 18.4;
  const logZ = world.spawn.z + 9.3;
  const logSample = sampleTerrain(world, logX, logZ);
  logSpawns.push({
    x: logX,
    y: logSample.height + 0.26,
    z: logZ,
    yaw: 0.54,
    pitch: -0.04,
    length: 8.4,
    radius: 0.34,
  });
}
