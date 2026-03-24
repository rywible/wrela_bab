# Redwood Biome Architecture And Project Plan

## Vision

Build a stylized, AAA-leaning, fully navigable redwood forest biome on top of Babylon.js with no prebaked meshes or authored art assets. The world should feel hand-directed even though all terrain, trees, rocks, understory, atmosphere, and sky are generated at runtime from code and seeds.

The target reference is not photorealism. The target is strong silhouette design, readable traversal, dramatic atmosphere, and painterly depth in the spirit of stylized open-world exploration games.

## Core Principles

- Favor a great vertical slice over broad but shallow world generation.
- Treat this as a world simulation plus rendering architecture problem, not just a tree generator.
- Keep procedural generation pure and deterministic from seeds.
- Keep Babylon.js at the infrastructure edge rather than the center of the codebase.
- Design streaming, LOD, and performance constraints from day one.
- Use physically grounded systems where helpful, then stylize aggressively for the final look.

## Product Goals

- A traversable redwood biome with convincing scale and density.
- Chunk-streamed procedural terrain with stable deterministic generation.
- Procedural redwoods, canopy, rocks, logs, ferns, and forest debris.
- Stylized atmosphere, depth fog, sky, and time-of-day coherence.
- Strong near-field and far-field composition with clearings, groves, and vistas.
- Clean architecture that allows world logic to evolve independently of the renderer.

## Non-Goals For Early Milestones

- Multiple biomes before the redwood slice is excellent.
- Full realism or physically exact simulation.
- Fully unique hero-quality geometry for every tree in the world.
- Large gameplay systems before traversal, streaming, and biome mood are working.
- Full volumetric clouds and advanced volumetrics in the first rendering pass.

## Recommended Architecture

Use a clean three-layer structure:

- `domain`
- `application`
- `infrastructure`

Add a small composition root for wiring.

```text
src/
  domain/
    atmosphere/
    biome/
    flora/
    navigation/
    terrain/
    world/
    math/

  application/
    dto/
    ports/
    services/
    useCases/

  infrastructure/
    babylon/
      atmosphere/
      lighting/
      materials/
      post/
      scene/
      shadows/
      terrain/
      vegetation/
    input/
    storage/
    workers/
    diagnostics/

  composition/
    bootstrap.ts
    registerDependencies.ts

  main.ts
```

## Layer Responsibilities

### Domain

The domain layer owns the world rules and procedural logic.

Examples:

- world seeds and chunk coordinates
- biome classification and biome fields
- terrain height, slope, moisture, drainage, concavity
- erosion logic
- redwood growth parameters and canopy rules
- scatter rules for rocks, logs, and understory
- atmosphere parameter state
- time-of-day state and world clock

Rules:

- No Babylon imports.
- No browser or DOM dependencies.
- Deterministic output from explicit inputs and seeds.
- Prefer plain objects, typed arrays, and math utilities.

### Application

The application layer orchestrates use cases and workflow.

Examples:

- stream chunks around the player
- build or evict chunk content
- advance world clock
- change quality preset
- request worker jobs
- coordinate caches and render updates

Rules:

- Can import `domain`.
- Must not depend on Babylon types.
- Defines ports/interfaces implemented by infrastructure.

### Infrastructure

The infrastructure layer adapts the world into Babylon.js and browser systems.

Examples:

- Babylon scene creation
- mesh upload and buffer management
- thin instances and impostors
- terrain materials and foliage shaders
- directional light, shadow setup, fog, post-process
- worker plumbing
- IndexedDB or memory caching
- input adapters and diagnostics overlays

Rules:

- May import `application` and `domain`.
- Babylon-specific concepts stay here.
- Rendering code should consume generated data rather than generate world logic itself.

## Dependency Rules

- `domain` imports nothing from `application` or `infrastructure`.
- `application` imports `domain` only.
- `infrastructure` imports both.
- Babylon types such as `Scene`, `Mesh`, `Vector3`, `Color3`, and `ShaderMaterial` must not leak into `domain` or `application`.

## World Model

The world should be deterministic and chunk-based.

- Every chunk is derived from `worldSeed + chunkCoord`.
- Chunk generation should be reproducible and side-effect free.
- Streaming should load only nearby chunks at high fidelity.
- Far chunks should switch to lighter representations.

Suggested chunk outputs:

- terrain mesh data
- biome scalar fields
- tree spawn descriptors
- archetype references
- rock and understory instances
- collision/navigation data
- atmosphere-local overrides if needed

