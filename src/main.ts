import "./style.css";
import type { VisualDebugMode } from "./application/contracts";
import { bootstrapGame } from "./composition/bootstrapGame";

declare global {
  interface Window {
    advanceTime?: (ms: number) => void;
    render_game_to_text?: () => string;
    __wrelaRuntime?: Record<string, unknown>;
    __wrelaMetrics?: Record<string, unknown>;
    __wrelaDebug?: {
      captureMode: boolean;
      setPresentationMode: (mode: "follow" | "overview" | "grove" | "valley" | "ridge") => void;
      setVisualMode: (mode: VisualDebugMode) => void;
      getSceneStats: () => unknown;
      captureScene: (size?: { width: number; height: number }) => Promise<string>;
    };
  }
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Could not find #app");
}

app.innerHTML = `
  <section class="app-shell">
    <div class="hud-card">
      <p class="eyebrow">WebGPU Redwood Biome Slice</p>
      <h1>wrela_bab</h1>
      <p data-role="runtime" class="runtime-copy">booting redwood biome slice</p>
      <p class="lede">
        Arrow keys move and turn. Press <code>B</code> for fly mode, <code>Space</code> to climb,
        <code>A</code> to descend, and <code>Enter</code> to reset.
      </p>
      <pre data-role="diag" class="diag">waiting for WebGPU...</pre>
    </div>
    <canvas id="renderCanvas" class="render-canvas" data-ready="0" aria-label="Procedural redwood biome"></canvas>
  </section>
`;

const canvas = app.querySelector<HTMLCanvasElement>(".render-canvas");
const runtimeLabel = app.querySelector<HTMLElement>("[data-role='runtime']");
const urlParams = new URLSearchParams(window.location.search);
const captureMode = urlParams.get("capture") === "1" || urlParams.get("capture") === "true";
const requestedVisualMode = urlParams.get("visual");
const visualModes = new Set<VisualDebugMode>([
  "default",
  "flat",
  "coastDistance",
  "flowAccumulation",
  "floodplain",
  "fogExposure",
  "redwoodSuitability",
]);
const visualDebugMode: VisualDebugMode = visualModes.has(requestedVisualMode as VisualDebugMode)
  ? (requestedVisualMode as VisualDebugMode)
  : "default";

if (captureMode) {
  document.body.dataset.captureMode = "1";
}

if (!canvas || !runtimeLabel) {
  throw new Error("Could not find the runtime UI");
}

void (async () => {
  try {
    if (!navigator.gpu) {
      throw new Error(
        "This build requires WebGPU. Try a current Chromium-based browser with WebGPU enabled.",
      );
    }

    const game = await bootstrapGame(canvas, { captureMode, visualDebugMode });
    window.advanceTime = (ms) => {
      game.advanceTime(ms);
    };
    window.render_game_to_text = () => JSON.stringify(game.getSnapshot());
    window.__wrelaDebug = {
      captureMode,
      setPresentationMode: (mode) => {
        game.setPresentationMode(mode);
      },
      setVisualMode: (mode) => {
        game.setVisualDebugMode(mode);
      },
      getSceneStats: () => game.getDebugStats(),
      captureScene: async (size) => game.captureFrame(size),
    };
    window.requestAnimationFrame(() => {
      canvas.dataset.ready = "1";
    });
    window.addEventListener("resize", () => game.resize());
    window.addEventListener(
      "beforeunload",
      () => {
        game.dispose();
      },
      { once: true },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtimeLabel.textContent = "unsupported runtime";
    app.classList.add("app-shell--error");
    const diag = app.querySelector<HTMLElement>("[data-role='diag']");
    if (diag) {
      diag.textContent = message;
    }
    window.__wrelaRuntime = {
      status: "unsupported runtime",
      error: message,
      ack: 0,
      tick: 0,
      drawCalls: 0,
    };
    window.__wrelaMetrics = {
      ack: 0,
      tick: 0,
      drawCalls: 0,
    };
    window.__wrelaDebug = {
      captureMode,
      setPresentationMode: () => {},
      setVisualMode: () => {},
      getSceneStats: () => ({}),
      captureScene: async () => "",
    };
    window.render_game_to_text = () =>
      JSON.stringify({
        mode: "unsupported",
        status: "unsupported runtime",
        error: message,
      });
  }
})();
