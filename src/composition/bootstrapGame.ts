import type { ChunkRepository } from "../application/contracts";
import type { TerrainChunkData } from "../domain/procedural/world";
import { GameApp } from "../application/GameApp";
import { buildRedwoodArchetypes } from "../domain/procedural/world";
import { BabylonRenderer } from "../infrastructure/babylon/BabylonRenderer";
import { BrowserInputState } from "../infrastructure/input/BrowserInputState";
import { NullInputState } from "../infrastructure/input/NullInputState";
import { WorkerChunkGenerationQueue } from "../infrastructure/workers/WorkerChunkGenerationQueue";

const WORLD_SEED = 3421907;
const CHUNK_SIZE = 42;

interface BootstrapOptions {
  captureMode?: boolean;
  visualDebugMode?: "default" | "flat";
}

export async function bootstrapGame(canvas: HTMLCanvasElement, options: BootstrapOptions = {}) {
  if (!navigator.gpu) {
    throw new Error("WebGPU is required for this build.");
  }

  const hud = document.querySelector<HTMLPreElement>("[data-role='diag']");
  const runtimeLabel = document.querySelector<HTMLParagraphElement>("[data-role='runtime']");

  if (!hud || !runtimeLabel) {
    throw new Error("Expected diagnostics overlay nodes to exist.");
  }

  const renderer = await BabylonRenderer.create({
    canvas,
    hud,
    runtimeLabel,
    archetypes: buildRedwoodArchetypes(WORLD_SEED),
  });

  const input = options.captureMode ? new NullInputState() : new BrowserInputState();
  const queue = new WorkerChunkGenerationQueue();
  const repository = createChunkRepository();
  const game = new GameApp({
    renderer,
    input,
    queue,
    repository,
    worldSeed: WORLD_SEED,
    chunkSize: CHUNK_SIZE,
    qualityPreset: "laptop",
    freezeTime: options.captureMode,
    presentationMode: options.captureMode ? "overview" : "follow",
    visualDebugMode: options.visualDebugMode ?? "default",
  });

  await game.start();
  return game;
}

function createChunkRepository(): ChunkRepository {
  const chunks = new Map<string, TerrainChunkData>();

  return {
    get(chunkId) {
      return chunks.get(chunkId);
    },
    set(chunkId, chunk) {
      chunks.set(chunkId, chunk);
    },
    delete(chunkId) {
      chunks.delete(chunkId);
    },
    values() {
      return chunks.values();
    },
  };
}
