import { clamp, clamp01, fbm2D, grooveDensity, lerp, smoothstep, valueNoise2D } from "./mathUtils";
import type { TerrainSample, WorldLayoutConfig, WorldSimulationData } from "./worldSimulation";

export const SQRT2 = Math.sqrt(2);

export interface FlowNetwork {
  filled: Float32Array;
  receivers: Int32Array;
  flow: Float32Array;
  order: number[];
}

export function gridIndex(config: WorldLayoutConfig, x: number, z: number) {
  return z * config.fieldResolution + x;
}

export function worldXFromIndex(config: WorldLayoutConfig, xIndex: number) {
  return config.worldMinX + (xIndex / (config.fieldResolution - 1)) * config.worldSizeMeters;
}

export function worldZFromIndex(config: WorldLayoutConfig, zIndex: number) {
  return config.worldMinZ + (zIndex / (config.fieldResolution - 1)) * config.worldSizeMeters;
}

export function clampIndex(index: number, size: number) {
  return Math.min(size - 1, Math.max(0, index));
}

export function neighborOffsets() {
  return [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, SQRT2],
    [1, -1, SQRT2],
    [-1, 1, SQRT2],
    [1, 1, SQRT2],
  ] as const;
}

export function neighborDifference(
  config: WorldLayoutConfig,
  field: Float32Array,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const left =
    field[
      gridIndex(
        config,
        clampIndex(ax, config.fieldResolution),
        clampIndex(az, config.fieldResolution),
      )
    ]!;
  const right =
    field[
      gridIndex(
        config,
        clampIndex(bx, config.fieldResolution),
        clampIndex(bz, config.fieldResolution),
      )
    ]!;
  return right - left;
}

export function localSlope(
  config: WorldLayoutConfig,
  field: Float32Array,
  xIndex: number,
  zIndex: number,
) {
  const slopeX = neighborDifference(config, field, xIndex - 1, zIndex, xIndex + 1, zIndex);
  const slopeZ = neighborDifference(config, field, xIndex, zIndex - 1, xIndex, zIndex + 1);
  return clamp01(Math.hypot(slopeX, slopeZ) / 12);
}

export function receiverDistance(config: WorldLayoutConfig, index: number, receiver: number) {
  const x = index % config.fieldResolution;
  const z = Math.floor(index / config.fieldResolution);
  const rx = receiver % config.fieldResolution;
  const rz = Math.floor(receiver / config.fieldResolution);
  const cellSize = config.worldSizeMeters / (config.fieldResolution - 1);
  return (x === rx || z === rz ? 1 : SQRT2) * cellSize;
}

export function sampleReliefWindow(
  config: WorldLayoutConfig,
  field: Float32Array,
  xIndex: number,
  zIndex: number,
  radius: number,
) {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let offsetZ = -radius; offsetZ <= radius; offsetZ++) {
    for (let offsetX = -radius; offsetX <= radius; offsetX++) {
      const neighborX = clampIndex(xIndex + offsetX, config.fieldResolution);
      const neighborZ = clampIndex(zIndex + offsetZ, config.fieldResolution);
      const value = field[gridIndex(config, neighborX, neighborZ)]!;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }

  return max - min;
}

export function searchNeighborhoodBestIndex(
  world: WorldSimulationData,
  startIndex: number,
  radius: number,
  scorer: (index: number) => number,
) {
  const startX = startIndex % world.config.fieldResolution;
  const startZ = Math.floor(startIndex / world.config.fieldResolution);
  let bestIndex = startIndex;
  let bestScore = scorer(startIndex);

  for (let offsetZ = -radius; offsetZ <= radius; offsetZ++) {
    for (let offsetX = -radius; offsetX <= radius; offsetX++) {
      const xIndex = clampIndex(startX + offsetX, world.config.fieldResolution);
      const zIndex = clampIndex(startZ + offsetZ, world.config.fieldResolution);
      const index = gridIndex(world.config, xIndex, zIndex);
      const score = scorer(index);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }

  return bestIndex;
}

export function sampleField(world: WorldSimulationData, field: Float32Array, x: number, z: number) {
  const sampleX =
    clamp((x - world.config.worldMinX) / world.config.worldSizeMeters, 0, 1) *
    (world.config.fieldResolution - 1);
  const sampleZ =
    clamp((z - world.config.worldMinZ) / world.config.worldSizeMeters, 0, 1) *
    (world.config.fieldResolution - 1);

  const x0 = Math.floor(sampleX);
  const z0 = Math.floor(sampleZ);
  const x1 = Math.min(world.config.fieldResolution - 1, x0 + 1);
  const z1 = Math.min(world.config.fieldResolution - 1, z0 + 1);
  const tx = sampleX - x0;
  const tz = sampleZ - z0;

  const v00 = field[gridIndex(world.config, x0, z0)]!;
  const v10 = field[gridIndex(world.config, x1, z0)]!;
  const v01 = field[gridIndex(world.config, x0, z1)]!;
  const v11 = field[gridIndex(world.config, x1, z1)]!;

  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tz);
}

