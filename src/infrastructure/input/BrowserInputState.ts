import type { InputAction, InputStatePort } from "../../application/contracts";

const ACTIONS: Record<string, InputAction> = {
  ArrowUp: "moveForward",
  KeyW: "moveForward",
  ArrowDown: "moveBackward",
  KeyS: "moveBackward",
  ArrowLeft: "turnLeft",
  KeyQ: "turnLeft",
  ArrowRight: "turnRight",
  KeyE: "turnRight",
  Space: "ascend",
  KeyA: "descend",
  KeyB: "toggleFly",
  Enter: "reset",
};

export class BrowserInputState implements InputStatePort {
  private readonly down = new Set<InputAction>();
  private readonly pressed = new Set<InputAction>();

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  isDown(action: InputAction) {
    return this.down.has(action);
  }

  consumePressed(action: InputAction) {
    if (!this.pressed.has(action)) {
      return false;
    }
    this.pressed.delete(action);
    return true;
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const action = ACTIONS[event.code];
    if (!action) {
      return;
    }
    this.down.add(action);
    this.pressed.add(action);
    event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    const action = ACTIONS[event.code];
    if (!action) {
      return;
    }
    this.down.delete(action);
    event.preventDefault();
  };

  private readonly onBlur = () => {
    this.down.clear();
    this.pressed.clear();
  };
}
