import {
  gridIndex,
  worldXFromIndex,
  worldZFromIndex,
  neighborOffsets,
  neighborDifference,
  receiverDistance,
  chamferDistance,
  diffuseField,
  MinHeap,
} from "./gridOps";
import type { FlowNetwork } from "./gridOps";
import { clamp01, lerp, smoothstep, valueNoise2D } from "./mathUtils";
import type { WorldLayoutConfig, WorldFieldName } from "./worldSimulation";

export const ROUTING_EPSILON = 0.01;
export const EROSION_DROP_EPSILON = 0.04;

export function computeFlowNetwork(
  config: WorldLayoutConfig,
  surface: Float32Array,
  coastDistance: Float32Array,
): FlowNetwork {
  const filled = priorityFloodFill(config, surface, coastDistance);
  const receivers = computeReceivers(config, filled, surface, coastDistance);
  const order = Array.from({ length: surface.length }, (_, index) => index);
  order.sort((left, right) => filled[right]! - filled[left]!);

  const flow = new Float32Array(surface.length);
  for (let index = 0; index < surface.length; index++) {
    if (coastDistance[index]! > 0) {
      flow[index] = 1;
    }
  }

  for (const index of order) {
    const receiver = receivers[index]!;
    if (receiver >= 0) {
      flow[receiver] += flow[index]!;
    }
  }

  return {
    filled,
    receivers,
    flow,
    order,
  };
}

export function priorityFloodFill(
  config: WorldLayoutConfig,
  surface: Float32Array,
  coastDistance: Float32Array,
) {
  const filled = surface.slice();
  const visited = new Uint8Array(surface.length);
  const pitQueue = new Uint32Array(surface.length);
  let pitHead = 0;
  let pitTail = 0;
  const heap = new MinHeap();

  for (let index = 0; index < surface.length; index++) {
    if (coastDistance[index]! <= 0) {
      visited[index] = 1;
      heap.push(filled[index]!, index);
    }
  }

  while (heap.size > 0 || pitHead < pitTail) {
    let index = 0;
    if (pitHead < pitTail) {
      index = pitQueue[pitHead++]!;
    } else {
      index = heap.popIndex();
    }

    const xIndex = index % config.fieldResolution;
    const zIndex = Math.floor(index / config.fieldResolution);
    const currentElevation = filled[index]!;

    for (const [offsetX, offsetZ] of neighborOffsets()) {
      const neighborX = xIndex + offsetX;
      const neighborZ = zIndex + offsetZ;
      if (neighborX < 0 || neighborX >= config.fieldResolution) {
        continue;
      }
      if (neighborZ < 0 || neighborZ >= config.fieldResolution) {
        continue;
      }

      const neighborIndex = gridIndex(config, neighborX, neighborZ);
      if (visited[neighborIndex]) {
        continue;
      }

      visited[neighborIndex] = 1;
      if (filled[neighborIndex]! <= currentElevation) {
        filled[neighborIndex] = currentElevation + ROUTING_EPSILON;
        pitQueue[pitTail++] = neighborIndex;
      } else {
        heap.push(filled[neighborIndex]!, neighborIndex);
      }
    }
  }

  return filled;
}