export function sampleMacroHeight(world: WorldSimulationData, x: number, z: number) {
  return sampleField(world, world.macroElevation, x, z);
}

export function diffuseField(
  config: WorldLayoutConfig,
  field: Float32Array,
  iterations: number,
  strength: number,
) {
  const scratch = new Float32Array(field.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
      for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
        const index = gridIndex(config, xIndex, zIndex);
        let sum = field[index]!;
        let count = 1;

        for (const [offsetX, offsetZ] of neighborOffsets()) {
          const neighborX = xIndex + offsetX;
          const neighborZ = zIndex + offsetZ;
          if (neighborX < 0 || neighborX >= config.fieldResolution) {
            continue;
          }
          if (neighborZ < 0 || neighborZ >= config.fieldResolution) {
            continue;
          }

          sum += field[gridIndex(config, neighborX, neighborZ)]!;
          count += 1;
        }

        scratch[index] = lerp(field[index]!, sum / count, strength);
      }
    }

    field.set(scratch);
  }
}

export function chamferDistance(
  config: WorldLayoutConfig,
  streamOrder: Float32Array,
  output: Float32Array,
  activeThreshold: number,
) {
  const cellSize = config.worldSizeMeters / (config.fieldResolution - 1);
  output.fill(Number.POSITIVE_INFINITY);

  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const index = gridIndex(config, xIndex, zIndex);
      if (streamOrder[index]! >= activeThreshold) {
        output[index] = 0;
      }
    }
  }

  const forwardPass = [
    [-1, 0, 1],
    [0, -1, 1],
    [-1, -1, SQRT2],
    [1, -1, SQRT2],
  ] as const;
  const backwardPass = [
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, SQRT2],
    [-1, 1, SQRT2],
  ] as const;

  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const index = gridIndex(config, xIndex, zIndex);
      let best = output[index]!;
      for (const [offsetX, offsetZ, weight] of forwardPass) {
        const neighborX = xIndex + offsetX;
        const neighborZ = zIndex + offsetZ;
        if (neighborX < 0 || neighborX >= config.fieldResolution) {
          continue;
        }
        if (neighborZ < 0 || neighborZ >= config.fieldResolution) {
          continue;
        }
        best = Math.min(best, output[gridIndex(config, neighborX, neighborZ)]! + weight * cellSize);
      }
      output[index] = best;
    }
  }

  for (let zIndex = config.fieldResolution - 1; zIndex >= 0; zIndex--) {
    for (let xIndex = config.fieldResolution - 1; xIndex >= 0; xIndex--) {
      const index = gridIndex(config, xIndex, zIndex);
      let best = output[index]!;
      for (const [offsetX, offsetZ, weight] of backwardPass) {
        const neighborX = xIndex + offsetX;
        const neighborZ = zIndex + offsetZ;
        if (neighborX < 0 || neighborX >= config.fieldResolution) {
          continue;
        }
        if (neighborZ < 0 || neighborZ >= config.fieldResolution) {
          continue;
        }
        best = Math.min(best, output[gridIndex(config, neighborX, neighborZ)]! + weight * cellSize);
      }
      output[index] = best;
    }
  }
}

