import type {
  AtmosphereState,
  ChunkRequest,
  PlayerSnapshot,
  QualityPreset,
  TerrainChunkData,
  WorldSeed,
  WorldSnapshot,
} from "../domain/procedural/world";
import {
  chunkCoordFromPosition,
  createAtmosphereState,
  createWorldSnapshot,
  makeChunkId,
  sampleTerrain,
  terrainResolutionForLod,
} from "../domain/procedural/world";
import type {
  ChunkGenerationQueue,
  ChunkRepository,
  DesiredChunk,
  InputStatePort,
  PresentationMode,
  RendererDebugStats,
  RendererPort,
  VisualDebugMode,
} from "./contracts";

const FIXED_STEP = 1 / 60;
const WALK_SPEED = 7.5;
const FLY_SPEED = 12;
const TURN_SPEED = 1.9;
const CHUNK_RING = 2;

interface GameAppOptions {
  renderer: RendererPort;
  input: InputStatePort;
  queue: ChunkGenerationQueue;
  repository: ChunkRepository;
  worldSeed: WorldSeed;
  chunkSize: number;
  qualityPreset: QualityPreset;
  freezeTime?: boolean;
  presentationMode?: PresentationMode;
  visualDebugMode?: VisualDebugMode;
}

interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: "walk" | "fly";
}

interface RuntimeCounters {
  ack: number;
  tick: number;
  drawCalls: number;
  status: string;
}

declare global {
  interface Window {
    __wrelaRuntime?: Record<string, unknown>;
    __wrelaMetrics?: Record<string, unknown>;
  }
}

export class GameApp {
  private readonly renderer: RendererPort;
  private readonly input: InputStatePort;
  private readonly queue: ChunkGenerationQueue;
  private readonly repository: ChunkRepository;
  private readonly worldSeed: WorldSeed;
  private readonly chunkSize: number;
  private readonly qualityPreset: QualityPreset;
  private readonly freezeTime: boolean;
  private readonly visualDebugMode: VisualDebugMode;
  private readonly mountedChunks = new Map<string, TerrainChunkData>();
  private readonly inflightChunks = new Map<string, Promise<TerrainChunkData>>();
  private readonly desiredChunkIds = new Set<string>();
  private player: PlayerState = {
    x: 0,
    y: 6,
    z: 0,
    yaw: Math.PI * 0.25,
    mode: "walk",
  };
  private runtime: RuntimeCounters = {
    ack: 0,
    tick: 0,
    drawCalls: 0,
    status: "booting redwood biome slice",
  };
  private atmosphereState: AtmosphereState = createAtmosphereState(0);
  private elapsedSeconds = 0;
  private lastFrameTime = 0;
  private accumulator = 0;
  private animationFrame = 0;
  private disposed = false;
  private presentationMode: PresentationMode;

  constructor(options: GameAppOptions) {
    this.renderer = options.renderer;
    this.input = options.input;
    this.queue = options.queue;
    this.repository = options.repository;
    this.worldSeed = options.worldSeed;
    this.chunkSize = options.chunkSize;
    this.qualityPreset = options.qualityPreset;
    this.freezeTime = options.freezeTime ?? false;
    this.presentationMode = options.presentationMode ?? "follow";
    this.visualDebugMode = options.visualDebugMode ?? "default";
  }

  async start() {
    this.renderer.setQualityPreset(this.qualityPreset);
    this.renderer.setPresentationMode(this.presentationMode);
    this.renderer.setVisualDebugMode(this.visualDebugMode);
    await this.ensureDesiredChunks();
    this.syncPlayerToTerrain();
    this.runtime.status = "running redwood biome slice";
    this.pushRuntime();
    this.animationFrame = window.requestAnimationFrame(this.onAnimationFrame);
  }

  advanceTime(milliseconds: number) {
    const steps = Math.max(1, Math.round(milliseconds / (FIXED_STEP * 1000)));
    for (let index = 0; index < steps; index++) {
      void this.step(FIXED_STEP);
      this.renderer.render();
      this.runtime.drawCalls += 1;
    }
    this.pushRuntime();
  }

  resize() {
    this.renderer.resize();
  }

  dispose() {
    this.disposed = true;
    window.cancelAnimationFrame(this.animationFrame);
    this.renderer.dispose();
    this.queue.dispose();
    this.input.dispose();
  }

  getSnapshot() {
    return this.buildSnapshot();
  }

  getDebugStats(): RendererDebugStats {
    return this.renderer.getDebugStats();
  }

