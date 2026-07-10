export interface Axis2 {
  x: number;
  y: number;
}

const JOYSTICK_DEAD_ZONE = 0.1;
const MOBILE_LOOK_MULTIPLIER = 1.8;

export class MobileControls {
  private readonly root = document.createElement('div');
  private readonly joystickBase = document.createElement('div');
  private readonly joystickKnob = document.createElement('div');
  private readonly lookArea = document.createElement('div');
  private readonly fireButton = document.createElement('button');
  private readonly frontButton = document.createElement('button');
  private readonly moveAxis: Axis2 = { x: 0, y: 0 };
  private readonly lookDelta: Axis2 = { x: 0, y: 0 };
  private readonly coarsePointerQuery = window.matchMedia('(pointer: coarse)');
  private readonly compactViewportQuery = window.matchMedia('(max-width: 760px)');
  // Modern mobile browsers dispatch reliable pointer events for touch. Keep the
  // touch fallback only for older browsers so the same gesture is not handled twice.
  private readonly useTouchEvents = !('PointerEvent' in window);
  private joystickPointerId: number | null = null;
  private lookPointerId: number | null = null;
  private firePointerId: number | null = null;
  private frontPointerId: number | null = null;
  private fireQueued = false;
  private firing = false;
  private frontHeld = false;
  private lastLookX = 0;
  private lastLookY = 0;
  private enabled = false;

  constructor(container: HTMLElement) {
    this.root.className = 'mobile-controls';
    this.joystickBase.className = 'joystick-base';
    this.joystickKnob.className = 'joystick-knob';
    this.lookArea.className = 'look-area';
    this.fireButton.className = 'fire-button';
    this.fireButton.type = 'button';
    this.fireButton.setAttribute('aria-label', 'Fire');
    this.fireButton.textContent = '●';
    this.frontButton.className = 'front-button';
    this.frontButton.type = 'button';
    this.frontButton.setAttribute('aria-label', 'Front check');
    this.frontButton.textContent = 'FRONT';

    this.joystickBase.append(this.joystickKnob);
    this.root.append(this.lookArea, this.joystickBase, this.frontButton, this.fireButton);
    container.append(this.root);

    this.bindPointerStarts();
    this.bindPointerTracking();

    if (this.useTouchEvents) {
      this.bindTouchFallback();
    }

    this.updateAvailability();
    this.coarsePointerQuery.addEventListener('change', this.updateAvailability);
    this.compactViewportQuery.addEventListener('change', this.updateAvailability);
    window.addEventListener('blur', () => this.reset());
  }

  getMoveAxis(): Axis2 {
    return { ...this.moveAxis };
  }

  consumeLookDelta(): Axis2 {
    const delta = { ...this.lookDelta };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return delta;
  }

  consumeFireQueued(): boolean {
    const queued = this.fireQueued;
    this.fireQueued = false;
    return queued;
  }

  isFiring(): boolean {
    return this.firing;
  }

  isFrontHeld(): boolean {
    return this.frontHeld;
  }

  reset(): void {
    this.moveAxis.x = 0;
    this.moveAxis.y = 0;
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    this.fireQueued = false;
    this.firing = false;
    this.frontHeld = false;
    this.joystickPointerId = null;
    this.lookPointerId = null;
    this.firePointerId = null;
    this.frontPointerId = null;
    this.joystickKnob.style.transform = 'translate(-50%, -50%)';
  }

