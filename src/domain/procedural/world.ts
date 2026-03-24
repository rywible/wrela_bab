export type WorldSeed = number;
export type QualityPreset = "laptop" | "quality";

export interface ChunkCoord {
  x: number;
  z: number;
}

export interface ChunkRequest {
  coord: ChunkCoord;
  lod: 0 | 1 | 2;
  seed: WorldSeed;
  chunkSize: number;
  resolution: number;
}

export interface BiomeFields {
  height: number;
  slope: number;
  drainage: number;
  moisture: number;
  concavity: number;
  canopyOpenness: number;
  grove: number;
  glen: number;
  vista: number;
  creek: number;
  oldGrowth: number;
}

export interface TreeArchetype {
  id: number;
  height: number;
  baseRadius: number;
  crownStart: number;
  crownRadius: number;
  lean: number;
  branchCount: number;
  canopyClusters: number;
  barkWarmth: number;
  crownLift: number;
}

export interface TreeSpawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  radius: number;
  archetypeId: number;
  crownScale: number;
}

export interface PropSpawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  variant: number;
}

export interface LogSpawn {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  length: number;
  radius: number;
}

export interface CylinderCollider {
  x: number;
  z: number;
  radius: number;
  minY: number;
  maxY: number;
}

export interface CollisionBatch {
  trunks: CylinderCollider[];
  logs: CylinderCollider[];
}

export interface TerrainChunkData {
  id: string;
  coord: ChunkCoord;
  lod: 0 | 1 | 2;
  chunkSize: number;
  resolution: number;
  positions: number[];
  indices: number[];
  normals: number[];
  colors: number[];
  minHeight: number;
  maxHeight: number;
  treeSpawns: TreeSpawn[];
  rockSpawns: PropSpawn[];
  fernSpawns: PropSpawn[];
  logSpawns: LogSpawn[];
  collisions: CollisionBatch;
  biomeSummary: {
    grove: number;
    glen: number;
    moisture: number;
  };
}

export interface AtmosphereState {
  dayPhase: number;
  sunDirection: [number, number, number];
  sunColor: [number, number, number];
  skyTop: [number, number, number];
  horizon: [number, number, number];
  ground: [number, number, number];
  fogColor: [number, number, number];
  fogDensity: number;
  ambientColor: [number, number, number];
}

export interface PlayerSnapshot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: "walk" | "fly";
  currentChunk: ChunkCoord;
}

export interface WorldSnapshot {
  mode: "loading" | "running" | "unsupported" | "error";
  status: string;
  coordinateSystem: string;
  player: PlayerSnapshot;
  world: {
    seed: number;
    loadedChunks: number;
    visibleChunkIds: string[];
    trees: number;
    rocks: number;
    ferns: number;
    logs: number;
  };
  atmosphere: {
    dayPhase: number;
    fogDensity: number;
    sunDirection: [number, number, number];
  };
  controls: {
    move: string;
    flyToggle: string;
    flyVertical: string;
    reset: string;
  };
  runtime: {
    status: string;
    ack: number;
    tick: number;
    drawCalls: number;
  };
}

const CHUNK_TREE_CELL_SIZE = 8;
const ROCK_CELL_SIZE = 11;
const FERN_CELL_SIZE = 5;
const LOG_CELL_SIZE = 26;

export function makeChunkId(coord: ChunkCoord) {
  return `${coord.x}:${coord.z}`;
}

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

export function createAtmosphereState(elapsedSeconds: number): AtmosphereState {
  const dayPhase = 0.58 + Math.sin(elapsedSeconds * 0.02) * 0.06;
  const sunAltitude = lerp(0.24, 0.66, dayPhase);
  const sunAzimuth = -0.72 + Math.sin(elapsedSeconds * 0.01) * 0.1;
  const sunDirection = normalize3([
    Math.cos(sunAzimuth) * 0.7,
    -sunAltitude,
    Math.sin(sunAzimuth) * 0.55,
  ]);

  const warmth = smoothstep(0.2, 0.8, dayPhase);
  const skyTop = mixColor([0.28, 0.42, 0.58], [0.46, 0.66, 0.86], warmth);
  const horizon = mixColor([0.78, 0.63, 0.42], [0.97, 0.9, 0.67], warmth);
  const ground = mixColor([0.12, 0.13, 0.12], [0.2, 0.21, 0.17], warmth);
  const fogColor = mixColor([0.41, 0.48, 0.44], [0.73, 0.78, 0.72], warmth);

  return {
    dayPhase,
    sunDirection,
    sunColor: mixColor([0.98, 0.82, 0.56], [1, 0.98, 0.9], warmth),
    skyTop,
    horizon,
    ground,
    fogColor,
    fogDensity: lerp(0.0062, 0.0038, warmth),
    ambientColor: mixColor([0.32, 0.38, 0.27], [0.48, 0.58, 0.43], warmth),
  };
}