export function computeReceivers(
  config: WorldLayoutConfig,
  filled: Float32Array,
  raw: Float32Array,
  coastDistance: Float32Array,
) {
  const receivers = new Int32Array(filled.length).fill(-1);

  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const index = gridIndex(config, xIndex, zIndex);
      if (coastDistance[index]! <= 0) {
        continue;
      }

      const current = filled[index]!;
      const currentRaw = raw[index]!;
      let bestIndex = -1;
      let bestFilled = Number.POSITIVE_INFINITY;
      let bestRaw = Number.POSITIVE_INFINITY;

      for (const [offsetX, offsetZ] of neighborOffsets()) {
        const neighborX = xIndex + offsetX;
        const neighborZ = zIndex + offsetZ;
        if (neighborX < 0 || neighborX >= config.fieldResolution) {
          continue;
        }
        if (neighborZ < 0 || neighborZ >= config.fieldResolution) {
          continue;
        }

        const neighborIndex = gridIndex(config, neighborX, neighborZ);
        const neighborFilled = filled[neighborIndex]!;
        const neighborRaw = raw[neighborIndex]!;
        const better =
          neighborFilled < bestFilled - 1e-6 ||
          (Math.abs(neighborFilled - bestFilled) <= 1e-6 && neighborRaw < bestRaw - 1e-6);
        if (
          better &&
          (neighborFilled < current ||
            neighborRaw < currentRaw ||
            coastDistance[neighborIndex]! <= 0)
        ) {
          bestIndex = neighborIndex;
          bestFilled = neighborFilled;
          bestRaw = neighborRaw;
        }
      }

      if (bestIndex < 0) {
        let lowestNeighbor = index;
        for (const [offsetX, offsetZ] of neighborOffsets()) {
          const neighborX = xIndex + offsetX;
          const neighborZ = zIndex + offsetZ;
          if (neighborX < 0 || neighborX >= config.fieldResolution) {
            continue;
          }
          if (neighborZ < 0 || neighborZ >= config.fieldResolution) {
            continue;
          }
          const neighborIndex = gridIndex(config, neighborX, neighborZ);
          if (filled[neighborIndex]! < filled[lowestNeighbor]!) {
            lowestNeighbor = neighborIndex;
          }
        }
        bestIndex = lowestNeighbor === index ? -1 : lowestNeighbor;
      }

      receivers[index] = bestIndex;
    }
  }

  return receivers;
}

export function erodeMacroSurface(
  config: WorldLayoutConfig,
  fields: Record<WorldFieldName, Float32Array>,
  network: FlowNetwork,
) {
  const surface = network.filled.slice();
  const scratch = new Float32Array(surface.length);
  const cellSize = config.worldSizeMeters / (config.fieldResolution - 1);
  let maxFlow = 1;

  for (let index = 0; index < network.flow.length; index++) {
    maxFlow = Math.max(maxFlow, network.flow[index]!);
  }

  for (let iteration = 0; iteration < config.erosionIterations; iteration++) {
    scratch.set(surface);

    for (const index of network.order) {
      const receiver = network.receivers[index]!;
      if (receiver < 0 || fields.coastDistance[index]! <= 0) {
        continue;
      }

      const flowNorm = clamp01(Math.log1p(network.flow[index]!) / Math.log1p(maxFlow));
      const distance = receiverDistance(config, index, receiver);
      const drop = Math.max(0, surface[index]! - surface[receiver]!);
      const slope = drop / Math.max(distance, cellSize);
      const incision =
        smoothstep(0.1, 1, flowNorm) *
        (0.16 + Math.pow(flowNorm, 1.2) * 1.95) *
        Math.pow(slope + 0.02, 0.78);

      scratch[index] += (fields.uplift[index]! * 0.0028) / config.erosionIterations;
      scratch[index] -= incision;
    }

    diffuseLandformPass(config, scratch, fields.coastDistance, 0.12);
    enforceDownhillOrder(network.order, network.receivers, scratch, fields.coastDistance);
    surface.set(scratch);
  }

  return surface;
}

