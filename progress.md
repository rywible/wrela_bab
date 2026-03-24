Original prompt: PLEASE IMPLEMENT THIS PLAN:

# WebGPU Redwood Biome Vertical Slice Plan

- Started implementation from the Babylon starter app.
- Goal for this pass: deliver the foundation, terrain slice, first redwood biome slice, deterministic test hooks, and automated validation loop scaffolding.
- Constraints locked from planning:
  - WebGPU-only
  - web-first runtime
  - Electron later
  - explorer-first vertical slice
  - midrange laptop performance target
- TODO:
  - improve scene art direction and density now that visual validation is stable
  - consider code-splitting the Babylon bundle; `vp build` still warns about a large main chunk

- Completed foundation pass:
  - replaced the starter app with a `domain / application / infrastructure / composition` layout
  - added explicit WebGPU bootstrap and unsupported-runtime handling
  - added deterministic `window.render_game_to_text()` and `window.advanceTime(ms)` hooks
  - added `progress.md` workflow and Playwright validation outputs under `output/web-game`

- Completed vertical-slice systems:
  - deterministic chunked terrain generation with biome fields and streamed chunk loading
  - walk/fly explorer controls, collision against trunk colliders, and HUD diagnostics
  - procedural redwood archetypes, scatter, a hero grove near spawn, rocks, ferns, and logs
  - Babylon infrastructure for terrain meshes, instanced vegetation, atmosphere, fog, and shadows

- Completed validation + desktop track:
  - domain and application tests added and passing under `vp test`
  - repo checks and production build passing under `vp check --fix` and `vp build`
  - Electron shell added with WebGPU command-line switches plus `desktop:*` scripts for dev/run/packaging

- Completed visual-debugging pass:
  - fixed the Babylon WebGPU custom render loop by wrapping scene renders with `engine.beginFrame()` / `engine.endFrame()`
  - aligned the capture path with the Playwright article pattern by relying on `#renderCanvas[data-ready="1"]` plus explicit Chromium WebGPU flags
  - added browser and Electron validation scripts that save screenshots and runtime state under `output/playwright`
  - removed Babylon instanced-mesh warning spam by setting rendering groups on source meshes instead of instances
  - retuned the fixed validation camera so captures show the hero grove, rocks, ferns, and support log instead of mostly foreground terrain

- Latest validation status:
  - `vp check` passes
  - `vp test` passes
  - `vp run visual:validate` passes and produces visually readable browser captures in both default and flat debug modes
  - `vp run visual:validate:electron` passes and produces matching Electron captures
  - the `$develop-web-game` Playwright client succeeds against `movement_sweep`, with non-blank screenshots and positive ack/tick/draw deltas in `output/web-game/latest-run-report.json`

- Current operating note:
  - visual debugging is now reliable enough to use as the default loop for further biome work; the next work should focus on scene quality, density, and rendering polish rather than capture infrastructure.

- Completed research-backed geography refactor:
  - replaced the macro terrain pass with a watershed-first simulation in `src/domain/procedural/worldSimulation.ts`
  - added routed coarse-grid fields for channel width, floodplain, northness, shoulderness, and salt exposure
  - added deterministic spawn selection plus scenic shoreline/valley/ridge bookmarks
  - retuned placement and hero-grove injection so the spawn chunk follows the new fog-belt watershed instead of the old origin chunk
  - updated visual validation to capture shoreline, valley, ridge, and field overlays in both browser and Electron

- Latest validation status after geography refactor:
  - `vp check` passes
  - `vp test` passes with added spawn and routed-drainage tests
  - `vp run visual:validate` passes with the new bookmark workflow
  - `vp run visual:validate:electron` passes with the same bookmark workflow

- Remaining visual note:
  - the structural watershed refactor is in place, but the screenshots still read flatter than desired; the next pass should focus on stronger macro relief/art direction rather than more infrastructure changes

- Artistic tuning pass started:
  - strengthened macro ridges, inland rise, coastal bluffing, ravine accents, and scenic bookmark framing
  - next step is fresh visual QA on shoreline/valley/ridge captures

- Artistic tuning iteration:
  - amplified macro relief substantially; current macro height range now reaches ~767 m
  - widened scenic streaming ring to 10 and narrowed scenic FOV for longer views
  - retuned bookmarks to score on broad relief and shoulder/stream structure instead of flat cells
  - increased redwood suitability and tree density to restore forest presence after relief scaling

- Forest-only terrain pass:
  - replaced shoreline scenic view with grove view and removed visible ocean from validation/runtime framing
  - repurposed scenic capture loop to overview/grove/valley/ridge plus inland debug overlays
  - added extra grove hummocks and shoulder ribs so interior terrain reads under dense canopy