## Procedural Generation Pipeline

### 1. Macro Terrain

Start with chunked heightfield terrain rather than voxels.

Suggested techniques:

- domain-warped FBM noise for large terrain motion
- ridged noise for dramatic forms
- erosion passes for creek cuts and believable drainage
- derived scalar fields for slope, curvature, wetness, and exposure

### 2. Biome Fields

Build continuous fields that drive placement and style:

- elevation
- slope
- moisture
- drainage
- concavity
- canopy openness
- grove density
- old-growth factor

These fields should drive flora density, tree spacing, rock frequency, understory type, and local palette shifts.

### 3. Forest Composition

Avoid uniform randomness. Forest composition should be intentionally art-directed through fields and masks.

Suggested systems:

- grove masks for dense old-growth clusters
- glen masks for clearings and traversal pockets
- vista masks for long-range sightlines
- creek corridor masks for wet lowland storytelling

### 4. Tree Placement

Use variable-radius Poisson disk sampling.

Why:

- giant redwoods need spacing
- spacing should react to local biome fields
- it creates believable competition and negative space

Large redwoods should reserve space. Smaller companion vegetation can fill based on leftover density.

### 5. Tree Generation

Use procedural tree families, not single-use bespoke meshes.

Suggested approach:

- define redwood archetype families
- generate trunk splines and taper profiles
- add root flare and buttress logic near the base
- use constrained stochastic branching or space-colonization for branch skeletons
- place canopy clumps high in the crown

Important visual traits for redwoods:

- massive tapering trunks
- high canopy concentration
- sparse lower branches
- branch scars and dead limbs
- subtle lean and age variation

### 6. Rocks, Logs, And Understory

Generate supporting biome props procedurally too.

Suggested approach:

- rocks from distorted subdivided primitives
- fallen logs from tree-derivative geometry
- ferns from parametric fronds and cards generated at runtime
- debris layers from sparse low-cost instances

Understory should respond strongly to canopy openness and moisture.

## Rendering Strategy In Babylon.js

Babylon should render the world, not define it.

### Near, Mid, And Far Strategy

- Near field: hero procedural meshes and full shading.
- Mid field: reusable procedural archetypes with variation.
- Far field: runtime-generated impostors, billboards, or simplified geometry.

### Babylon Features To Lean On

- `thin instances` for high-volume repeated vegetation and debris
- custom `ShaderMaterial` or Node Material where procedural shading matters
- chunked mesh buffers for terrain
- `RenderTargetTexture` for runtime impostor generation
- worker-driven generation with main-thread upload only
- frozen world matrices and material state for static content

### Babylon Usage Guidelines

- Prefer granular Babylon imports for better tree-shaking.
- Keep all Babylon setup under `infrastructure/babylon`.
- Use explicit renderer adapters rather than direct scene mutation from app logic.

## LOD And Streaming

LOD is not optional for a dense forest.

Recommended levels:

- LOD0: full local procedural geometry for hero trees and nearby clutter
- LOD1: reduced branch detail and canopy complexity
- LOD2: simplified trunk and canopy archetypes with thin instances
- LOD3: impostors or very cheap silhouettes

Streaming rules:

- generate chunks in workers
- maintain deterministic chunk caches
- upload and dispose Babylon resources by distance bands
- budget triangle count, instance count, and shadow casters separately

## Lighting And Shadows

The biome mood will depend more on atmospheric layering than on brute-force realism.

### Lighting

- one directional light for the sun
- hemispheric or atmosphere-derived ambient fill
- strong warm/cool art direction between light and shade
- foliage backscatter or translucency term for canopy glow

### Shadows

- cascaded shadow maps for near and mid distance
- expensive shadow casting only for nearby hero trees and key geometry
- simplified or disabled shadows for far vegetation
- SSAO or contact-darkening pass for grounding roots, rocks, and logs

### Fog And Aerial Perspective

This is one of the highest-value systems in the project.

- height fog for valley and ground haze
- aerial perspective for distant blue separation
- stronger stylization than physically correct values
- color tied to sun angle and sky state

## Sky And Atmosphere

### Initial Sky

Start with a simpler stylized sky:

- analytic gradient sky
- sun disk
- horizon tint
- layered procedural clouds
- coherent time-of-day color palette

### Hillaire-Style Atmosphere

This is a strong medium-term target once the biome slice works.

Why it fits:

- gives coherent sky, sun color, ambient tint, and aerial perspective
- creates deep cinematic distance in forest layers
- supports time-of-day shifts without disconnected hacks