  private bindPointerStarts(): void {
    this.joystickBase.addEventListener('pointerdown', (event) => {
      if (!this.acceptsPointer(event) || this.joystickPointerId !== null) {
        return;
      }

      this.preventDefault(event);
      this.joystickPointerId = event.pointerId;
      this.capturePointer(this.joystickBase, event.pointerId);
      this.updateJoystick(event.clientX, event.clientY);
    });

    this.lookArea.addEventListener('pointerdown', (event) => {
      if (!this.acceptsPointer(event) || this.lookPointerId !== null) {
        return;
      }

      this.preventDefault(event);
      this.lookPointerId = event.pointerId;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
      this.capturePointer(this.lookArea, event.pointerId);
    });

    this.fireButton.addEventListener('pointerdown', (event) => {
      if (!this.acceptsPointer(event) || this.firePointerId !== null) {
        return;
      }

      this.preventDefault(event);
      this.firePointerId = event.pointerId;
      this.firing = true;
      this.fireQueued = true;
      this.capturePointer(this.fireButton, event.pointerId);
    });

    this.frontButton.addEventListener('pointerdown', (event) => {
      if (!this.acceptsPointer(event) || this.frontPointerId !== null) {
        return;
      }

      this.preventDefault(event);
      this.frontPointerId = event.pointerId;
      this.frontHeld = true;
      this.capturePointer(this.frontButton, event.pointerId);
    });

    this.joystickBase.addEventListener('lostpointercapture', this.onPointerEnd);
    this.lookArea.addEventListener('lostpointercapture', this.onPointerEnd);
    this.fireButton.addEventListener('lostpointercapture', this.onPointerEnd);
    this.frontButton.addEventListener('lostpointercapture', this.onPointerEnd);
  }