export function sampleTerrain(world: WorldSimulationData, x: number, z: number): TerrainSample {
  const baseElevation = sampleField(world, world.fields.baseElevation, x, z);
  const coastDistance = sampleField(world, world.fields.coastDistance, x, z);
  const uplift = sampleField(world, world.fields.uplift, x, z);
  const flowAccumulation = sampleField(world, world.fields.flowAccumulation, x, z);
  const streamOrder = sampleField(world, world.fields.streamOrder, x, z);
  const soilDepth = sampleField(world, world.fields.soilDepth, x, z);
  const fogExposure = sampleField(world, world.fields.fogExposure, x, z);
  const rainfall = sampleField(world, world.fields.rainfall, x, z);
  const moisture = sampleField(world, world.fields.moisture, x, z);
  const redwoodSuitability = sampleField(world, world.fields.redwoodSuitability, x, z);
  const channelWidth = sampleField(world, world.fields.channelWidth, x, z);
  const floodplain = sampleField(world, world.fields.floodplain, x, z);
  const northness = sampleField(world, world.fields.northness, x, z);
  const shoulderness = sampleField(world, world.fields.shoulderness, x, z);
  const saltExposure = sampleField(world, world.fields.saltExposure, x, z);
  const distanceToStream = sampleField(world, world.distanceToStream, x, z);
  const fogPersistence = sampleField(world, world.fogPersistence, x, z);

  const macroHeight = sampleField(world, world.macroElevation, x, z);
  const macroSlope =
    Math.hypot(
      sampleMacroHeight(world, x + 12, z) - sampleMacroHeight(world, x - 12, z),
      sampleMacroHeight(world, x, z + 12) - sampleMacroHeight(world, x, z - 12),
    ) / 24;
  const warpX = (valueNoise2D(world.seed + 1_103, x * 0.007, z * 0.007) * 2 - 1) * 7;
  const warpZ = (valueNoise2D(world.seed + 1_137, x * 0.007, z * 0.007) * 2 - 1) * 7;
  const sx = x + warpX;
  const sz = z + warpZ;
  const bluffBreakup =
    smoothstep(180, 2_200, coastDistance) *
    (1 - smoothstep(3_100, 9_200, coastDistance)) *
    (fbm2D(world.seed + 1_161, sx * 0.012, sz * 0.014, 3, 2.1, 0.48) - 0.5) *
    9.2;
  const terraceShoulder =
    shoulderness * (valueNoise2D(world.seed + 1_193, sx * 0.014, sz * 0.014) - 0.5) * 9.4;
  const rootUndulation =
    (fbm2D(world.seed + 1_227, sx * 0.052, sz * 0.052, 2, 2.3, 0.5) - 0.5) *
    lerp(1.6, 3.4, redwoodSuitability);
  const floodplainFlatten =
    floodplain * (fbm2D(world.seed + 1_261, sx * 0.02, sz * 0.02, 2, 2.0, 0.5) - 0.5) * 0.7;
  const channelSharpen =
    -(1 - smoothstep(0, Math.max(22, channelWidth * 1.4), distanceToStream)) *
    lerp(2.4, 18, smoothstep(0.2, 1, streamOrder / 5));
  const ravineAccent =
    smoothstep(0.28, 0.92, redwoodSuitability) *
    smoothstep(0.16, 0.62, shoulderness + (1 - floodplain) * 0.18) *
    smoothstep(80, 280, distanceToStream) *
    (1 - smoothstep(280, 760, distanceToStream)) *
    (fbm2D(world.seed + 1_283, sx * 0.03, sz * 0.03, 2, 2.0, 0.5) - 0.5) *
    12;
  const groveHummocks =
    smoothstep(0.34, 0.82, redwoodSuitability) *
    (1 - smoothstep(0.12, 0.34, macroSlope)) *
    (fbm2D(world.seed + 1_307, sx * 0.04, sz * 0.04, 3, 2.1, 0.5) - 0.5) *
    6.4;
  const shoulderRibs =
    smoothstep(0.1, 0.48, shoulderness) *
    smoothstep(140, 620, distanceToStream) *
    (1 - smoothstep(620, 1_400, distanceToStream)) *
    (fbm2D(world.seed + 1_331, sx * 0.022, sz * 0.028, 2, 2.2, 0.52) - 0.5) *
    8.2;

  const height =
    macroHeight +
    bluffBreakup +
    terraceShoulder +
    rootUndulation +
    floodplainFlatten +
    channelSharpen +
    ravineAccent +
    groveHummocks +
    shoulderRibs;
  const heightStep = 12;
  const heightX1 = sampleMacroHeight(world, x - heightStep, z);
  const heightX2 = sampleMacroHeight(world, x + heightStep, z);
  const heightZ1 = sampleMacroHeight(world, x, z - heightStep);
  const heightZ2 = sampleMacroHeight(world, x, z + heightStep);
  const dx = (heightX2 - heightX1) / (heightStep * 2);
  const dz = (heightZ2 - heightZ1) / (heightStep * 2);
  const slope = clamp01(Math.hypot(dx, dz) / 0.58);
  const neighborhood = heightX1 + heightX2 + heightZ1 + heightZ2;
  const concavity = clamp01((macroHeight * 4 - neighborhood) * 0.05 + 0.5);
  const aspect = Math.atan2(dz, dx);

  const drainage = clamp01(
    0.18 +
      clamp01(Math.log1p(flowAccumulation) / Math.log1p(world.config.fieldResolution ** 2)) * 0.52 +
      floodplain * 0.14 +
      (1 - smoothstep(0, 280, distanceToStream)) * 0.16,
  );
  const creek = clamp01(
    smoothstep(1, 2.8, streamOrder) * 0.8 +
      (1 - smoothstep(0, 150, distanceToStream)) * 0.5 +
      floodplain * 0.12,
  );
  const grove = clamp01(
    redwoodSuitability * 0.72 +
      shoulderness * 0.12 +
      fogPersistence * 0.1 +
      northness * 0.06 -
      saltExposure * 0.18,
  );
  const glen = clamp01(
    (1 - grooveDensity(redwoodSuitability, slope)) * 0.38 +
      smoothstep(0.5, 1, saltExposure) * 0.12 +
      smoothstep(0.52, 0.88, slope) * 0.2 +
      (1 - shoulderness) * 0.12,
  );
  const vista = clamp01(
    smoothstep(0.34, 0.82, slope) * 0.48 +
      smoothstep(0.24, 0.78, uplift / 82) * 0.32 +
      (1 - redwoodSuitability) * 0.14 +
      smoothstep(0.5, 1, saltExposure) * 0.08,
  );
  const canopyOpenness = clamp01(
    glen * 0.72 + slope * 0.16 + saltExposure * 0.08 + (1 - redwoodSuitability) * 0.18,
  );
  const oldGrowth = clamp01(
    redwoodSuitability * 0.58 +
      soilDepth * 0.14 +
      fogPersistence * 0.12 +
      shoulderness * 0.1 -
      canopyOpenness * 0.12,
  );

  return {
    height,
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
    redwoodSuitability,
    distanceToStream,
    fogPersistence,
    soilDepth,
    aspect,
    coastDistance,
    flowAccumulation,
    fogExposure,
    rainfall,
    streamOrder,
    baseElevation,
    uplift,
    channelWidth,
    floodplain,
    northness,
    shoulderness,
    saltExposure,
  };
}

