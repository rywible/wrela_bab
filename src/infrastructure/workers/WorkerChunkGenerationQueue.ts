import type { ChunkGenerationQueue } from "../../application/contracts";
import type { ChunkRequest, TerrainChunkData } from "../../domain/procedural/world";

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

export class WorkerChunkGenerationQueue implements ChunkGenerationQueue {
  private readonly worker = new Worker(new URL("./chunkGeneration.worker.ts", import.meta.url), {
    type: "module",
  });
  private requestId = 0;
  private readonly pending = new Map<number, (chunk: TerrainChunkData) => void>();

  constructor() {
    this.worker.addEventListener("message", this.onMessage);
  }

  request(request: ChunkRequest) {
    const requestId = this.requestId++;

    return new Promise<TerrainChunkData>((resolve) => {
      this.pending.set(requestId, resolve);
      const message: ChunkBuildRequestMessage = {
        type: "build-chunk",
        requestId,
        request,
      };
      this.worker.postMessage(message);
    });
  }

  dispose() {
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.terminate();
  }

  private readonly onMessage = (event: MessageEvent<ChunkBuildResponseMessage>) => {
    if (event.data.type !== "built-chunk") {
      return;
    }
    const resolve = this.pending.get(event.data.requestId);
    if (!resolve) {
      return;
    }
    this.pending.delete(event.data.requestId);
    resolve(event.data.chunk);
  };
}
