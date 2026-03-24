/// <reference lib="webworker" />

import type { ChunkRequest, TerrainChunkData } from "../../domain/procedural/world";
import { buildChunk } from "../../domain/procedural/world";

interface ChunkBuildRequestMessage {
  type: "build-chunk";
  requestId: number;
  request: ChunkRequest;
}

interface ChunkBuildResponseMessage {
  type: "built-chunk";
  requestId: number;
  chunk: TerrainChunkData;
}

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener("message", (event: MessageEvent<ChunkBuildRequestMessage>) => {
  if (event.data.type !== "build-chunk") {
    return;
  }

  const chunk = buildChunk(event.data.request);
  const response: ChunkBuildResponseMessage = {
    type: "built-chunk",
    requestId: event.data.requestId,
    chunk,
  };
  self.postMessage(response);
});
