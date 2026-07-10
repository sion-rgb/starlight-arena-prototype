export interface Axis2 {
  x: number;
  y: number;
}

export class MobileControls {
  private readonly root = document.createElement('div');
  private readonly joystickBase = document.createElement('div');
  private readonly joystickKnob = document.createElement('div');
  private readonly lookArea = document.createElement('div');
  private readonly fireButton = document.createElement('button');
  private readonly frontButton = document.createElement('button');
  private readonly moveAxis: Axis2 = { x: 0, y: 0 };
  private readonly lookDelta: Axis2 = { x: 0, y: 0 };
  private joystickPointerId: number | null = null;
  private lookPointerId: number | null = null;
  private firePointerId: number | null = null;
  private frontPointerId: number | null = null;
  private fireQueued = false;
  private firing = false;
  private frontHeld = false;
  private lastLookX = 0;
  private lastLookY = 0;
  private readonly coarsePointerQuery = window.matchMedia('(pointer: coarse)');
  private readonly compactViewportQuery = window.matchMedia('(max-width: 760px)');
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

    this.bindJoystick();
    this.bindLookArea();
    this.bindFireButton();
    this.bindFrontButton();
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
    this.firePointerId = null;
    this.frontPointerId = null;
    this.joystickPointerId = null;
    this.lookPointerId = null;
    this.joystickKnob.style.transform = 'translate(-50%, -50%)';
  }

  private bindJoystick(): void {
    this.joystickBase.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'mouse') {
        return;
      }

      event.preventDefault();
      this.joystickPointerId = event.pointerId;
      this.joystickBase.setPointerCapture(event.pointerId);
      this.updateJoystick(event.clientX, event.clientY);
    });

    this.joystickBase.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.joystickPointerId) {
        return;
      }

      event.preventDefault();
      this.updateJoystick(event.clientX, event.clientY);
    });

    const endJoystick = (event: PointerEvent) => {
      if (event.pointerId !== this.joystickPointerId) {
        return;
      }

      this.joystickPointerId = null;
      this.moveAxis.x = 0;
      this.moveAxis.y = 0;
      this.joystickKnob.style.transform = 'translate(-50%, -50%)';
    };

    this.joystickBase.addEventListener('pointerup', endJoystick);
    this.joystickBase.addEventListener('pointercancel', endJoystick);
  }

  private bindLookArea(): void {
    this.lookArea.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'mouse') {
        return;
      }

      event.preventDefault();
      this.lookPointerId = event.pointerId;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
      this.lookArea.setPointerCapture(event.pointerId);
    });

    this.lookArea.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.lookPointerId) {
        return;
      }

      event.preventDefault();
      this.lookDelta.x += event.clientX - this.lastLookX;
      this.lookDelta.y += event.clientY - this.lastLookY;
      this.lastLookX = event.clientX;
      this.lastLookY = event.clientY;
    });

    const endLook = (event: PointerEvent) => {
      if (event.pointerId === this.lookPointerId) {
        this.lookPointerId = null;
      }
    };

    this.lookArea.addEventListener('pointerup', endLook);
    this.lookArea.addEventListener('pointercancel', endLook);
  }

  private bindFireButton(): void {
    this.fireButton.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'mouse') {
        return;
      }

      event.preventDefault();
      this.firePointerId = event.pointerId;
      this.firing = true;
      this.fireQueued = true;
      this.fireButton.setPointerCapture(event.pointerId);
    });

    const endFire = (event: PointerEvent) => {
      if (event.pointerId !== this.firePointerId) {
        return;
      }

      this.firePointerId = null;
      this.firing = false;
    };

    this.fireButton.addEventListener('pointerup', endFire);
    this.fireButton.addEventListener('pointercancel', endFire);
  }

  private bindFrontButton(): void {
    this.frontButton.addEventListener('pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'mouse') {
        return;
      }

      event.preventDefault();
      this.frontPointerId = event.pointerId;
      this.frontHeld = true;
      this.frontButton.setPointerCapture(event.pointerId);
    });

    const endFront = (event: PointerEvent) => {
      if (event.pointerId !== this.frontPointerId) {
        return;
      }

      this.frontPointerId = null;
      this.frontHeld = false;
    };

    this.frontButton.addEventListener('pointerup', endFront);
    this.frontButton.addEventListener('pointercancel', endFront);
  }

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

    this.moveAxis.x = x / maxRadius;
    this.moveAxis.y = -y / maxRadius;
    this.joystickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
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