export function buildHydrologyAndLandforms(
  seed: number,
  config: WorldLayoutConfig,
  fields: Record<WorldFieldName, Float32Array>,
  network: FlowNetwork,
  erodedSurface: Float32Array,
  macroElevation: Float32Array,
  distanceToStream: Float32Array,
) {
  fields.flowAccumulation.set(network.flow);

  let maxFlow = 1;
  for (let index = 0; index < network.flow.length; index++) {
    maxFlow = Math.max(maxFlow, network.flow[index]!);
  }

  const preliminaryStreamOrder = new Float32Array(network.flow.length);
  for (let index = 0; index < network.flow.length; index++) {
    if (fields.coastDistance[index]! <= 0) {
      continue;
    }
    const flowNorm = clamp01(Math.log1p(network.flow[index]!) / Math.log1p(maxFlow));
    preliminaryStreamOrder[index] =
      flowNorm < 0.18
        ? 0
        : flowNorm < 0.31
          ? 1
          : flowNorm < 0.45
            ? 2
            : flowNorm < 0.62
              ? 3
              : flowNorm < 0.8
                ? 4
                : 5;
  }

  chamferDistance(config, preliminaryStreamOrder, distanceToStream, 1);

  const blurred = erodedSurface.slice();
  diffuseField(config, blurred, 4, 0.22);

  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const index = gridIndex(config, xIndex, zIndex);
      const coastDistance = fields.coastDistance[index]!;
      const elevation = erodedSurface[index]!;
      if (coastDistance <= 0) {
        macroElevation[index] = elevation;
        continue;
      }

      const flowNorm = clamp01(Math.log1p(network.flow[index]!) / Math.log1p(maxFlow));
      const slopeX = neighborDifference(
        config,
        erodedSurface,
        xIndex - 1,
        zIndex,
        xIndex + 1,
        zIndex,
      );
      const slopeZ = neighborDifference(
        config,
        erodedSurface,
        xIndex,
        zIndex - 1,
        xIndex,
        zIndex + 1,
      );
      const slope = clamp01(Math.hypot(slopeX, slopeZ) / 14);
      const tpi = elevation - blurred[index]!;
      const streamOrder = preliminaryStreamOrder[index]!;
      const channelWidth = smoothstep(1, 5, streamOrder) * lerp(14, 200, Math.pow(flowNorm, 1.08));
      const floodplainReach =
        1 - smoothstep(14, 120 + channelWidth * 3.6, distanceToStream[index]!);
      const ridgeCrest =
        smoothstep(7, 30, tpi) * smoothstep(0.1, 0.34, slope) * (1 - smoothstep(0.4, 0.68, slope));
      const shoulderness =
        smoothstep(2, 14, tpi) *
        (1 - smoothstep(16, 36, tpi)) *
        smoothstep(0.08, 0.28, slope) *
        (1 - smoothstep(0.32, 0.54, slope)) *
        smoothstep(140, 760, distanceToStream[index]!) *
        (1 - smoothstep(1_300, 3_800, distanceToStream[index]!));
      const floodplain =
        floodplainReach * smoothstep(0.22, 1, flowNorm) * (1 - smoothstep(0.12, 0.34, slope));
      const valleyWall =
        smoothstep(0.28, 0.92, flowNorm) *
        smoothstep(120, 720, distanceToStream[index]!) *
        (1 - smoothstep(720, 1_900, distanceToStream[index]!)) *
        smoothstep(0.08, 0.36, slope);
      const alluvium = floodplain * lerp(1.2, 5.6, flowNorm) + shoulderness * 0.85;
      const soilDepth = clamp01(
        0.12 +
          floodplain * 0.36 +
          shoulderness * 0.18 +
          (1 - slope) * 0.16 +
          flowNorm * 0.12 -
          ridgeCrest * 0.16,
      );
      const deposition = clamp01(alluvium / 6.4) * 4.8;
      const northness = clamp01(0.5 + slopeZ * 0.12);

      fields.streamOrder[index] = streamOrder;
      fields.channelWidth[index] = channelWidth;
      fields.floodplain[index] = floodplain;
      fields.soilDepth[index] = soilDepth;
      fields.deposition[index] = deposition;
      fields.incision[index] = Math.max(0, fields.baseElevation[index]! - elevation);
      fields.northness[index] = northness;
      fields.shoulderness[index] = shoulderness;
      const inlandAmplification = lerp(
        1.15,
        2.65,
        smoothstep(600, config.worldSizeMeters * 0.78, coastDistance),
      );
      const structuralAmplification =
        1 + ridgeCrest * 0.38 + shoulderness * 0.16 + valleyWall * 0.48;
      const amplifiedElevation =
        config.seaLevel +
        Math.max(0, elevation - config.seaLevel) * inlandAmplification * structuralAmplification;
      macroElevation[index] =
        amplifiedElevation +
        deposition * 1.1 +
        ridgeCrest * 18 +
        shoulderness * 8.5 +
        valleyWall * 22 -
        floodplain * 2.4;
    }
  }

  // Re-introduce some broad ecological bias after geomorphic fields are grounded.
  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    const z = worldZFromIndex(config, zIndex);
    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const index = gridIndex(config, xIndex, zIndex);
      if (macroElevation[index]! <= config.seaLevel) {
        continue;
      }

      const x = worldXFromIndex(config, xIndex);
      const groveBias = valueNoise2D(seed + 1_311, x * 0.00008, z * 0.00007);
      fields.shoulderness[index] = clamp01(
        fields.shoulderness[index]! * 0.9 + smoothstep(0.48, 0.82, groveBias) * 0.1,
      );
    }
  }
}

