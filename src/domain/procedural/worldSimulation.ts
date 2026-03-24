import {
  diffuseField,
  getSurfaceHeight,
  gridIndex,
  sampleTerrain,
  worldXFromIndex,
  worldZFromIndex,
  getWorldBounds,
} from "./gridOps";
import {
  computeFlowNetwork,
  erodeMacroSurface,
  buildHydrologyAndLandforms,
  buildClimateAndEcology,
} from "./hydrology";
import { clamp01, fbm2D, gaussian, hash01, lerp, smoothstep, valueNoise2D } from "./mathUtils";
import { chooseCaptureViewpoints, chooseSpawnLocation, summarizeWorld } from "./viewpoints";

export { chooseSpawnLocation, getSurfaceHeight, getWorldBounds, sampleTerrain };

export interface WorldLayoutConfig {
  worldSizeMeters: number;
  fieldResolution: number;
  seaLevel: number;
  worldMinX: number;
  worldMinZ: number;
  prevailingWind: [number, number];
  primaryRidgeBands: number;
  watershedCount: number;
  erosionIterations: number;
  fogReachMeters: number;
  saltSprayMeters: number;
}

export type WorldFieldName =
  | "baseElevation"
  | "coastDistance"
  | "uplift"
  | "flowAccumulation"
  | "streamOrder"
  | "incision"
  | "deposition"
  | "soilDepth"
  | "fogExposure"
  | "rainfall"
  | "moisture"
  | "redwoodSuitability"
  | "channelWidth"
  | "floodplain"
  | "northness"
  | "shoulderness"
  | "saltExposure";

export interface WorldSimulationSummary {
  watershedCount: number;
  streamCoverage: number;
  suitabilityMean: number;
  suitabilityMax: number;
  landCoverage: number;
}

export interface WorldSpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface WorldCameraBookmark {
  position: [number, number, number];
  target: [number, number, number];
}

export interface WorldSimulationData {
  seed: number;
  config: WorldLayoutConfig;
  fields: Record<WorldFieldName, Float32Array>;
  macroElevation: Float32Array;
  filledElevation: Float32Array;
  receivers: Int32Array;
  distanceToStream: Float32Array;
  fogPersistence: Float32Array;
  spawn: WorldSpawnPoint;
  viewpoints: Record<"overview" | "grove" | "valley" | "ridge", WorldCameraBookmark>;
  summary: WorldSimulationSummary;
}

export interface TerrainSample {
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
  redwoodSuitability: number;
  distanceToStream: number;
  fogPersistence: number;
  soilDepth: number;
  aspect: number;
  coastDistance: number;
  flowAccumulation: number;
  fogExposure: number;
  rainfall: number;
  streamOrder: number;
  baseElevation: number;
  uplift: number;
  channelWidth: number;
  floodplain: number;
  northness: number;
  shoulderness: number;
  saltExposure: number;
}

const WORLD_FIELD_NAMES: WorldFieldName[] = [
  "baseElevation",
  "coastDistance",
  "uplift",
  "flowAccumulation",
  "streamOrder",
  "incision",
  "deposition",
  "soilDepth",
  "fogExposure",
  "rainfall",
  "moisture",
  "redwoodSuitability",
  "channelWidth",
  "floodplain",
  "northness",
  "shoulderness",
  "saltExposure",
];

const worldSimulationCache = new Map<string, WorldSimulationData>();

export function createDefaultWorldLayoutConfig(seed: number): WorldLayoutConfig {
  return {
    worldSizeMeters: 65_536,
    fieldResolution: 768,
    seaLevel: 0,
    worldMinX: -4_096,
    worldMinZ: -32_768,
    prevailingWind: [1, 0],
    primaryRidgeBands: 2,
    watershedCount: 3 + Math.floor(hash01(seed + 811, 3, 9) * 3),
    erosionIterations: 12,
    fogReachMeters: 18_000,
    saltSprayMeters: 1_900,
  };
}

export function createWorldSimulationData(
  seed: number,
  overrides: Partial<WorldLayoutConfig> = {},
): WorldSimulationData {
  const config = {
    ...createDefaultWorldLayoutConfig(seed),
    ...overrides,
  };
  const cacheKey = JSON.stringify({ seed, ...config });
  const cached = worldSimulationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const cellCount = config.fieldResolution * config.fieldResolution;
  const fields = Object.fromEntries(
    WORLD_FIELD_NAMES.map((fieldName) => [fieldName, new Float32Array(cellCount)]),
  ) as Record<WorldFieldName, Float32Array>;
  const macroElevation = new Float32Array(cellCount);
  const filledElevation = new Float32Array(cellCount);
  const receivers = new Int32Array(cellCount).fill(-1);
  const distanceToStream = new Float32Array(cellCount);
  const fogPersistence = new Float32Array(cellCount);
  const coastlineByRow = new Float32Array(config.fieldResolution);
  const outletCenters = buildOutletCenters(seed, config.watershedCount);

  buildLayout(seed, config, fields, coastlineByRow, outletCenters);

  const initialNetwork = computeFlowNetwork(config, fields.baseElevation, fields.coastDistance);
  const erodedSurface = erodeMacroSurface(config, fields, initialNetwork);
  const finalNetwork = computeFlowNetwork(config, erodedSurface, fields.coastDistance);

  filledElevation.set(finalNetwork.filled);
  receivers.set(finalNetwork.receivers);
  buildHydrologyAndLandforms(
    seed,
    config,
    fields,
    finalNetwork,
    erodedSurface,
    macroElevation,
    distanceToStream,
  );
  buildClimateAndEcology(seed, config, fields, macroElevation, distanceToStream, fogPersistence);

  const provisionalWorld = {
    seed,
    config,
    fields,
    macroElevation,
    filledElevation,
    receivers,
    distanceToStream,
    fogPersistence,
    spawn: { x: 0, y: 0, z: 0, yaw: -Math.PI / 2 },
    viewpoints: {
      overview: { position: [-14, 42, -34], target: [19, 19, 19] },
      grove: { position: [24, 18, 34], target: [0, 10, 0] },
      valley: { position: [120, 90, 260], target: [0, 20, 0] },
      ridge: { position: [1_400, 180, -480], target: [900, 60, 0] },
    },
    summary: {
      watershedCount: config.watershedCount,
      streamCoverage: 0,
      suitabilityMean: 0,
      suitabilityMax: 0,
      landCoverage: 0,
    },
  } satisfies WorldSimulationData;

  provisionalWorld.spawn = chooseSpawnLocation(provisionalWorld);
  provisionalWorld.viewpoints = chooseCaptureViewpoints(provisionalWorld);
  provisionalWorld.summary = summarizeWorld(provisionalWorld);
  worldSimulationCache.set(cacheKey, provisionalWorld);
  return provisionalWorld;
}

