import type {
  AtmosphereState,
  ChunkCoord,
  ChunkRequest,
  QualityPreset,
  TerrainChunkData,
  WorldSnapshot,
} from "../domain/procedural/world";

export type PresentationMode = "follow" | "overview";
export type VisualDebugMode = "default" | "flat";

export interface RendererDebugStats {
  presentationMode: PresentationMode;
  visualDebugMode: VisualDebugMode;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
  scene: {
    totalMeshes: number;
    activeMeshes: number;
    activeMeshNames: string[];
  };
}

export interface RendererPort {
  mountChunk(chunk: TerrainChunkData): Promise<void>;
  updateChunk(chunk: TerrainChunkData): Promise<void>;
  unmountChunk(chunkId: string): void;
  setAtmosphereState(state: AtmosphereState): void;
  setQualityPreset(preset: QualityPreset): void;
  setPresentationMode(mode: PresentationMode): void;
  setVisualDebugMode(mode: VisualDebugMode): void;
  setPlayerPose(pose: { x: number; y: number; z: number; yaw: number; mode: "walk" | "fly" }): void;
  updateDiagnostics(snapshot: WorldSnapshot): void;
  getDebugStats(): RendererDebugStats;
  captureFrame(size?: { width: number; height: number }): Promise<string>;
  render(): void;
  resize(): void;
  dispose(): void;
}

export interface ChunkGenerationQueue {
  request(request: ChunkRequest): Promise<TerrainChunkData>;
  dispose(): void;
}

export interface ChunkRepository {
  get(chunkId: string): TerrainChunkData | undefined;
  set(chunkId: string, chunk: TerrainChunkData): void;
  delete(chunkId: string): void;
  values(): IterableIterator<TerrainChunkData>;
}

export interface InputStatePort {
  isDown(action: InputAction): boolean;
  consumePressed(action: InputAction): boolean;
  dispose(): void;
}

export type InputAction =
  | "moveForward"
  | "moveBackward"
  | "turnLeft"
  | "turnRight"
  | "ascend"
  | "descend"
  | "toggleFly"
  | "reset";

export interface DesiredChunk {
  coord: ChunkCoord;
  lod: 0 | 1 | 2;
}
