import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Scene } from "@babylonjs/core/scene";
import type {
  PresentationMode,
  RendererDebugStats,
  RendererPort,
  VisualDebugMode,
} from "../../application/contracts";
import type {
  AtmosphereState,
  QualityPreset,
  TerrainChunkData,
  TreeArchetype,
  WorldSnapshot,
} from "../../domain/procedural/world";

interface ChunkVisuals {
  terrain: Mesh;
  trunks: AbstractMesh[];
  canopy: AbstractMesh[];
  rocks: AbstractMesh[];
  ferns: AbstractMesh[];
  logs: AbstractMesh[];
}

export class BabylonRenderer implements RendererPort {
  readonly engine: WebGPUEngine;
  private readonly scene: Scene;
  private readonly camera: FreeCamera;
  private readonly sunLight: DirectionalLight;
  private readonly ambientLight: HemisphericLight;
  private readonly shadowGenerator: ShadowGenerator;
  private readonly hud: HTMLPreElement;
  private readonly runtimeLabel: HTMLParagraphElement;
  private readonly archetypes: TreeArchetype[];
  private readonly terrainMaterial: StandardMaterial;
  private readonly skyMaterial: StandardMaterial;
  private readonly trunkMaterials: StandardMaterial[] = [];
  private readonly canopyMaterial: StandardMaterial;
  private readonly rockMaterial: StandardMaterial;
  private readonly fernMaterial: StandardMaterial;
  private readonly logMaterial: StandardMaterial;
  private readonly skyGradientWeights: number[] = [];
  private readonly skyMesh: Mesh;
  private readonly sunMesh: Mesh;
  private readonly trunkSources = new Map<number, Mesh>();
  private readonly canopySource: Mesh;
  private readonly rockSources: Mesh[];
  private readonly fernSources: Mesh[];
  private readonly logSource: Mesh;
  private readonly debugVisuals: AbstractMesh[];
  private readonly chunkVisuals = new Map<string, ChunkVisuals>();
  private presentationMode: PresentationMode = "follow";
  private visualDebugMode: VisualDebugMode = "default";