function buildLayout(
  seed: number,
  config: WorldLayoutConfig,
  fields: Record<WorldFieldName, Float32Array>,
  coastlineByRow: Float32Array,
  outletCenters: number[],
) {
  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    const v = zIndex / (config.fieldResolution - 1);
    const z = worldZFromIndex(config, zIndex);
    coastlineByRow[zIndex] = sampleCoastline(seed, config, z, v);
  }

  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    const v = zIndex / (config.fieldResolution - 1);
    const z = worldZFromIndex(config, zIndex);
    const coastline = coastlineByRow[zIndex]!;
    const rowWarp = (fbm2D(seed + 41, z * 0.00005, v * 0.9, 3, 2.05, 0.5) - 0.5) * 0.08;

    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const x = worldXFromIndex(config, xIndex);
      const index = gridIndex(config, xIndex, zIndex);
      const coastDistance = Math.max(0, x - coastline);
      const inlandT = clamp01(coastDistance / (config.worldSizeMeters * 0.78));

      let outletCorridor = 0;
      for (let outletIndex = 0; outletIndex < outletCenters.length; outletIndex++) {
        const center = outletCenters[outletIndex]!;
        const meander =
          (valueNoise2D(seed + 79 + outletIndex * 11, inlandT * 3.6, v * 4.2) - 0.5) *
          lerp(0.012, 0.062, inlandT);
        const width = lerp(0.085, 0.03, inlandT);
        outletCorridor = Math.max(outletCorridor, gaussian(v, center + meander, width));
      }

      const ridgeOne = gaussian(inlandT, 0.2 + rowWarp, 0.052) * 132;
      const ridgeTwo = gaussian(inlandT, 0.43 + rowWarp * 0.8, 0.066) * 116;
      const inlandRise = Math.pow(inlandT, 1.02) * 196;
      const eastDivide = smoothstep(0.54, 0.92, inlandT) * 86;
      const coastalBluff =
        smoothstep(60, 1_150, coastDistance) * (1 - smoothstep(1_800, 5_600, coastDistance)) * 58;
      const marineTerrace =
        smoothstep(220, 2_400, coastDistance) * (1 - smoothstep(2_900, 12_000, coastDistance)) * 30;
      const spurNoise = (fbm2D(seed + 109, x * 0.00006, z * 0.00008, 4, 2.0, 0.48) - 0.5) * 34;
      const valleyCut =
        outletCorridor * smoothstep(360, 28_000, coastDistance) * lerp(24, 112, inlandT);
      const watershedBasin =
        outletCorridor *
        smoothstep(1_800, 16_000, coastDistance) *
        (1 - smoothstep(20_000, 40_000, coastDistance)) *
        18;
      const baseElevation =
        config.seaLevel +
        coastalBluff +
        marineTerrace +
        inlandRise +
        ridgeOne +
        ridgeTwo +
        eastDivide +
        spurNoise -
        valleyCut -
        watershedBasin;
      const uplift = Math.max(
        0,
        inlandRise + ridgeOne * 0.92 + ridgeTwo * 0.84 + eastDivide * 0.55,
      );

      if (x < coastline) {
        const oceanT = clamp01((coastline - x) / 4_200);
        fields.baseElevation[index] = config.seaLevel - lerp(1.8, 24, oceanT) - (1 - inlandT) * 1.8;
        fields.coastDistance[index] = 0;
        fields.uplift[index] = 0;
        continue;
      }

      fields.baseElevation[index] = baseElevation;
      fields.coastDistance[index] = coastDistance;
      fields.uplift[index] = uplift;
    }
  }

  diffuseField(config, fields.baseElevation, 1, 0.08);
}

function sampleCoastline(seed: number, config: WorldLayoutConfig, z: number, v: number) {
  const shelf = 980;
  const wave = Math.sin(v * Math.PI * 2.2 + hash01(seed + 13, 3, 7) * Math.PI) * 260;
  const swell = (fbm2D(seed + 29, z * 0.0001, v * 0.7, 3, 2.0, 0.48) - 0.5) * 620;
  return config.worldMinX + shelf + wave + swell;
}

function buildOutletCenters(seed: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const base = (index + 1) / (count + 1);
    const jitter = (hash01(seed + 137, index, 19) - 0.5) * 0.07;
    return clamp01(base + jitter);
  }).sort((left, right) => left - right);
}
