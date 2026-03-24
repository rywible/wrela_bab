import type { WorldSimulationData } from "../../domain/procedural/world";
import type { WorldFieldName } from "../../domain/procedural/worldSimulation";

const FIELD_NAMES: WorldFieldName[] = [
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

function toSharedFloat32Array(source: Float32Array): Float32Array {
  const shared = new SharedArrayBuffer(source.byteLength);
  const view = new Float32Array(shared);
  view.set(source);
  return view;
}

function toSharedInt32Array(source: Int32Array): Int32Array {
  const shared = new SharedArrayBuffer(source.byteLength);
  const view = new Int32Array(shared);
  view.set(source);
  return view;
}

export function toSharedWorldData(world: WorldSimulationData): WorldSimulationData {
  if (typeof SharedArrayBuffer === "undefined") {
    return world;
  }

  const fields = {} as Record<WorldFieldName, Float32Array>;
  for (const name of FIELD_NAMES) {
    fields[name] = toSharedFloat32Array(world.fields[name]);
  }

  return {
    seed: world.seed,
    config: world.config,
    fields,
    macroElevation: toSharedFloat32Array(world.macroElevation),
    filledElevation: toSharedFloat32Array(world.filledElevation),
    receivers: toSharedInt32Array(world.receivers),
    distanceToStream: toSharedFloat32Array(world.distanceToStream),
    fogPersistence: toSharedFloat32Array(world.fogPersistence),
    spawn: world.spawn,
    viewpoints: world.viewpoints,
    summary: world.summary,
  };
}