  static async create(options: {
    canvas: HTMLCanvasElement;
    hud: HTMLPreElement;
    runtimeLabel: HTMLParagraphElement;
    archetypes: TreeArchetype[];
  }) {
    const engine = new WebGPUEngine(options.canvas, {
      adaptToDeviceRatio: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    await engine.initAsync();
    return new BabylonRenderer(engine, options);
  }

  private constructor(
    engine: WebGPUEngine,
    options: {
      canvas: HTMLCanvasElement;
      hud: HTMLPreElement;
      runtimeLabel: HTMLParagraphElement;
      archetypes: TreeArchetype[];
    },
  ) {
    this.engine = engine;
    this.hud = options.hud;
    this.runtimeLabel = options.runtimeLabel;
    this.archetypes = options.archetypes;

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.13, 0.18, 0.24, 1);
    this.scene.fogMode = Scene.FOGMODE_EXP2;

    this.camera = new FreeCamera("camera", new Vector3(0, 8, -10), this.scene);
    this.camera.minZ = 0.1;
    this.camera.maxZ = 800;
    this.camera.fov = 0.95;
    this.scene.activeCamera = this.camera;

    this.sunLight = new DirectionalLight("sun", new Vector3(0.4, -1, 0.3), this.scene);
    this.sunLight.position = new Vector3(-40, 80, -20);
    this.sunLight.intensity = 2.05;

    this.ambientLight = new HemisphericLight("ambient", new Vector3(0, 1, 0), this.scene);
    this.ambientLight.intensity = 0.92;
    this.ambientLight.groundColor = new Color3(0.18, 0.22, 0.15);

    this.shadowGenerator = new ShadowGenerator(1024, this.sunLight);
    this.shadowGenerator.bias = 0.0003;
    this.shadowGenerator.darkness = 0.35;
    this.shadowGenerator.usePoissonSampling = true;

    this.terrainMaterial = new StandardMaterial("terrainMaterial", this.scene);
    this.terrainMaterial.diffuseColor = Color3.White();
    this.terrainMaterial.emissiveColor = new Color3(0.2, 0.23, 0.18);
    this.terrainMaterial.specularColor = new Color3(0.08, 0.08, 0.08);
    this.terrainMaterial.backFaceCulling = false;

    this.skyMaterial = new StandardMaterial("skyMaterial", this.scene);
    this.skyMaterial.disableLighting = true;
    this.skyMaterial.disableDepthWrite = true;
    this.skyMaterial.backFaceCulling = false;
    this.skyMaterial.specularColor = Color3.Black();

    this.canopyMaterial = new StandardMaterial("canopyMaterial", this.scene);
    this.canopyMaterial.diffuseColor = new Color3(0.33, 0.48, 0.28);
    this.canopyMaterial.emissiveColor = new Color3(0.16, 0.21, 0.12);
    this.canopyMaterial.specularColor = new Color3(0.04, 0.06, 0.03);

    this.rockMaterial = new StandardMaterial("rockMaterial", this.scene);
    this.rockMaterial.diffuseColor = new Color3(0.44, 0.44, 0.42);
    this.rockMaterial.emissiveColor = new Color3(0.14, 0.14, 0.13);
    this.rockMaterial.specularColor = new Color3(0.06, 0.06, 0.06);

    this.fernMaterial = new StandardMaterial("fernMaterial", this.scene);
    this.fernMaterial.diffuseColor = new Color3(0.26, 0.4, 0.22);
    this.fernMaterial.emissiveColor = new Color3(0.14, 0.2, 0.12);
    this.fernMaterial.specularColor = new Color3(0.02, 0.03, 0.02);

    this.logMaterial = new StandardMaterial("logMaterial", this.scene);
    this.logMaterial.diffuseColor = new Color3(0.42, 0.28, 0.17);
    this.logMaterial.emissiveColor = new Color3(0.14, 0.09, 0.07);
    this.logMaterial.specularColor = new Color3(0.05, 0.03, 0.02);

    this.skyMesh = this.createSkyDome();
    this.skyMesh.material = this.skyMaterial;
    this.skyMesh.renderingGroupId = 0;

    this.sunMesh = MeshBuilder.CreateSphere("sun", { diameter: 18, segments: 12 }, this.scene);
    const sunMaterial = new StandardMaterial("sunMaterial", this.scene);
    sunMaterial.disableLighting = true;
    sunMaterial.emissiveColor = new Color3(1, 0.92, 0.7);
    sunMaterial.specularColor = Color3.Black();
    this.sunMesh.material = sunMaterial;
    this.sunMesh.isPickable = false;
    this.sunMesh.renderingGroupId = 2;

    for (const archetype of this.archetypes) {
      this.trunkSources.set(archetype.id, this.buildTrunkSource(archetype));
    }

    this.canopySource = this.buildCanopySource();
    this.rockSources = [this.buildRockSource(0), this.buildRockSource(1), this.buildRockSource(2)];
    this.fernSources = [this.buildFernSource(0), this.buildFernSource(1)];
    this.logSource = this.buildLogSource();
    this.debugVisuals = this.buildDebugVisuals();
  }

  async mountChunk(chunk: TerrainChunkData) {
    this.unmountChunk(chunk.id);

    const terrain = new Mesh(`terrain-${chunk.id}`, this.scene);
    const terrainData = new VertexData();
    terrainData.positions = chunk.positions;
    terrainData.indices = chunk.indices;
    terrainData.normals = chunk.normals;
    terrainData.colors = chunk.colors;
    terrainData.applyToMesh(terrain);
    terrain.material = this.terrainMaterial;
    terrain.receiveShadows = true;
    terrain.renderingGroupId = 1;
    terrain.useVertexColors = true;

    const trunks = chunk.treeSpawns.map((tree, index) => {
      const source = this.trunkSources.get(tree.archetypeId)!;
      const instance = source.createInstance(`trunk-${chunk.id}-${index}`);
      instance.position.set(tree.x, tree.y, tree.z);
      instance.scaling.set(tree.scale, tree.scale, tree.scale);
      instance.rotation.y = tree.yaw;
      this.shadowGenerator.addShadowCaster(instance);
      return instance;
    });

    const canopy = chunk.treeSpawns.flatMap((tree, treeIndex) => {
      const archetype = this.archetypes[tree.archetypeId]!;
      const clusters: AbstractMesh[] = [];
      const baseHeight = tree.y + archetype.height * tree.scale * archetype.crownStart;

      for (let clusterIndex = 0; clusterIndex < archetype.canopyClusters; clusterIndex++) {
        const angle = (clusterIndex / archetype.canopyClusters) * Math.PI * 2 + tree.yaw;
        const radius = archetype.crownRadius * tree.crownScale * tree.scale;
        const verticalT = clusterIndex / Math.max(1, archetype.canopyClusters - 1);
        const lift = archetype.crownLift * Math.sin(verticalT * Math.PI);
        const instance = this.canopySource.createInstance(
          `canopy-${chunk.id}-${treeIndex}-${clusterIndex}`,
        );
        instance.position.set(
          tree.x + Math.cos(angle) * radius * lerp(0.3, 1, Math.sin(verticalT * Math.PI)),
          baseHeight + lift * 1.6 + verticalT * archetype.height * tree.scale * 0.22,
          tree.z + Math.sin(angle) * radius * lerp(0.3, 1, Math.sin(verticalT * Math.PI)),
        );
        const clusterScale = tree.scale * lerp(0.7, 1.15, (clusterIndex % 3) / 2);
        instance.scaling.set(clusterScale, clusterScale * 0.78, clusterScale);
        instance.rotation.y = angle * 0.6;
        this.shadowGenerator.addShadowCaster(instance);
        clusters.push(instance);
      }

      return clusters;
    });

    const rocks = chunk.rockSpawns.map((rock, index) => {
      const source = this.rockSources[rock.variant % this.rockSources.length]!;
      const instance = source.createInstance(`rock-${chunk.id}-${index}`);
      instance.position.set(rock.x, rock.y, rock.z);
      instance.scaling.set(rock.scale, rock.scale * 0.82, rock.scale);
      instance.rotation.y = rock.yaw;
      this.shadowGenerator.addShadowCaster(instance);
      return instance;
    });

    const ferns = chunk.fernSpawns.map((fern, index) => {
      const source = this.fernSources[fern.variant % this.fernSources.length]!;
      const instance = source.createInstance(`fern-${chunk.id}-${index}`);
      instance.position.set(fern.x, fern.y, fern.z);
      instance.scaling.set(fern.scale, fern.scale, fern.scale);
      instance.rotation.y = fern.yaw;
      return instance;
    });

    const logs = chunk.logSpawns.map((log, index) => {
      const instance = this.logSource.createInstance(`log-${chunk.id}-${index}`);
      instance.position.set(log.x, log.y, log.z);
      instance.scaling.set(log.length, log.radius * 2.2, log.radius * 2.2);
      instance.rotation.y = log.yaw;
      instance.rotation.z = log.pitch;
      this.shadowGenerator.addShadowCaster(instance);
      return instance;
    });

    this.chunkVisuals.set(chunk.id, {
      terrain,
      trunks,
      canopy,
      rocks,
      ferns,
      logs,
    });
  }

  async updateChunk(chunk: TerrainChunkData) {
    await this.mountChunk(chunk);
  }

  unmountChunk(chunkId: string) {
    const visuals = this.chunkVisuals.get(chunkId);
    if (!visuals) {
      return;
    }

    visuals.terrain.dispose();
    visuals.trunks.forEach((mesh) => mesh.dispose());
    visuals.canopy.forEach((mesh) => mesh.dispose());
    visuals.rocks.forEach((mesh) => mesh.dispose());
    visuals.ferns.forEach((mesh) => mesh.dispose());
    visuals.logs.forEach((mesh) => mesh.dispose());
    this.chunkVisuals.delete(chunkId);
  }

  setAtmosphereState(state: AtmosphereState) {
    const skyColors = this.skyMesh.getVerticesData(VertexBuffer.ColorKind);
    if (skyColors) {
      for (let index = 0; index < skyColors.length; index += 4) {
        const weight = this.skyGradientWeights[index / 4] ?? 0.5;
        const color = mixColor(state.horizon, state.skyTop, weight);
        skyColors[index] = color[0];
        skyColors[index + 1] = color[1];
        skyColors[index + 2] = color[2];
      }
      this.skyMesh.updateVerticesData(VertexBuffer.ColorKind, skyColors);
      this.skyMesh.useVertexColors = true;
    }

    this.skyMaterial.emissiveColor = new Color3(
      state.skyTop[0] * 0.82,
      state.skyTop[1] * 0.82,
      state.skyTop[2] * 0.82,
    );
    this.scene.clearColor = new Color4(state.horizon[0], state.horizon[1], state.horizon[2], 1);
    this.scene.fogColor = new Color3(state.fogColor[0], state.fogColor[1], state.fogColor[2]);
    this.scene.fogDensity = this.visualDebugMode === "flat" ? 0 : state.fogDensity;

    this.sunLight.direction = new Vector3(...state.sunDirection);
    this.sunLight.diffuse = new Color3(state.sunColor[0], state.sunColor[1], state.sunColor[2]);
    this.ambientLight.diffuse = new Color3(
      state.ambientColor[0],
      state.ambientColor[1],
      state.ambientColor[2],
    );
    this.ambientLight.groundColor = new Color3(state.ground[0], state.ground[1], state.ground[2]);

    this.sunMesh.position.set(
      -state.sunDirection[0] * 240,
      -state.sunDirection[1] * 240,
      -state.sunDirection[2] * 240,
    );
  }

  setQualityPreset(preset: QualityPreset) {
    if (preset === "laptop") {
      this.shadowGenerator.mapSize = 1024;
      return;
    }

    this.shadowGenerator.mapSize = 2048;
  }

  setPresentationMode(mode: PresentationMode) {
    this.presentationMode = mode;
  }

  setVisualDebugMode(mode: VisualDebugMode) {
    const flat = mode === "flat";
    this.visualDebugMode = mode;
    this.skyMesh.isVisible = !flat;
    this.sunMesh.isVisible = !flat;

    this.terrainMaterial.disableLighting = flat;
    this.terrainMaterial.emissiveColor = flat
      ? new Color3(0.32, 0.44, 0.24)
      : new Color3(0.2, 0.23, 0.18);

    this.canopyMaterial.disableLighting = flat;
    this.canopyMaterial.emissiveColor = flat
      ? new Color3(0.18, 0.38, 0.12)
      : new Color3(0.16, 0.21, 0.12);

    this.rockMaterial.disableLighting = flat;
    this.rockMaterial.emissiveColor = flat
      ? new Color3(0.38, 0.38, 0.4)
      : new Color3(0.14, 0.14, 0.13);

    this.fernMaterial.disableLighting = flat;
    this.fernMaterial.emissiveColor = flat
      ? new Color3(0.2, 0.42, 0.16)
      : new Color3(0.14, 0.2, 0.12);

    this.logMaterial.disableLighting = flat;
    this.logMaterial.emissiveColor = flat
      ? new Color3(0.38, 0.21, 0.14)
      : new Color3(0.14, 0.09, 0.07);

    for (const material of this.trunkMaterials) {
      material.disableLighting = flat;
      material.emissiveColor = flat ? new Color3(0.46, 0.26, 0.18) : new Color3(0.11, 0.07, 0.05);
    }

    for (const mesh of this.debugVisuals) {
      mesh.isVisible = flat;
    }
  }

  setPlayerPose(pose: { x: number; y: number; z: number; yaw: number; mode: "walk" | "fly" }) {
    if (this.presentationMode === "overview") {
      this.camera.position.set(-14, 42, -34);
      this.camera.setTarget(new Vector3(19, 19, 19));
      return;
    }

    const dirX = Math.sin(pose.yaw);
    const dirZ = Math.cos(pose.yaw);
    const followDistance = pose.mode === "walk" ? 8.5 : 11.5;
    const lift = pose.mode === "walk" ? 5.6 : 8.2;

    this.camera.position.set(
      pose.x - dirX * followDistance,
      pose.y + lift,
      pose.z - dirZ * followDistance,
    );
    this.camera.setTarget(
      new Vector3(
        pose.x + dirX * 14,
        pose.y + (pose.mode === "walk" ? 2.6 : 1.4),
        pose.z + dirZ * 14,
      ),
    );
  }

  updateDiagnostics(snapshot: WorldSnapshot) {
    const activeMeshes = this.scene.getActiveMeshes().length;
    this.runtimeLabel.textContent = snapshot.status;
    this.hud.textContent = [
      `mode: ${snapshot.player.mode}`,
      `chunk: ${snapshot.player.currentChunk.x}, ${snapshot.player.currentChunk.z}`,
      `player: ${snapshot.player.x.toFixed(1)}, ${snapshot.player.y.toFixed(1)}, ${snapshot.player.z.toFixed(1)}`,
      `chunks: ${snapshot.world.loadedChunks}`,
      `trees: ${snapshot.world.trees}`,
      `rocks: ${snapshot.world.rocks}`,
      `ferns: ${snapshot.world.ferns}`,
      `logs: ${snapshot.world.logs}`,
      `meshes: ${this.scene.meshes.length}`,
      `active: ${activeMeshes}`,
      `fog: ${snapshot.atmosphere.fogDensity.toFixed(4)}`,
      `tick: ${snapshot.runtime.tick}`,
    ].join("\n");
  }

  getDebugStats(): RendererDebugStats {
    const target = this.camera.getTarget();
    const activeMeshes = this.scene.getActiveMeshes();
    const activeMeshNames: string[] = [];

    for (let index = 0; index < Math.min(activeMeshes.length, 32); index++) {
      const mesh = activeMeshes.data[index];
      if (!mesh) {
        continue;
      }
      activeMeshNames.push(`${mesh.name}|group=${mesh.renderingGroupId}|visible=${mesh.isVisible}`);
    }

    return {
      presentationMode: this.presentationMode,
      visualDebugMode: this.visualDebugMode,
      camera: {
        position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
        target: [target.x, target.y, target.z],
      },
      scene: {
        totalMeshes: this.scene.meshes.length,
        activeMeshes: activeMeshes.length,
        activeMeshNames,
      },
    };
  }

  async captureFrame(size = { width: 1360, height: 920 }) {
    this.render();

    const width = this.engine.getRenderWidth();
    const height = this.engine.getRenderHeight();
    const pixels = await this.engine.readPixels(0, 0, width, height, true, true);
    const source = new Uint8ClampedArray(pixels.buffer.slice(0));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not create a 2D canvas context for frame capture.");
    }

    const imageData = context.createImageData(width, height);
    const rowWidth = width * 4;
    for (let row = 0; row < height; row++) {
      const srcOffset = row * rowWidth;
      const dstOffset = (height - row - 1) * rowWidth;
      imageData.data.set(source.subarray(srcOffset, srcOffset + rowWidth), dstOffset);
    }
    context.putImageData(imageData, 0, 0);

    if (size.width === width && size.height === height) {
      return canvas.toDataURL("image/png");
    }

    const scaledCanvas = document.createElement("canvas");
    scaledCanvas.width = size.width;
    scaledCanvas.height = size.height;
    const scaledContext = scaledCanvas.getContext("2d");

    if (!scaledContext) {
      throw new Error("Could not create a scaled 2D canvas context for frame capture.");
    }

    scaledContext.drawImage(canvas, 0, 0, size.width, size.height);
    return scaledCanvas.toDataURL("image/png");
  }