export function buildClimateAndEcology(
  seed: number,
  config: WorldLayoutConfig,
  fields: Record<WorldFieldName, Float32Array>,
  macroElevation: Float32Array,
  distanceToStream: Float32Array,
  fogPersistence: Float32Array,
) {
  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const index = gridIndex(config, xIndex, zIndex);
      const elevation = macroElevation[index]!;
      const coastDistance = fields.coastDistance[index]!;
      if (elevation <= config.seaLevel) {
        fields.moisture[index] = 0.88;
        fields.redwoodSuitability[index] = 0;
        fields.saltExposure[index] = 0.22;
        fogPersistence[index] = 0.16;
        continue;
      }

      const flowAccumulation = fields.flowAccumulation[index]!;
      const soilDepth = fields.soilDepth[index]!;
      const floodplain = fields.floodplain[index]!;
      const shoulderness = fields.shoulderness[index]!;
      const northness = fields.northness[index]!;
      const streamOrder = fields.streamOrder[index]!;
      const slopeX = neighborDifference(
        config,
        macroElevation,
        xIndex - 1,
        zIndex,
        xIndex + 1,
        zIndex,
      );
      const slopeZ = neighborDifference(
        config,
        macroElevation,
        xIndex,
        zIndex - 1,
        xIndex,
        zIndex + 1,
      );
      const slope = clamp01(Math.hypot(slopeX, slopeZ) / 12);
      const marineLayer = clamp01(1 - coastDistance / config.fogReachMeters);
      const windward = clamp01(0.5 + slopeX * 0.18);
      const flowNorm = clamp01(
        Math.log1p(flowAccumulation) / Math.log1p(config.fieldResolution * config.fieldResolution),
      );
      const valleyTrap = clamp01(
        (1 - smoothstep(0, 900, distanceToStream[index]!)) * 0.38 +
          floodplain * 0.22 +
          (1 - smoothstep(0.12, 0.4, slope)) * 0.18 +
          flowNorm * 0.22,
      );
      const shoulderFog =
        shoulderness *
        smoothstep(1_000, config.fogReachMeters * 0.55, coastDistance) *
        (1 - smoothstep(config.fogReachMeters * 0.68, config.fogReachMeters * 1.25, coastDistance));
      const rainShadow =
        smoothstep(config.fogReachMeters * 0.85, config.fogReachMeters * 1.8, coastDistance) *
        smoothstep(18, 56, fields.uplift[index]!);
      const fogExposure = clamp01(
        marineLayer * 0.42 +
          valleyTrap * 0.16 +
          shoulderFog * 0.26 +
          northness * 0.08 +
          windward * 0.12 -
          rainShadow * 0.12,
      );
      const rainfall = clamp01(
        marineLayer * 0.34 +
          windward * smoothstep(8, 42, fields.uplift[index]!) * 0.22 +
          valleyTrap * 0.12 +
          soilDepth * 0.08 -
          rainShadow * 0.22,
      );
      const fogHold = clamp01(
        fogExposure * 0.62 + valleyTrap * 0.16 + shoulderness * 0.14 + northness * 0.08,
      );
      const moisture = clamp01(
        rainfall * 0.34 +
          fogHold * 0.28 +
          soilDepth * 0.16 +
          floodplain * 0.12 +
          flowNorm * 0.08 +
          northness * 0.08 -
          slope * 0.1,
      );
      const saltExposure = clamp01(
        (1 - smoothstep(180, config.saltSprayMeters, coastDistance)) *
          (0.56 + 0.44 * (1 - floodplain)) *
          (0.4 + 0.6 * (1 - valleyTrap * 0.65)),
      );
      const lowerSlope = (1 - smoothstep(0.08, 0.38, slope)) * (1 - floodplain * 0.28);
      const floodplainEdge =
        smoothstep(0.08, 0.52, floodplain) *
        smoothstep(80, 360, distanceToStream[index]!) *
        (1 - smoothstep(360, 1_100, distanceToStream[index]!));
      const ridgePenalty =
        smoothstep(0.72, 1, shoulderness + slope * 0.2) * smoothstep(0.2, 0.46, slope);
      const suitability = clamp01(
        moisture * 0.36 +
          fogHold * 0.24 +
          soilDepth * 0.16 +
          northness * 0.08 +
          shoulderness * 0.14 +
          lowerSlope * 0.1 +
          floodplainEdge * 0.16 +
          smoothstep(0.64, 1, streamOrder / 5) * 0.05 -
          saltExposure * 0.18 -
          ridgePenalty * 0.14 -
          smoothstep(0, 280, coastDistance) * 0.05 -
          smoothstep(config.fogReachMeters * 1.2, config.fogReachMeters * 2.2, coastDistance) *
            0.08,
      );

      fields.fogExposure[index] = fogExposure;
      fields.rainfall[index] = rainfall;
      fields.moisture[index] = moisture;
      fields.redwoodSuitability[index] = suitability;
      fields.saltExposure[index] = saltExposure;
      fogPersistence[index] = fogHold;
    }
  }

  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    const z = worldZFromIndex(config, zIndex);
    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const x = worldXFromIndex(config, xIndex);
      const index = gridIndex(config, xIndex, zIndex);
      if (macroElevation[index]! <= config.seaLevel) {
        continue;
      }

      const groveBias = valueNoise2D(seed + 1_407, x * 0.00009, z * 0.00009);
      fields.redwoodSuitability[index] = clamp01(
        fields.redwoodSuitability[index]! * 0.92 + smoothstep(0.52, 0.82, groveBias) * 0.08,
      );
    }
  }
}

