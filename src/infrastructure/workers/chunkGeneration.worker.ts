/// <reference lib="webworker" />

import type {
  ChunkRequest,
  TerrainChunkData,
  WorldSimulationData,
} from "../../domain/procedural/world";
import { buildChunk } from "../../domain/procedural/world";

interface WorldInitializeMessage {
  type: "initialize-world";
  requestId: number;
  world: WorldSimulationData;
}

interface ChunkBuildRequestMessage {
  type: "build-chunk";
  requestId: number;
  request: ChunkRequest;
}

interface WorldReadyMessage {
  type: "world-ready";
  requestId: number;
}

interface ChunkBuildResponseMessage {
  type: "built-chunk";
  requestId: number;
  chunk: TerrainChunkData;
}

declare const self: DedicatedWorkerGlobalScope;

let worldSimulation: WorldSimulationData | undefined;

self.addEventListener(
  "message",
  (event: MessageEvent<WorldInitializeMessage | ChunkBuildRequestMessage>) => {
    if (event.data.type === "initialize-world") {
      worldSimulation = event.data.world;
      const response: WorldReadyMessage = {
        type: "world-ready",
        requestId: event.data.requestId,
      };
      self.postMessage(response);
      return;
    }

    if (!worldSimulation) {
      throw new Error("Chunk generation requested before world initialization.");
    }

    const chunk = buildChunk(worldSimulation, event.data.request);
    const response: ChunkBuildResponseMessage = {
      type: "built-chunk",
      requestId: event.data.requestId,
      chunk,
    };
    self.postMessage(response);
  },
);