Recommended Hillaire-inspired components:

- transmittance LUT
- multi-scattering LUT
- sky-view LUT
- optional aerial perspective LUT

Use the atmosphere as a physically grounded backbone, then stylize the final output through palette remapping, contrast shaping, and exaggerated fog density.

## Materials And Stylization

Stylization should be deliberate rather than generic.

Recommended material principles:

- emphasize readable silhouettes over micro-detail
- use broad color zones instead of photoreal textures
- procedural bark striation and moss breakup
- canopy color variation by height, light, and age
- palette compression to keep the biome cohesive
- strong separation between sunlit gold, neutral bark, and cool atmospheric blues

## Performance Strategy

Browser scope requires hard discipline.

- keep generation in workers where possible
- cache archetypes and reuse aggressively
- avoid full unique geometry for every tree
- cull by chunk and by system
- budget shadow casters and post-process cost carefully
- profile CPU submission costs, not just GPU frame time

## Recommended Domain Concepts

Useful domain objects and concepts:

- `WorldSeed`
- `ChunkCoord`
- `ChunkDescriptor`
- `BiomeFields`
- `TerrainSample`
- `TreeArchetype`
- `GeneratedTree`
- `ScatterPatch`
- `AtmosphereState`
- `TimeOfDayState`
- `QualityPreset`

## Recommended Application Ports

Examples of clean seam interfaces:

- `ChunkGenerationQueue`
- `ChunkRepository`
- `ChunkRenderer`
- `AtmosphereRenderer`
- `WorldClockPort`
- `InputStatePort`
- `DiagnosticsPort`

## High-Level Implementation Plan

### Phase 0: Foundation

- establish `domain / application / infrastructure` layout
- move Babylon setup into infrastructure
- add composition root and dependency wiring
- define seeds, chunk keys, and core DTOs
- set up workers for generation tasks

### Phase 1: Traversable Vertical Slice

- build chunked terrain generation
- add player traversal and camera
- stream a small area around the player
- visualize debug scalar fields for terrain and biome tuning

Exit criteria:

- stable traversal through streamed chunks
- deterministic chunk regeneration
- clean separation between world logic and renderer

### Phase 2: Redwood Generator

- implement redwood archetype families
- generate trunk profiles and canopy placements
- place hero trees with variable-radius Poisson sampling
- add rock and log generation

Exit criteria:

- a single grove already feels like a redwood biome
- trunks and canopy silhouettes read at multiple distances

### Phase 3: Forest Density And Composition

- add grove, glen, vista, and creek masks
- generate understory and debris
- tune placement rules for readability and density
- create far-field composition that frames traversal

Exit criteria:

- the forest feels authored, not random
- paths, clearings, and viewpoints emerge naturally

### Phase 4: LOD And Runtime Impostors

- formalize vegetation LOD bands
- generate runtime impostors for far trees
- optimize chunk upload and disposal
- freeze and batch static content

Exit criteria:

- dense biome remains performant while moving through it
- distant forest remains visually coherent

### Phase 5: Lighting, Shadows, Atmosphere

- add cascaded sun shadows
- add contact darkening or SSAO
- add height fog and stronger aerial perspective
- implement first stylized sky system

Exit criteria:

- forest depth reads strongly
- trunks, roots, and debris feel grounded
- lighting is mood-defining rather than merely functional

### Phase 6: Hillaire-Style Atmosphere Upgrade

- implement LUT-backed atmosphere pipeline
- unify sun color, ambient tint, and aerial perspective
- tie material fogging and distance color into atmosphere state
- art-direct the final stylized output

Exit criteria:

- time-of-day feels coherent across sky, fog, and lighting
- distance layering becomes a signature strength of the biome

### Phase 7: Polish

- wind response and canopy motion
- weather states
- sound-reactive ambience if desired later
- post-process tuning
- debug and quality presets

## Early Risk Areas

- over-generating unique geometry and blowing CPU budgets
- allowing Babylon-specific decisions to leak into domain logic
- trying to solve the entire atmosphere stack before the biome composition works
- pursuing realism instead of strong stylized readability
- delaying LOD and streaming decisions until content volume is already too high

## Recommended First Milestone In This Repo

The best first concrete milestone is:

"A small traversable redwood grove with streamed chunked terrain, one excellent procedural redwood family, simple sky, fog, directional light, and basic shadowing."

That milestone is small enough to ship, large enough to validate the architecture, and representative enough to expose the hard problems early.