export function buildRedwoodArchetypes(seed: WorldSeed): TreeArchetype[] {
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

export function sampleTerrain(seed: WorldSeed, x: number, z: number): BiomeFields {
  const warpX = (valueNoise2D(seed + 11, x * 0.01, z * 0.01) * 2 - 1) * 18;
  const warpZ = (valueNoise2D(seed + 19, x * 0.01, z * 0.01) * 2 - 1) * 18;
  const sx = x + warpX;
  const sz = z + warpZ;

  const rolling = fbm2D(seed + 101, sx * 0.006, sz * 0.006, 5, 2.1, 0.5);
  const ridges = ridgedFbm2D(seed + 151, sx * 0.012, sz * 0.012, 4, 2.05, 0.52);
  const undulation = fbm2D(seed + 181, sx * 0.025, sz * 0.025, 3, 2.2, 0.45);
  const creekBand = 1 - Math.abs(valueNoise2D(seed + 197, sx * 0.0045, sz * 0.0045) * 2 - 1);
  const creek = smoothstep(0.58, 0.94, creekBand);

  const baseHeight = 3 + rolling * 12 + ridges * 8 + undulation * 2 - creek * 1.8;
  const hx = sampleHeight(seed, x + 0.9, z) - sampleHeight(seed, x - 0.9, z);
  const hz = sampleHeight(seed, x, z + 0.9) - sampleHeight(seed, x, z - 0.9);
  const slope = clamp01(Math.hypot(hx, hz) / 4.2);

  const neighborhood =
    sampleHeight(seed, x - 1.7, z) +
    sampleHeight(seed, x + 1.7, z) +
    sampleHeight(seed, x, z - 1.7) +
    sampleHeight(seed, x, z + 1.7);
  const concavity = clamp01((baseHeight * 4 - neighborhood) * 0.12 + 0.5);

  const moistureNoise = fbm2D(seed + 227, sx * 0.0065, sz * 0.0065, 4, 2.15, 0.48);
  const grove = smoothstep(0.46, 0.78, valueNoise2D(seed + 251, sx * 0.0037, sz * 0.0037));
  const glen = smoothstep(0.72, 0.9, valueNoise2D(seed + 281, sx * 0.0039, sz * 0.0039));
  const vista = smoothstep(0.6, 0.88, valueNoise2D(seed + 307, sx * 0.0028, sz * 0.0028));
  const drainage = clamp01(0.55 - baseHeight / 30 + creek * 0.65 + concavity * 0.2);
  const moisture = clamp01(moistureNoise * 0.6 + drainage * 0.45 + grove * 0.15);
  const canopyOpenness = clamp01(glen * 0.8 + (1 - grove) * 0.22 + slope * 0.18);
  const oldGrowth = clamp01(grove * 0.72 + moisture * 0.18 - canopyOpenness * 0.2 + 0.16);

  return {
    height: baseHeight,
    slope,
    drainage,
    moisture,
    concavity,
    canopyOpenness,
    grove,
    glen,
    vista,
    creek,
    oldGrowth,
  };
}

export function buildChunk(request: ChunkRequest): TerrainChunkData {
  const { chunkSize, resolution, coord, lod, seed } = request;
  const origin = chunkOrigin(coord, chunkSize);
  const positions: number[] = [];
  const indices: number[] = [];
  const normals = Array.from({ length: (resolution + 1) * (resolution + 1) * 3 }, () => 0);
  const colors: number[] = [];
  const heights: number[][] = [];

  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let moistureSum = 0;
  let groveSum = 0;
  let glenSum = 0;

  for (let z = 0; z <= resolution; z++) {
    const row: number[] = [];
    for (let x = 0; x <= resolution; x++) {
      const worldX = origin.x + (x / resolution) * chunkSize;
      const worldZ = origin.z + (z / resolution) * chunkSize;
      const fields = sampleTerrain(seed, worldX, worldZ);
      row.push(fields.height);

      minHeight = Math.min(minHeight, fields.height);
      maxHeight = Math.max(maxHeight, fields.height);
      moistureSum += fields.moisture;
      groveSum += fields.grove;
      glenSum += fields.glen;

      positions.push(worldX, fields.height, worldZ);
      colors.push(...terrainColor(fields), 1);
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
      const left = heights[z][Math.max(0, x - 1)];
      const right = heights[z][Math.min(resolution, x + 1)];
      const down = heights[Math.max(0, z - 1)][x];
      const up = heights[Math.min(resolution, z + 1)][x];
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

  const treeSpawns = generateTreeSpawns(seed, coord, chunkSize, lod);
  const rockSpawns = generateRockSpawns(seed, coord, chunkSize, lod);
  const fernSpawns = generateFernSpawns(seed, coord, chunkSize, lod);
  const logSpawns = generateLogSpawns(seed, coord, chunkSize, lod);
  injectHeroGrove(seed, coord, treeSpawns, rockSpawns, fernSpawns, logSpawns);

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

  return {
    id: makeChunkId(coord),
    coord,
    lod,
    chunkSize,
    resolution,
    positions,
    indices,
    normals,
    colors,
    minHeight,
    maxHeight,
    treeSpawns,
    rockSpawns,
    fernSpawns,
    logSpawns,
    collisions,
    biomeSummary: {
      grove: groveSum / ((resolution + 1) * (resolution + 1)),
      glen: glenSum / ((resolution + 1) * (resolution + 1)),
      moisture: moistureSum / ((resolution + 1) * (resolution + 1)),
    },
  };
}

export function terrainResolutionForLod(lod: 0 | 1 | 2) {
  return lod === 0 ? 28 : lod === 1 ? 20 : 12;
}

export function createWorldSnapshot(input: {
  player: PlayerSnapshot;
  visibleChunkIds: string[];
  worldSeed: number;
  trees: number;
  rocks: number;
  ferns: number;
  logs: number;
  atmosphere: AtmosphereState;
  runtime: { ack: number; tick: number; drawCalls: number; status: string };
  mode: WorldSnapshot["mode"];
  status: string;
}): WorldSnapshot {
  return {
    mode: input.mode,
    status: input.status,
    coordinateSystem: "origin at world center, x east-west, z north-south, y up",
    player: input.player,
    world: {
      seed: input.worldSeed,
      loadedChunks: input.visibleChunkIds.length,
      visibleChunkIds: input.visibleChunkIds.slice(0, 12),
      trees: input.trees,
      rocks: input.rocks,
      ferns: input.ferns,
      logs: input.logs,
    },
    atmosphere: {
      dayPhase: input.atmosphere.dayPhase,
      fogDensity: input.atmosphere.fogDensity,
      sunDirection: input.atmosphere.sunDirection,
    },
    controls: {
      move: "ArrowUp/ArrowDown forward/back, ArrowLeft/ArrowRight turn",
      flyToggle: "B",
      flyVertical: "Space up, A down while flying",
      reset: "Enter",
    },
    runtime: input.runtime,
  };
}

function sampleHeight(seed: number, x: number, z: number) {
  const warpX = (valueNoise2D(seed + 11, x * 0.01, z * 0.01) * 2 - 1) * 18;
  const warpZ = (valueNoise2D(seed + 19, x * 0.01, z * 0.01) * 2 - 1) * 18;
  const sx = x + warpX;
  const sz = z + warpZ;
  const rolling = fbm2D(seed + 101, sx * 0.006, sz * 0.006, 5, 2.1, 0.5);
  const ridges = ridgedFbm2D(seed + 151, sx * 0.012, sz * 0.012, 4, 2.05, 0.52);
  const undulation = fbm2D(seed + 181, sx * 0.025, sz * 0.025, 3, 2.2, 0.45);
  const creekBand = 1 - Math.abs(valueNoise2D(seed + 197, sx * 0.0045, sz * 0.0045) * 2 - 1);
  const creek = smoothstep(0.58, 0.94, creekBand);
  return 3 + rolling * 12 + ridges * 8 + undulation * 2 - creek * 1.8;
}

function terrainColor(fields: BiomeFields): [number, number, number] {
  const grove = clamp01(fields.grove * 0.8 + fields.oldGrowth * 0.2);
  const rockiness = clamp01(fields.slope * 1.15);
  const damp = clamp01(fields.moisture * 0.9 + fields.creek * 0.3);
  const clearing = clamp01(fields.glen * 0.9 + fields.canopyOpenness * 0.2);

  const soil = mixColor([0.28, 0.2, 0.14], [0.43, 0.32, 0.2], clearing);
  const moss = mixColor([0.16, 0.26, 0.12], [0.28, 0.4, 0.2], damp);
  const rock = mixColor([0.34, 0.36, 0.34], [0.48, 0.5, 0.46], fields.height / 24);
  const woodWarm = mixColor(soil, moss, grove * 0.6);

  return mixColor(woodWarm, rock, rockiness * 0.72);
}

function generateTreeSpawns(seed: number, coord: ChunkCoord, chunkSize: number, lod: 0 | 1 | 2) {
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
      const fields = sampleTerrain(seed, x, z);
      const density =
        fields.grove * 0.9 +
        fields.oldGrowth * 0.4 +
        fields.moisture * 0.15 -
        fields.glen * 0.85 -
        fields.slope * 0.6;

      if (density < 0.18 || hash01(seed + 577, cellX, cellZ) > density * lodDensity) {
        continue;
      }

      const influenceRadius = lerp(4.8, 8.2, clamp01(fields.oldGrowth * 0.8 + fields.grove * 0.2));
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
        0.82,
        1.38,
        clamp01(fields.oldGrowth * 0.7 + hash01(seed + 601, cellX, cellZ) * 0.3),
      );
      const spawn: TreeSpawn & { influenceRadius: number } = {
        x,
        y: fields.height,
        z,
        yaw: hash01(seed + 617, cellX, cellZ) * Math.PI * 2,
        scale,
        radius: lerp(0.85, 1.45, fields.oldGrowth),
        archetypeId: Math.floor(hash01(seed + 641, cellX, cellZ) * 3) % 3,
        crownScale: lerp(0.85, 1.2, fields.moisture),
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

function generateRockSpawns(seed: number, coord: ChunkCoord, chunkSize: number, lod: 0 | 1 | 2) {
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

      const fields = sampleTerrain(seed, x, z);
      const chance = clamp01(fields.slope * 0.45 + fields.glen * 0.25 + 0.08);
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

function generateFernSpawns(seed: number, coord: ChunkCoord, chunkSize: number, lod: 0 | 1 | 2) {
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

      const fields = sampleTerrain(seed, x, z);
      const shade = 1 - fields.canopyOpenness;
      const chance = clamp01(fields.moisture * 0.55 + shade * 0.3 - fields.slope * 0.2);
      if (hash01(seed + 853, cellX, cellZ) > chance * (lod === 1 ? 0.55 : 0.95)) {
        continue;
      }

      spawns.push({
        x,
        y: fields.height + 0.05,
        z,
        yaw: hash01(seed + 877, cellX, cellZ) * Math.PI * 2,
        scale: lerp(0.55, 1.1, hash01(seed + 907, cellX, cellZ)),
        variant: Math.floor(hash01(seed + 929, cellX, cellZ) * 2),
      });
    }
  }

  return spawns;
}

function generateLogSpawns(seed: number, coord: ChunkCoord, chunkSize: number, lod: 0 | 1 | 2) {
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

      const fields = sampleTerrain(seed, x, z);
      if (fields.oldGrowth < 0.38 || fields.glen > 0.74 || fields.slope > 0.42) {
        continue;
      }

      spawns.push({
        x,
        y: fields.height + 0.28,
        z,
        yaw: hash01(seed + 1013, cellX, cellZ) * Math.PI * 2,
        pitch: lerp(-0.08, 0.08, hash01(seed + 1031, cellX, cellZ)),
        length: lerp(5.8, 10.2, hash01(seed + 1051, cellX, cellZ)),
        radius: lerp(0.24, 0.48, hash01(seed + 1069, cellX, cellZ)),
      });
    }
  }

  return spawns;
}

function injectHeroGrove(
  seed: number,
  coord: ChunkCoord,
  treeSpawns: TreeSpawn[],
  rockSpawns: PropSpawn[],
  fernSpawns: PropSpawn[],
  logSpawns: LogSpawn[],
) {
  if (coord.x !== 0 || coord.z !== 0) {
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
    { x: 10.5, z: 12.5, yaw: 0.1, scale: 1.18, archetypeId: 1, crownScale: 1.12 },
    { x: 17.2, z: 15.8, yaw: 0.46, scale: 1.32, archetypeId: 2, crownScale: 1.18 },
    { x: 24.4, z: 13.4, yaw: 0.78, scale: 1.1, archetypeId: 0, crownScale: 1.08 },
    { x: 12.4, z: 22.6, yaw: 0.94, scale: 1.24, archetypeId: 1, crownScale: 1.14 },
    { x: 20.6, z: 24.8, yaw: 1.21, scale: 1.36, archetypeId: 2, crownScale: 1.2 },
    { x: 28.8, z: 19.2, yaw: 0.38, scale: 1.16, archetypeId: 0, crownScale: 1.06 },
  ];

  for (const tree of heroTrees) {
    const fields = sampleTerrain(seed, tree.x, tree.z);
    treeSpawns.push({
      x: tree.x,
      y: fields.height,
      z: tree.z,
      yaw: tree.yaw,
      scale: tree.scale,
      radius: lerp(1.08, 1.44, fields.oldGrowth * 0.7 + 0.3),
      archetypeId: tree.archetypeId,
      crownScale: tree.crownScale,
    });
  }

  const heroRocks: Array<{ x: number; z: number; yaw: number; scale: number; variant: number }> = [
    { x: 13.6, z: 9.8, yaw: 0.32, scale: 1.2, variant: 0 },
    { x: 22.7, z: 21.4, yaw: 1.12, scale: 1.38, variant: 2 },
    { x: 30.2, z: 16.8, yaw: 2.04, scale: 0.94, variant: 1 },
  ];

  for (const rock of heroRocks) {
    rockSpawns.push({
      x: rock.x,
      y: sampleTerrain(seed, rock.x, rock.z).height + 0.18,
      z: rock.z,
      yaw: rock.yaw,
      scale: rock.scale,
      variant: rock.variant,
    });
  }

  const heroFerns: Array<{ x: number; z: number; yaw: number; scale: number; variant: number }> = [
    { x: 9.8, z: 16.7, yaw: 0.4, scale: 1.08, variant: 0 },
    { x: 15.4, z: 19.3, yaw: 1.7, scale: 0.92, variant: 1 },
    { x: 19.2, z: 11.1, yaw: 2.22, scale: 1.02, variant: 0 },
    { x: 26.8, z: 24.2, yaw: 0.9, scale: 1.12, variant: 1 },
  ];

  for (const fern of heroFerns) {
    fernSpawns.push({
      x: fern.x,
      y: sampleTerrain(seed, fern.x, fern.z).height + 0.05,
      z: fern.z,
      yaw: fern.yaw,
      scale: fern.scale,
      variant: fern.variant,
    });
  }

  logSpawns.push({
    x: 18.4,
    y: sampleTerrain(seed, 18.4, 9.3).height + 0.26,
    z: 9.3,
    yaw: 0.54,
    pitch: -0.04,
    length: 8.4,
    radius: 0.34,
  });
}

function hash01(seed: number, x: number, y = 0) {
  const value = Math.sin(seed * 12.9898 + x * 78.233 + y * 37.719) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2D(seed: number, x: number, y: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;

  const v00 = hash01(seed, x0, y0);
  const v10 = hash01(seed, x0 + 1, y0);
  const v01 = hash01(seed, x0, y0 + 1);
  const v11 = hash01(seed, x0 + 1, y0 + 1);

  const sx = smoothstep(0, 1, tx);
  const sy = smoothstep(0, 1, ty);

  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy);
}

function fbm2D(
  seed: number,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
) {
  let amplitude = 0.5;
  let frequency = 1;
  let value = 0;
  let sum = 0;

  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise2D(seed + octave * 97, x * frequency, y * frequency) * amplitude;
    sum += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return sum > 0 ? value / sum : 0;
}

function ridgedFbm2D(
  seed: number,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
) {
  let amplitude = 0.55;
  let frequency = 1;
  let value = 0;
  let sum = 0;

  for (let octave = 0; octave < octaves; octave++) {
    const sample = valueNoise2D(seed + octave * 53, x * frequency, y * frequency);
    value += (1 - Math.abs(sample * 2 - 1)) * amplitude;
    sum += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }

  return sum > 0 ? value / sum : 0;
}

function normalize3(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function mixColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothstep(min: number, max: number, value: number) {
  const t = clamp01((value - min) / (max - min));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