  async captureFrame(size?: { width: number; height: number }) {
    return this.renderer.captureFrame(size);
  }

  setPresentationMode(mode: PresentationMode) {
    this.presentationMode = mode;
    this.renderer.setPresentationMode(mode);
    this.renderer.setPlayerPose(this.player);
    this.renderer.render();
    this.pushRuntime();
  }

  setVisualDebugMode(mode: VisualDebugMode) {
    this.renderer.setVisualDebugMode(mode);
    this.renderer.render();
    this.pushRuntime();
  }

  private readonly onAnimationFrame = (now: number) => {
    if (this.disposed) {
      return;
    }

    if (this.lastFrameTime === 0) {
      this.lastFrameTime = now;
    }

    const delta = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.accumulator += delta;

    while (this.accumulator >= FIXED_STEP) {
      void this.step(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }

    this.renderer.render();
    this.runtime.drawCalls += 1;
    this.pushRuntime();
    this.animationFrame = window.requestAnimationFrame(this.onAnimationFrame);
  };

  private async step(deltaSeconds: number) {
    if (!this.freezeTime) {
      this.elapsedSeconds += deltaSeconds;
    }
    this.runtime.ack += 1;
    this.runtime.tick += 1;

    this.handleModeToggles();
    this.updatePlayer(deltaSeconds);

    this.atmosphereState = createAtmosphereState(this.elapsedSeconds);
    this.renderer.setAtmosphereState(this.atmosphereState);
    this.renderer.setPlayerPose(this.player);

    if (this.runtime.tick % 6 === 0) {
      await this.ensureDesiredChunks();
    }
  }

  private handleModeToggles() {
    if (this.input.consumePressed("toggleFly")) {
      this.player.mode = this.player.mode === "walk" ? "fly" : "walk";
      if (this.player.mode === "walk") {
        this.syncPlayerToTerrain();
      } else {
        this.player.y += 1.8;
      }
      this.runtime.status = `${this.player.mode} mode in redwood biome slice`;
    }

    if (this.input.consumePressed("reset")) {
      this.player = {
        x: 0,
        y: 6,
        z: 0,
        yaw: Math.PI * 0.25,
        mode: "walk",
      };
      this.syncPlayerToTerrain();
      this.runtime.status = "player reset in redwood biome slice";
    }
  }

  private updatePlayer(deltaSeconds: number) {
    const turn = (this.input.isDown("turnRight") ? 1 : 0) - (this.input.isDown("turnLeft") ? 1 : 0);
    this.player.yaw += turn * TURN_SPEED * deltaSeconds;

    const forward =
      (this.input.isDown("moveForward") ? 1 : 0) - (this.input.isDown("moveBackward") ? 1 : 0);
    const speed = this.player.mode === "fly" ? FLY_SPEED : WALK_SPEED;
    const moveAmount = forward * speed * deltaSeconds;
    const dirX = Math.sin(this.player.yaw);
    const dirZ = Math.cos(this.player.yaw);

    const nextX = this.player.x + dirX * moveAmount;
    const nextZ = this.player.z + dirZ * moveAmount;

    if (this.player.mode === "walk") {
      const resolved = this.resolveHorizontalCollisions(nextX, nextZ);
      this.player.x = resolved.x;
      this.player.z = resolved.z;
      this.player.y = sampleTerrain(this.worldSeed, this.player.x, this.player.z).height + 1.85;
      return;
    }

    this.player.x = nextX;
    this.player.z = nextZ;
    this.player.y +=
      ((this.input.isDown("ascend") ? 1 : 0) - (this.input.isDown("descend") ? 1 : 0)) *
      FLY_SPEED *
      0.65 *
      deltaSeconds;
    this.player.y = Math.max(
      sampleTerrain(this.worldSeed, this.player.x, this.player.z).height + 1.2,
      this.player.y,
    );
  }

  private resolveHorizontalCollisions(nextX: number, nextZ: number) {
    let x = nextX;
    let z = nextZ;

    for (const chunk of this.mountedChunks.values()) {
      for (const collider of chunk.collisions.trunks) {
        const dx = x - collider.x;
        const dz = z - collider.z;
        const distance = Math.hypot(dx, dz);
        const pushRadius = collider.radius + 0.38;
        if (distance > 0 && distance < pushRadius) {
          const push = (pushRadius - distance) / distance;
          x += dx * push;
          z += dz * push;
        }
      }
    }

    return { x, z };
  }

  private syncPlayerToTerrain() {
    this.player.y = sampleTerrain(this.worldSeed, this.player.x, this.player.z).height + 1.85;
  }

  private async ensureDesiredChunks() {
    const desired = planDesiredChunks(
      {
        x: this.player.x,
        z: this.player.z,
      },
      this.chunkSize,
      CHUNK_RING,
    );

    this.desiredChunkIds.clear();
    for (const entry of desired) {
      this.desiredChunkIds.add(makeChunkId(entry.coord));
    }

    await Promise.all(desired.map((entry) => this.ensureChunk(entry)));

    for (const [chunkId] of this.mountedChunks) {
      if (!this.desiredChunkIds.has(chunkId)) {
        this.mountedChunks.delete(chunkId);
        this.renderer.unmountChunk(chunkId);
      }
    }
  }

  private async ensureChunk(desired: DesiredChunk) {
    const chunkId = makeChunkId(desired.coord);
    if (this.mountedChunks.has(chunkId)) {
      return;
    }

    const cached = this.repository.get(chunkId);
    if (cached) {
      await this.renderer.mountChunk(cached);
      this.mountedChunks.set(chunkId, cached);
      return;
    }

    if (!this.inflightChunks.has(chunkId)) {
      const request: ChunkRequest = {
        coord: desired.coord,
        lod: desired.lod,
        seed: this.worldSeed,
        chunkSize: this.chunkSize,
        resolution: terrainResolutionForLod(desired.lod),
      };
      this.inflightChunks.set(chunkId, this.queue.request(request));
    }

    const chunk = await this.inflightChunks.get(chunkId)!;
    this.inflightChunks.delete(chunkId);
    this.repository.set(chunkId, chunk);
    if (this.desiredChunkIds.has(chunkId)) {
      await this.renderer.mountChunk(chunk);
      this.mountedChunks.set(chunkId, chunk);
    }
  }

  private buildSnapshot(): WorldSnapshot {
    const visibleChunkIds = [...this.mountedChunks.keys()].sort();
    const counts = [...this.mountedChunks.values()].reduce(
      (totals, chunk) => {
        totals.trees += chunk.treeSpawns.length;
        totals.rocks += chunk.rockSpawns.length;
        totals.ferns += chunk.fernSpawns.length;
        totals.logs += chunk.logSpawns.length;
        return totals;
      },
      { trees: 0, rocks: 0, ferns: 0, logs: 0 },
    );

    const player: PlayerSnapshot = {
      x: round(this.player.x),
      y: round(this.player.y),
      z: round(this.player.z),
      yaw: round(this.player.yaw),
      mode: this.player.mode,
      currentChunk: chunkCoordFromPosition(this.player.x, this.player.z, this.chunkSize),
    };

    return createWorldSnapshot({
      player,
      visibleChunkIds,
      worldSeed: this.worldSeed,
      trees: counts.trees,
      rocks: counts.rocks,
      ferns: counts.ferns,
      logs: counts.logs,
      atmosphere: this.atmosphereState,
      runtime: this.runtime,
      mode: "running",
      status: this.runtime.status,
    });
  }

  private pushRuntime() {
    const snapshot = this.buildSnapshot();
    this.renderer.updateDiagnostics(snapshot);
    window.__wrelaRuntime = {
      status: snapshot.status,
      mode: snapshot.mode,
      player: snapshot.player,
      world: snapshot.world,
      atmosphere: snapshot.atmosphere,
      ack: snapshot.runtime.ack,
      tick: snapshot.runtime.tick,
      drawCalls: snapshot.runtime.drawCalls,
    };
    window.__wrelaMetrics = {
      ack: snapshot.runtime.ack,
      tick: snapshot.runtime.tick,
      drawCalls: snapshot.runtime.drawCalls,
      chunks: snapshot.world.loadedChunks,
      trees: snapshot.world.trees,
    };
  }
}

export function planDesiredChunks(
  player: { x: number; z: number },
  chunkSize: number,
  ringRadius: number,
) {
  const center = chunkCoordFromPosition(player.x, player.z, chunkSize);
  const desired: DesiredChunk[] = [];

  for (let dz = -ringRadius; dz <= ringRadius; dz++) {
    for (let dx = -ringRadius; dx <= ringRadius; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dz));
      desired.push({
        coord: { x: center.x + dx, z: center.z + dz },
        lod: distance === 0 ? 0 : distance === 1 ? 1 : 2,
      });
    }
  }

  return desired.sort((a, b) => a.lod - b.lod);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}