  render() {
    this.engine.beginFrame();
    this.scene.render();
    this.engine.endFrame();
  }

  resize() {
    this.engine.resize();
  }

  dispose() {
    for (const visuals of this.chunkVisuals.values()) {
      visuals.terrain.dispose();
      visuals.trunks.forEach((mesh) => mesh.dispose());
      visuals.canopy.forEach((mesh) => mesh.dispose());
      visuals.rocks.forEach((mesh) => mesh.dispose());
      visuals.ferns.forEach((mesh) => mesh.dispose());
      visuals.logs.forEach((mesh) => mesh.dispose());
    }

    for (const mesh of this.trunkSources.values()) {
      mesh.dispose();
    }
    this.rockSources.forEach((mesh) => mesh.dispose());
    this.fernSources.forEach((mesh) => mesh.dispose());
    this.canopySource.dispose();
    this.logSource.dispose();
    this.debugVisuals.forEach((mesh) => mesh.dispose());
    this.skyMesh.dispose();
    this.sunMesh.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  private createSkyDome() {
    const sky = MeshBuilder.CreateSphere(
      "sky",
      { diameter: 520, segments: 18, sideOrientation: Mesh.BACKSIDE },
      this.scene,
    );
    sky.isPickable = false;
    sky.infiniteDistance = true;

    const positions = sky.getVerticesData(VertexBuffer.PositionKind) ?? [];
    const colors: number[] = [];
    for (let index = 0; index < positions.length; index += 3) {
      const y = positions[index + 1] / 260;
      const t = clamp01((y + 1) * 0.5);
      this.skyGradientWeights.push(t);
      colors.push(0.16, lerp(0.32, 0.18, t), lerp(0.52, 0.24, t), 1);
    }
    sky.setVerticesData(VertexBuffer.ColorKind, colors);
    sky.useVertexColors = true;
    return sky;
  }

  private buildTrunkSource(archetype: TreeArchetype) {
    const path = Array.from({ length: 8 }, (_, index) => {
      const t = index / 7;
      const bend = Math.sin(t * Math.PI * 0.7) * archetype.lean * archetype.height;
      return new Vector3(bend * 0.25, t * archetype.height, bend);
    });
    const trunk = MeshBuilder.CreateTube(
      `trunk-source-${archetype.id}`,
      {
        path,
        radiusFunction: (_, distance) => {
          const base = archetype.baseRadius * (1 - distance * 0.82);
          return Math.max(0.15, base + Math.max(0, 0.24 - distance * 0.32));
        },
        tessellation: 9,
        cap: Mesh.CAP_ALL,
      },
      this.scene,
    );

    const branchMeshes: Mesh[] = [];
    for (let branchIndex = 0; branchIndex < archetype.branchCount; branchIndex++) {
      const t = lerp(
        archetype.crownStart * 0.88,
        archetype.crownStart + 0.2,
        branchIndex / Math.max(1, archetype.branchCount - 1),
      );
      const angle = (branchIndex / Math.max(1, archetype.branchCount)) * Math.PI * 2;
      const branch = MeshBuilder.CreateCylinder(
        `branch-${archetype.id}-${branchIndex}`,
        {
          height: lerp(1.2, 2.4, branchIndex / Math.max(1, archetype.branchCount - 1)),
          diameterTop: 0.08,
          diameterBottom: 0.22,
          tessellation: 6,
        },
        this.scene,
      );
      branch.position.set(
        Math.cos(angle) * archetype.baseRadius * 0.35,
        archetype.height * t,
        Math.sin(angle) * archetype.baseRadius * 0.35,
      );
      branch.rotation.z = Math.PI / 2.8;
      branch.rotation.y = angle;
      branchMeshes.push(branch);
    }

    const merged = Mesh.MergeMeshes([trunk, ...branchMeshes], true, true, undefined, false, true)!;
    const material = new StandardMaterial(`trunk-material-${archetype.id}`, this.scene);
    material.diffuseColor = new Color3(
      lerp(0.23, 0.39, archetype.barkWarmth),
      lerp(0.12, 0.25, archetype.barkWarmth),
      lerp(0.08, 0.14, archetype.barkWarmth),
    );
    material.emissiveColor = new Color3(
      lerp(0.11, 0.18, archetype.barkWarmth),
      lerp(0.06, 0.1, archetype.barkWarmth),
      lerp(0.04, 0.06, archetype.barkWarmth),
    );
    material.specularColor = new Color3(0.03, 0.02, 0.02);
    merged.material = material;
    merged.receiveShadows = true;
    merged.isVisible = false;
    merged.isPickable = false;
    merged.renderingGroupId = 1;
    this.trunkMaterials.push(material);
    return merged;
  }

  private buildCanopySource() {
    const canopy = MeshBuilder.CreateIcoSphere(
      "canopy-source",
      { radius: 1.2, flat: true },
      this.scene,
    );
    const positions = canopy.getVerticesData(VertexBuffer.PositionKind) ?? [];
    for (let index = 0; index < positions.length; index += 3) {
      const scale = 1 + Math.sin(index * 0.31) * 0.08 + Math.cos(index * 0.13) * 0.06;
      positions[index] *= scale * 1.15;
      positions[index + 1] *= scale * 0.84;
      positions[index + 2] *= scale;
    }
    canopy.updateVerticesData(VertexBuffer.PositionKind, positions);
    canopy.material = this.canopyMaterial;
    canopy.receiveShadows = true;
    canopy.isVisible = false;
    canopy.isPickable = false;
    canopy.renderingGroupId = 1;
    return canopy;
  }

  private buildRockSource(variant: number) {
    const rock = MeshBuilder.CreateIcoSphere(
      `rock-source-${variant}`,
      { radius: 0.8 + variant * 0.12, flat: true },
      this.scene,
    );
    const positions = rock.getVerticesData(VertexBuffer.PositionKind) ?? [];
    for (let index = 0; index < positions.length; index += 3) {
      positions[index] *= 1 + Math.sin(index * 0.21 + variant) * 0.14;
      positions[index + 1] *= 0.72 + Math.cos(index * 0.17 + variant) * 0.08;
      positions[index + 2] *= 1 + Math.sin(index * 0.11 + variant) * 0.11;
    }
    rock.updateVerticesData(VertexBuffer.PositionKind, positions);
    rock.material = this.rockMaterial;
    rock.receiveShadows = true;
    rock.isVisible = false;
    rock.isPickable = false;
    rock.renderingGroupId = 1;
    return rock;
  }

  private buildFernSource(variant: number) {
    const left = MeshBuilder.CreateCylinder(
      `fern-left-${variant}`,
      { height: 1.3, diameterTop: 0.05, diameterBottom: 0.22, tessellation: 3 },
      this.scene,
    );
    left.position.set(-0.14, 0.5, 0.12);
    left.rotation.z = -0.42;
    const right = left.clone(`fern-right-${variant}`)!;
    right.position.x = 0.14;
    right.rotation.z = 0.42;
    const center = MeshBuilder.CreateCylinder(
      `fern-center-${variant}`,
      { height: 1.5, diameterTop: 0.04, diameterBottom: 0.24, tessellation: 3 },
      this.scene,
    );
    center.position.y = 0.6;
    const merged = Mesh.MergeMeshes([left, right, center], true, true, undefined, false, true)!;
    merged.material = this.fernMaterial;
    merged.receiveShadows = true;
    merged.isVisible = false;
    merged.isPickable = false;
    merged.renderingGroupId = 1;
    return merged;
  }

  private buildLogSource() {
    const log = MeshBuilder.CreateCylinder(
      "log-source",
      {
        height: 1,
        diameterTop: 1,
        diameterBottom: 1.08,
        tessellation: 10,
      },
      this.scene,
    );
    log.rotation.z = Math.PI / 2;
    log.material = this.logMaterial;
    log.receiveShadows = true;
    log.isVisible = false;
    log.isPickable = false;
    log.renderingGroupId = 1;
    return log;
  }

  private buildDebugVisuals() {
    const visuals: AbstractMesh[] = [];

    const axes = [
      {
        name: "debug-axis-x",
        position: new Vector3(6, 10, 2),
        scaling: new Vector3(8, 0.18, 0.18),
        color: new Color3(1, 0.12, 0.22),
      },
      {
        name: "debug-axis-y",
        position: new Vector3(2, 14, 2),
        scaling: new Vector3(0.22, 8, 0.22),
        color: new Color3(0.14, 0.96, 0.24),
      },
      {
        name: "debug-axis-z",
        position: new Vector3(2, 10, 6),
        scaling: new Vector3(0.18, 0.18, 8),
        color: new Color3(0.14, 0.52, 1),
      },
      {
        name: "debug-focus",
        position: new Vector3(19, 22, 19),
        scaling: new Vector3(3.8, 3.8, 3.8),
        color: new Color3(1, 0.92, 0.18),
      },
    ];

    for (const axis of axes) {
      const mesh = MeshBuilder.CreateBox(axis.name, { size: 1 }, this.scene);
      const material = new StandardMaterial(`${axis.name}-material`, this.scene);
      material.disableLighting = true;
      material.emissiveColor = axis.color;
      material.specularColor = Color3.Black();
      mesh.material = material;
      mesh.position.copyFrom(axis.position);
      mesh.scaling.copyFrom(axis.scaling);
      mesh.isVisible = false;
      mesh.isPickable = false;
      mesh.renderingGroupId = 2;
      visuals.push(mesh);
    }

    return visuals;
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function mixColor(a: [number, number, number], b: [number, number, number], t: number) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)] as const;
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