  private bindPointerTracking(): void {
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerEnd);
    window.addEventListener('pointercancel', this.onPointerEnd);
  }

  private bindTouchFallback(): void {
    const options = { passive: false };

    this.joystickBase.addEventListener('touchstart', (event) => {
      const touch = this.getFirstTouch(event.changedTouches);

      if (!this.enabled || this.joystickPointerId !== null || !touch) {
        return;
      }

      this.preventDefault(event);
      this.joystickPointerId = touch.identifier;
      this.updateJoystick(touch.clientX, touch.clientY);
    }, options);

    this.lookArea.addEventListener('touchstart', (event) => {
      const touch = this.getFirstTouch(event.changedTouches);

      if (!this.enabled || this.lookPointerId !== null || !touch) {
        return;
      }

      this.preventDefault(event);
      this.lookPointerId = touch.identifier;
      this.lastLookX = touch.clientX;
      this.lastLookY = touch.clientY;
    }, options);

    this.fireButton.addEventListener('touchstart', (event) => {
      const touch = this.getFirstTouch(event.changedTouches);

      if (!this.enabled || this.firePointerId !== null || !touch) {
        return;
      }

      this.preventDefault(event);
      this.firePointerId = touch.identifier;
      this.firing = true;
      this.fireQueued = true;
    }, options);

    this.frontButton.addEventListener('touchstart', (event) => {
      const touch = this.getFirstTouch(event.changedTouches);

      if (!this.enabled || this.frontPointerId !== null || !touch) {
        return;
      }

      this.preventDefault(event);
      this.frontPointerId = touch.identifier;
      this.frontHeld = true;
    }, options);

    window.addEventListener('touchmove', this.onTouchMove, options);
    window.addEventListener('touchend', this.onTouchEnd, options);
    window.addEventListener('touchcancel', this.onTouchEnd, options);
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.acceptsPointer(event)) {
      return;
    }

    let handled = false;

    if (event.pointerId === this.joystickPointerId) {
      this.updateJoystick(event.clientX, event.clientY);
      handled = true;
    }

    if (event.pointerId === this.lookPointerId) {
      this.updateLook(event.clientX, event.clientY);
      handled = true;
    }

    if (handled) {
      this.preventDefault(event);
    }
  };

  private onPointerEnd = (event: PointerEvent): void => {
    if (this.useTouchEvents && event.pointerType === 'touch') {
      return;
    }

    if (this.releasePointer(event.pointerId)) {
      this.preventDefault(event);
    }
  };

  private onTouchMove = (event: TouchEvent): void => {
    let handled = false;
    const joystickTouch = this.findTouch(event.touches, this.joystickPointerId);
    const lookTouch = this.findTouch(event.touches, this.lookPointerId);

    if (joystickTouch) {
      this.updateJoystick(joystickTouch.clientX, joystickTouch.clientY);
      handled = true;
    }

    if (lookTouch) {
      this.updateLook(lookTouch.clientX, lookTouch.clientY);
      handled = true;
    }

    if (handled) {
      this.preventDefault(event);
    }
  };

  private onTouchEnd = (event: TouchEvent): void => {
    let handled = false;

    for (let index = 0; index < event.changedTouches.length; index += 1) {
      const touch = event.changedTouches.item(index);

      if (touch) {
        handled = this.releasePointer(touch.identifier) || handled;
      }
    }

    if (handled) {
      this.preventDefault(event);
    }
  };

  private updateJoystick(clientX: number, clientY: number): void {
    const rect = this.joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxRadius = rect.width * 0.42;
    const rawX = clientX - centerX;
    const rawY = clientY - centerY;
    const distance = Math.hypot(rawX, rawY);
    const scale = distance > maxRadius ? maxRadius / distance : 1;
    const x = rawX * scale;
    const y = rawY * scale;
    const normalizedMagnitude = Math.min(1, Math.hypot(x, y) / maxRadius);

    if (normalizedMagnitude <= JOYSTICK_DEAD_ZONE) {
      this.moveAxis.x = 0;
      this.moveAxis.y = 0;
    } else {
      const response = (normalizedMagnitude - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE);
      const directionScale = response / normalizedMagnitude;
      this.moveAxis.x = (x / maxRadius) * directionScale;
      this.moveAxis.y = (-y / maxRadius) * directionScale;
    }

    this.joystickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }

  private updateLook(clientX: number, clientY: number): void {
    this.lookDelta.x += (clientX - this.lastLookX) * MOBILE_LOOK_MULTIPLIER;
    this.lookDelta.y += (clientY - this.lastLookY) * MOBILE_LOOK_MULTIPLIER;
    this.lastLookX = clientX;
    this.lastLookY = clientY;
  }

  private releasePointer(pointerId: number): boolean {
    let handled = false;

    if (pointerId === this.joystickPointerId) {
      this.joystickPointerId = null;
      this.moveAxis.x = 0;
      this.moveAxis.y = 0;
      this.joystickKnob.style.transform = 'translate(-50%, -50%)';
      handled = true;
    }

    if (pointerId === this.lookPointerId) {
      this.lookPointerId = null;
      handled = true;
    }

    if (pointerId === this.firePointerId) {
      this.firePointerId = null;
      this.firing = false;
      handled = true;
    }

    if (pointerId === this.frontPointerId) {
      this.frontPointerId = null;
      this.frontHeld = false;
      handled = true;
    }

    return handled;
  }

  private acceptsPointer(event: PointerEvent): boolean {
    return this.enabled && event.pointerType !== 'mouse' && !(this.useTouchEvents && event.pointerType === 'touch');
  }

  private capturePointer(element: HTMLElement, pointerId: number): void {
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Some mobile browsers do not expose pointer capture for touch input.
    }
  }

  private getFirstTouch(touches: TouchList): Touch | null {
    return touches.item(0);
  }

  private findTouch(touches: TouchList, identifier: number | null): Touch | null {
    if (identifier === null) {
      return null;
    }

    for (let index = 0; index < touches.length; index += 1) {
      const touch = touches.item(index);

      if (touch?.identifier === identifier) {
        return touch;
      }
    }

    return null;
  }

  private preventDefault(event: Event): void {
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  private updateAvailability = (): void => {
    const userAgent = navigator.userAgent;
    const mobileUserAgent = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(userAgent);
    this.enabled =
      mobileUserAgent || this.coarsePointerQuery.matches || this.compactViewportQuery.matches;
    this.root.classList.toggle('mobile-active', this.enabled);
    this.root.setAttribute('aria-hidden', String(!this.enabled));

    if (!this.enabled) {
      this.reset();
    }
  };
}
