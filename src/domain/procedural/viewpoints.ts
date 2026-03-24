import {
  clampIndex,
  getSurfaceHeight,
  gridIndex,
  localSlope,
  sampleReliefWindow,
  searchNeighborhoodBestIndex,
  worldXFromIndex,
  worldZFromIndex,
} from "./gridOps";
import { clamp01, normalize2, smoothstep } from "./mathUtils";
import type {
  WorldCameraBookmark,
  WorldSimulationData,
  WorldSimulationSummary,
  WorldSpawnPoint,
} from "./worldSimulation";

export function chooseSpawnLocation(world: WorldSimulationData): WorldSpawnPoint {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let zIndex = 6; zIndex < world.config.fieldResolution - 6; zIndex += 1) {
    for (let xIndex = 6; xIndex < world.config.fieldResolution - 6; xIndex += 1) {
      const index = gridIndex(world.config, xIndex, zIndex);
      const elevation = world.macroElevation[index]!;
      if (elevation <= world.config.seaLevel + 2) {
        continue;
      }

      const coastDistance = world.fields.coastDistance[index]!;
      const floodplain = world.fields.floodplain[index]!;
      const shoulderness = world.fields.shoulderness[index]!;
      const suitability = world.fields.redwoodSuitability[index]!;
      const fogExposure = world.fields.fogExposure[index]!;
      const northness = world.fields.northness[index]!;
      const slope = localSlope(world.config, world.macroElevation, xIndex, zIndex);
      const distanceBand =
        smoothstep(140, 460, world.distanceToStream[index]!) *
        (1 - smoothstep(620, 1_650, world.distanceToStream[index]!));

      if (
        coastDistance < 1_100 ||
        coastDistance > world.config.fogReachMeters * 0.92 ||
        floodplain > 0.42 ||
        slope > 0.34 ||
        suitability < 0.34 ||
        fogExposure < 0.38 ||
        shoulderness < 0.12
      ) {
        continue;
      }

      const score =
        suitability * 0.56 +
        fogExposure * 0.16 +
        shoulderness * 0.12 +
        northness * 0.08 +
        distanceBand * 0.08;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }

  if (bestScore === Number.NEGATIVE_INFINITY) {
    for (let index = 0; index < world.macroElevation.length; index++) {
      if (world.macroElevation[index]! <= world.config.seaLevel + 2) {
        continue;
      }
      const score = world.fields.redwoodSuitability[index]! - world.fields.floodplain[index]! * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }

  const spawnX = worldXFromIndex(world.config, bestIndex % world.config.fieldResolution);
  const spawnZ = worldZFromIndex(
    world.config,
    Math.floor(bestIndex / world.config.fieldResolution),
  );
  return {
    x: spawnX,
    y: getSurfaceHeight(world, spawnX, spawnZ),
    z: spawnZ,
    yaw: -Math.PI / 2,
  };
}

export function chooseCaptureViewpoints(
  world: WorldSimulationData,
): Record<"overview" | "grove" | "valley" | "ridge", WorldCameraBookmark> {
  const grove = selectBookmarkCell(world, "grove");
  const valley = selectBookmarkCell(world, "valley");
  const ridge = selectBookmarkCell(world, "ridge");
  const groveFocus = searchNeighborhoodBestIndex(world, grove, 6, (index) => {
    if (world.macroElevation[index]! <= world.config.seaLevel + 1) {
      return Number.NEGATIVE_INFINITY;
    }

    const flowNorm = clamp01(
      Math.log1p(world.fields.flowAccumulation[index]!) /
        Math.log1p(world.config.fieldResolution * world.config.fieldResolution),
    );
    return (
      world.fields.redwoodSuitability[index]! * 0.46 +
      world.fields.shoulderness[index]! * 0.16 +
      world.fields.floodplain[index]! * 0.08 +
      (1 - smoothstep(0, 260, world.distanceToStream[index]!)) * 0.16 +
      flowNorm * 0.14
    );
  });
  const valleyFocus = searchNeighborhoodBestIndex(world, valley, 4, (index) => {
    if (world.macroElevation[index]! <= world.config.seaLevel + 1) {
      return Number.NEGATIVE_INFINITY;
    }

    const flowNorm = clamp01(
      Math.log1p(world.fields.flowAccumulation[index]!) /
        Math.log1p(world.config.fieldResolution * world.config.fieldResolution),
    );
    return (
      (1 - smoothstep(0, 220, world.distanceToStream[index]!)) * 0.46 +
      flowNorm * 0.28 +
      world.fields.floodplain[index]! * 0.12 +
      world.fields.redwoodSuitability[index]! * 0.08
    );
  });
  const groveX = worldXFromIndex(world.config, grove % world.config.fieldResolution);
  const groveZ = worldZFromIndex(world.config, Math.floor(grove / world.config.fieldResolution));
  const groveY = getSurfaceHeight(world, groveX, groveZ);
  const groveFocusX = worldXFromIndex(world.config, groveFocus % world.config.fieldResolution);
  const groveFocusZ = worldZFromIndex(
    world.config,
    Math.floor(groveFocus / world.config.fieldResolution),
  );
  const groveFocusY = getSurfaceHeight(world, groveFocusX, groveFocusZ);
  const valleyTargetX = worldXFromIndex(world.config, valley % world.config.fieldResolution);
  const valleyTargetZ = worldZFromIndex(
    world.config,
    Math.floor(valley / world.config.fieldResolution),
  );
  const valleyTargetY = getSurfaceHeight(world, valleyTargetX, valleyTargetZ);
  const valleyFocusX = worldXFromIndex(world.config, valleyFocus % world.config.fieldResolution);
  const valleyFocusZ = worldZFromIndex(
    world.config,
    Math.floor(valleyFocus / world.config.fieldResolution),
  );
  const valleyFocusY = getSurfaceHeight(world, valleyFocusX, valleyFocusZ);
  const ridgeX = worldXFromIndex(world.config, ridge % world.config.fieldResolution);
  const ridgeZ = worldZFromIndex(world.config, Math.floor(ridge / world.config.fieldResolution));
  const ridgeY = getSurfaceHeight(world, ridgeX, ridgeZ);
  const ridgeFocus = searchNeighborhoodBestIndex(world, ridge, 5, (index) => {
    if (world.macroElevation[index]! <= world.config.seaLevel + 1) {
      return Number.NEGATIVE_INFINITY;
    }

    const flowNorm = clamp01(
      Math.log1p(world.fields.flowAccumulation[index]!) /
        Math.log1p(world.config.fieldResolution * world.config.fieldResolution),
    );
    const drop = clamp01((ridgeY - world.macroElevation[index]!) / 220);
    return (
      drop * 0.42 +
      flowNorm * 0.22 +
      smoothstep(
        0,
        36,
        sampleReliefWindow(
          world.config,
          world.macroElevation,
          index % world.config.fieldResolution,
          Math.floor(index / world.config.fieldResolution),
          6,
        ),
      ) *
        0.18 +
      (1 - smoothstep(0, 240, world.distanceToStream[index]!)) * 0.18
    );
  });
  const ridgeFocusX = worldXFromIndex(world.config, ridgeFocus % world.config.fieldResolution);
  const ridgeFocusZ = worldZFromIndex(
    world.config,
    Math.floor(ridgeFocus / world.config.fieldResolution),
  );
  const ridgeFocusY = getSurfaceHeight(world, ridgeFocusX, ridgeFocusZ);
  const valleyDir = normalize2(
    valleyTargetX - valleyFocusX,
    valleyTargetZ - valleyFocusZ,
    [0.82, 0.58],
  );
  const valleyAcross: [number, number] = [-valleyDir[1], valleyDir[0]];
  const groveDir = normalize2(groveX - groveFocusX, groveZ - groveFocusZ, [0.74, 0.68]);
  const groveAcross: [number, number] = [-groveDir[1], groveDir[0]];
  const ridgeDir = normalize2(ridgeX - ridgeFocusX, ridgeZ - ridgeFocusZ, [0.76, 0.64]);
  const ridgeAcross: [number, number] = [-ridgeDir[1], ridgeDir[0]];

  return {
    overview: {
      position: [
        valleyTargetX + valleyDir[0] * 48 + valleyAcross[0] * 28,
        valleyTargetY + 72,
        valleyTargetZ + valleyDir[1] * 48 + valleyAcross[1] * 28,
      ],
      target: [
        valleyFocusX - valleyAcross[0] * 8,
        valleyFocusY + 16,
        valleyFocusZ - valleyAcross[1] * 8,
      ],
    },
    grove: {
      position: [
        groveX + groveDir[0] * 18 + groveAcross[0] * 22,
        groveY + 18,
        groveZ + groveDir[1] * 18 + groveAcross[1] * 22,
      ],
      target: [groveFocusX, groveFocusY + 7, groveFocusZ],
    },
    valley: {
      position: [
        valleyTargetX + valleyDir[0] * 24 + valleyAcross[0] * 30,
        valleyTargetY + 28,
        valleyTargetZ + valleyDir[1] * 24 + valleyAcross[1] * 30,
      ],
      target: [
        valleyFocusX - valleyAcross[0] * 8,
        valleyFocusY + 8,
        valleyFocusZ - valleyAcross[1] * 8,
      ],
    },
    ridge: {
      position: [
        ridgeX + ridgeDir[0] * 26 + ridgeAcross[0] * 34,
        ridgeY + 34,
        ridgeZ + ridgeDir[1] * 26 + ridgeAcross[1] * 34,
      ],
      target: [ridgeFocusX, ridgeFocusY + 6, ridgeFocusZ],
    },
  };
}

export function selectBookmarkCell(world: WorldSimulationData, kind: "grove" | "valley" | "ridge") {
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let zIndex = 8; zIndex < world.config.fieldResolution - 8; zIndex += 4) {
    for (let xIndex = 8; xIndex < world.config.fieldResolution - 8; xIndex += 4) {
      const index = gridIndex(world.config, xIndex, zIndex);
      const elevation = world.macroElevation[index]!;
      if (elevation <= world.config.seaLevel + 1) {
        continue;
      }

      const coastDistance = world.fields.coastDistance[index]!;
      const suitability = world.fields.redwoodSuitability[index]!;
      const shoulderness = world.fields.shoulderness[index]!;
      const slope = localSlope(world.config, world.macroElevation, xIndex, zIndex);
      const broadRelief = sampleReliefWindow(
        world.config,
        world.macroElevation,
        xIndex,
        zIndex,
        18,
      );
      const streamShoulderBand =
        smoothstep(140, 520, world.distanceToStream[index]!) *
        (1 - smoothstep(520, 1_600, world.distanceToStream[index]!));

      let score = Number.NEGATIVE_INFINITY;
      if (kind === "grove") {
        if (
          suitability < 0.34 ||
          slope < 0.03 ||
          slope > 0.22 ||
          broadRelief < 18 ||
          coastDistance < 1_400
        ) {
          continue;
        }
        score =
          suitability * 0.34 +
          smoothstep(18, 110, broadRelief) * 0.2 +
          smoothstep(0.03, 0.16, slope) * (1 - smoothstep(0.16, 0.26, slope)) * 0.16 +
          smoothstep(0.04, 0.22, shoulderness) * 0.1 +
          streamShoulderBand * 0.1 +
          smoothstep(1_600, 8_000, coastDistance) * 0.1;
      } else if (kind === "valley") {
        if (
          suitability < 0.24 ||
          shoulderness < 0.1 ||
          slope < 0.08 ||
          slope > 0.28 ||
          broadRelief < 48 ||
          streamShoulderBand <= 0
        ) {
          continue;
        }
        score =
          suitability * 0.12 +
          shoulderness * 0.22 +
          smoothstep(48, 180, broadRelief) * 0.38 +
          streamShoulderBand * 0.14 +
          smoothstep(0.08, 0.24, slope) * (1 - smoothstep(0.24, 0.38, slope)) * 0.14;
      } else {
        if (
          world.fields.uplift[index]! < 92 ||
          slope < 0.14 ||
          broadRelief < 72 ||
          elevation < world.config.seaLevel + 260
        ) {
          continue;
        }
        score =
          smoothstep(92, 220, world.fields.uplift[index]!) * 0.22 +
          smoothstep(72, 240, broadRelief) * 0.42 +
          smoothstep(0.14, 0.32, slope) * 0.2 +
          (1 - suitability) * 0.06 +
          smoothstep(
            world.config.fogReachMeters * 0.4,
            world.config.fogReachMeters,
            coastDistance,
          ) *
            0.1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }

  if (bestScore === Number.NEGATIVE_INFINITY) {
    if (kind === "valley") {
      const spawnX = Math.round(
        ((world.spawn.x - world.config.worldMinX) / world.config.worldSizeMeters) *
          (world.config.fieldResolution - 1),
      );
      const spawnZ = Math.round(
        ((world.spawn.z - world.config.worldMinZ) / world.config.worldSizeMeters) *
          (world.config.fieldResolution - 1),
      );
      return gridIndex(
        world.config,
        clampIndex(spawnX, world.config.fieldResolution),
        clampIndex(spawnZ, world.config.fieldResolution),
      );
    }

    if (kind === "grove") {
      return gridIndex(
        world.config,
        clampIndex(
          Math.round(
            ((world.spawn.x - world.config.worldMinX) / world.config.worldSizeMeters) *
              (world.config.fieldResolution - 1),
          ),
          world.config.fieldResolution,
        ),
        clampIndex(
          Math.round(
            ((world.spawn.z - world.config.worldMinZ) / world.config.worldSizeMeters) *
              (world.config.fieldResolution - 1),
          ),
          world.config.fieldResolution,
        ),
      );
    }

    if (kind === "ridge") {
      return searchNeighborhoodBestIndex(
        world,
        gridIndex(
          world.config,
          world.config.fieldResolution - 32,
          world.config.fieldResolution / 2,
        ),
        48,
        (index) => world.macroElevation[index]!,
      );
    }
  }

  return bestIndex;
}

export function summarizeWorld(world: WorldSimulationData): WorldSimulationSummary {
  let suitabilityMean = 0;
  let suitabilityMax = 0;
  let streamCells = 0;
  let landCells = 0;

  for (let index = 0; index < world.macroElevation.length; index++) {
    suitabilityMean += world.fields.redwoodSuitability[index]!;
    suitabilityMax = Math.max(suitabilityMax, world.fields.redwoodSuitability[index]!);
    if (world.fields.streamOrder[index]! >= 1) {
      streamCells += 1;
    }
    if (world.macroElevation[index]! > world.config.seaLevel + 0.5) {
      landCells += 1;
    }
  }

  return {
    watershedCount: world.config.watershedCount,
    streamCoverage: streamCells / world.macroElevation.length,
    suitabilityMean: suitabilityMean / world.macroElevation.length,
    suitabilityMax,
    landCoverage: landCells / world.macroElevation.length,
  };
}
