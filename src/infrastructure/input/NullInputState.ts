import type { InputAction, InputStatePort } from "../../application/contracts";

export class NullInputState implements InputStatePort {
  isDown(_action: InputAction) {
    return false;
  }

  consumePressed(_action: InputAction) {
    return false;
  }

  dispose() {}
}