export function diffuseLandformPass(
  config: WorldLayoutConfig,
  field: Float32Array,
  coastDistance: Float32Array,
  strength: number,
) {
  const scratch = field.slice();
  for (let zIndex = 0; zIndex < config.fieldResolution; zIndex++) {
    for (let xIndex = 0; xIndex < config.fieldResolution; xIndex++) {
      const index = gridIndex(config, xIndex, zIndex);
      if (coastDistance[index]! <= 0) {
        continue;
      }

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
        const neighborIndex = gridIndex(config, neighborX, neighborZ);
        if (coastDistance[neighborIndex]! <= 0) {
          continue;
        }
        sum += field[neighborIndex]!;
        count += 1;
      }

      scratch[index] = lerp(field[index]!, sum / count, strength);
    }
  }
  field.set(scratch);
}

export function enforceDownhillOrder(
  order: number[],
  receivers: Int32Array,
  surface: Float32Array,
  coastDistance: Float32Array,
) {
  for (const index of order) {
    const receiver = receivers[index]!;
    if (receiver < 0 || coastDistance[index]! <= 0) {
      continue;
    }
    const minimum = surface[receiver]! + EROSION_DROP_EPSILON;
    if (surface[index]! <= minimum) {
      surface[index] = minimum;
    }
  }
}