export function getSurfaceHeight(world: WorldSimulationData, x: number, z: number) {
  return Math.max(world.config.seaLevel, sampleTerrain(world, x, z).height);
}

export function getWorldBounds(world: WorldSimulationData) {
  return {
    minX: world.config.worldMinX,
    maxX: world.config.worldMinX + world.config.worldSizeMeters,
    minZ: world.config.worldMinZ,
    maxZ: world.config.worldMinZ + world.config.worldSizeMeters,
  };
}

export class MinHeap {
  private readonly priorities: number[] = [];
  private readonly indices: number[] = [];

  get size() {
    return this.indices.length;
  }

  push(priority: number, index: number) {
    this.priorities.push(priority);
    this.indices.push(index);
    this.bubbleUp(this.indices.length - 1);
  }

  popIndex() {
    if (this.indices.length === 0) {
      throw new Error("Cannot pop from an empty heap.");
    }

    const topIndex = this.indices[0]!;
    const lastPriority = this.priorities.pop()!;
    const lastIndex = this.indices.pop()!;
    if (this.indices.length > 0) {
      this.priorities[0] = lastPriority;
      this.indices[0] = lastIndex;
      this.bubbleDown(0);
    }
    return topIndex;
  }

  private bubbleUp(position: number) {
    let index = position;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.priorities[parent]! <= this.priorities[index]!) {
        break;
      }
      this.swap(parent, index);
      index = parent;
    }
  }

  private bubbleDown(position: number) {
    let index = position;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < this.indices.length && this.priorities[left]! < this.priorities[smallest]!) {
        smallest = left;
      }
      if (right < this.indices.length && this.priorities[right]! < this.priorities[smallest]!) {
        smallest = right;
      }
      if (smallest === index) {
        return;
      }

      this.swap(index, smallest);
      index = smallest;
    }
  }

  private swap(left: number, right: number) {
    [this.priorities[left], this.priorities[right]] = [
      this.priorities[right]!,
      this.priorities[left]!,
    ];
    [this.indices[left], this.indices[right]] = [this.indices[right]!, this.indices[left]!];
  }
}
