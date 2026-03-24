import type { ChunkGenerationQueue } from "../../application/contracts";
import type {
  ChunkRequest,
  TerrainChunkData,
  WorldSimulationData,
} from "../../domain/procedural/world";
import { toSharedWorldData } from "./sharedWorldData";

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

type WorkerResponseMessage = WorldReadyMessage | ChunkBuildResponseMessage;

interface PoolWorker {
  worker: Worker;
  pendingCount: number;
  pending: Map<number, (message: WorkerResponseMessage) => void>;
}

export class WorkerChunkGenerationQueue implements ChunkGenerationQueue {
  private readonly pool: PoolWorker[];
  private requestId = 0;
  private initialized = false;
  private initializePromise?: Promise<WorldSimulationData>;
  private sharedWorld?: WorldSimulationData;

  constructor(poolSize?: number) {
    const size = poolSize ?? Math.max(2, Math.min(4, (navigator.hardwareConcurrency ?? 4) - 1));
    this.pool = Array.from({ length: size }, () => {
      const worker = new Worker(new URL("./chunkGeneration.worker.ts", import.meta.url), {
        type: "module",
      });
      const poolWorker: PoolWorker = {
        worker,
        pendingCount: 0,
        pending: new Map(),
      };
      worker.addEventListener("message", (event: MessageEvent<WorkerResponseMessage>) => {
        const resolve = poolWorker.pending.get(event.data.requestId);
        if (!resolve) return;
        poolWorker.pending.delete(event.data.requestId);
        poolWorker.pendingCount--;
        resolve(event.data);
      });
      return poolWorker;
    });
  }

  initialize(world: WorldSimulationData) {
    if (this.initialized) {
      return Promise.resolve(this.sharedWorld!);
    }
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = new Promise<WorldSimulationData>((resolve) => {
      this.sharedWorld = toSharedWorldData(world);
      let readyCount = 0;

      for (const poolWorker of this.pool) {
        const requestId = this.requestId++;
        poolWorker.pending.set(requestId, () => {
          readyCount++;
          if (readyCount === this.pool.length) {
            this.initialized = true;
            resolve(this.sharedWorld!);
          }
        });
        const message: WorldInitializeMessage = {
          type: "initialize-world",
          requestId,
          world: this.sharedWorld,
        };
        poolWorker.worker.postMessage(message);
      }
    });

    return this.initializePromise;
  }

  request(request: ChunkRequest) {
    if (!this.initialized) {
      return Promise.reject(new Error("Chunk generation worker used before world initialization."));
    }

    const poolWorker = this.leastBusy();
    const requestId = this.requestId++;
    poolWorker.pendingCount++;

    return new Promise<TerrainChunkData>((resolve) => {
      poolWorker.pending.set(requestId, (message) => {
        if (message.type === "built-chunk") {
          resolve(message.chunk);
        }
      });
      const message: ChunkBuildRequestMessage = {
        type: "build-chunk",
        requestId,
        request,
      };
      poolWorker.worker.postMessage(message);
    });
  }

  dispose() {
    for (const poolWorker of this.pool) {
      poolWorker.worker.terminate();
    }
  }

  private leastBusy(): PoolWorker {
    let best = this.pool[0]!;
    for (let i = 1; i < this.pool.length; i++) {
      if (this.pool[i]!.pendingCount < best.pendingCount) {
        best = this.pool[i]!;
      }
    }
    return best;
  }
}
