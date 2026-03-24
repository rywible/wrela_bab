import { lerp, mixColor, normalize3, smoothstep } from "./mathUtils";
import type {
  TerrainSample,
  WorldLayoutConfig,
  WorldSpawnPoint,
  WorldSimulationData,
  WorldSimulationSummary,
} from "./worldSimulation";
import {
  chooseSpawnLocation,
  createDefaultWorldLayoutConfig,
  createWorldSimulationData,
  getSurfaceHeight,
  getWorldBounds,
  sampleTerrain,
} from "./worldSimulation";
import {
  buildChunk,
  buildRedwoodArchetypes,
  chunkCoordFromPosition,
  chunkOrigin,
} from "./chunkBuilder";

export type {
  TerrainSample,
  WorldLayoutConfig,
  WorldSpawnPoint,
  WorldSimulationData,
  WorldSimulationSummary,
};
export {
  buildChunk,
  buildRedwoodArchetypes,
  chunkCoordFromPosition,
  chunkOrigin,
  chooseSpawnLocation,
  createDefaultWorldLayoutConfig,
  createWorldSimulationData,
  getSurfaceHeight,
  getWorldBounds,
  sampleTerrain,
};

export type WorldSeed = number;
export type QualityPreset = "laptop" | "quality";
export type BiomeFields = TerrainSample;
export type TerrainDebugView =
  | "coastDistance"
  | "flowAccumulation"
  | "floodplain"
  | "fogExposure"
  | "redwoodSuitability";

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
  debugColors: Record<TerrainDebugView, number[]>;
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
    redwoodSuitability: number;
    fogExposure: number;
    streamCoverage: number;
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
    simulation: {
      watersheds: number;
      streamCoverage: number;
      suitabilityMean: number;
      suitabilityMax: number;
      landCoverage: number;
    };
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

export function makeChunkId(coord: ChunkCoord) {
  return `${coord.x}:${coord.z}`;
}

export function createAtmosphereState(elapsedSeconds: number): AtmosphereState {
  const dayPhase = 0.44 + Math.sin(elapsedSeconds * 0.02) * 0.04;
  const warmth = smoothstep(0.18, 0.82, dayPhase);
  const sunAltitude = lerp(0.18, 0.42, warmth);
  const sunAzimuth = -1.12 + Math.sin(elapsedSeconds * 0.01) * 0.06;
  const sunDirection = normalize3([
    Math.cos(sunAzimuth) * 0.78,
    -sunAltitude,
    Math.sin(sunAzimuth) * 0.48,
  ]);

  const skyTop = mixColor([0.14, 0.2, 0.4], [0.34, 0.54, 0.82], warmth);
  const horizon = mixColor([0.88, 0.66, 0.38], [0.99, 0.89, 0.66], warmth);
  const ground = mixColor([0.07, 0.08, 0.08], [0.16, 0.17, 0.13], warmth);
  const fogColor = mixColor([0.28, 0.34, 0.36], [0.62, 0.71, 0.7], warmth);

  return {
    dayPhase,
    sunDirection,
    sunColor: mixColor([0.98, 0.78, 0.48], [1, 0.97, 0.88], warmth),
    skyTop,
    horizon,
    ground,
    fogColor,
    fogDensity: lerp(0.0036, 0.0016, warmth),
    ambientColor: mixColor([0.18, 0.24, 0.2], [0.32, 0.42, 0.32], warmth),
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
  simulation: WorldSimulationSummary;
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
      simulation: {
        watersheds: input.simulation.watershedCount,
        streamCoverage: input.simulation.streamCoverage,
        suitabilityMean: input.simulation.suitabilityMean,
        suitabilityMax: input.simulation.suitabilityMax,
        landCoverage: input.simulation.landCoverage,
      },
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
