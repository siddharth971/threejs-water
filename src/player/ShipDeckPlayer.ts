import { ShipAudio } from './ShipAudio';
import { ShipProps } from './ShipProps';
import { InteractiveShipObjects, InteractiveObject } from './InteractiveShipObjects';

export class ShipDeckPlayer {
    private _scene: BABYLON.Scene;
    public engine: BABYLON.Engine;
    private _canvas: HTMLCanvasElement;
    private _shipRoot: BABYLON.TransformNode;
    private _camera: BABYLON.FreeCamera;

    // Hierarchy
    private _playerNode: BABYLON.TransformNode;
    private _pitchNode: BABYLON.TransformNode;

    // Components
    public audio: ShipAudio;
    public props: ShipProps;
    public interactiveObjects: InteractiveShipObjects;

    // Movement state (Ship local coordinates)
    private _localPos: BABYLON.Vector3;
    private _yaw = 0; // Face forward towards bow (-Z) initially
    private _pitch = 0;
    private _eyeHeight = 1.62;
    private _walkSpeed = 3.4;
    private _moveVelocity = new BABYLON.Vector3(0, 0, 0);

    // Jump physics
    private _verticalVelocity = 0;
    private _isGrounded = true;
    private readonly _gravity = -14.0;
    private readonly _jumpForce = 4.6;

    // Head bob
    private _bobTimer = 0;
    private _footstepTimer = 0;

    // Input tracking
    private _keys: { [key: string]: boolean } = {};
    private _isPointerLocked = false;
    private _isFirstPerson = true;

    // Free camera backup state
    private _spectatorPos = new BABYLON.Vector3(-17.3, 5, -9);
    private _spectatorRot = new BABYLON.Vector3(0.214, 1.597, 0);

    // HTML UI Elements
    private _promptContainer: HTMLElement | null = null;
    private _promptKey: HTMLElement | null = null;
    private _promptText: HTMLElement | null = null;
    private _promptSub: HTMLElement | null = null;
    private _crosshair: HTMLElement | null = null;
    private _toastContainer: HTMLElement | null = null;
    private _spyglassOverlay: HTMLElement | null = null;
    private _embarkOverlay: HTMLElement | null = null;

    constructor(
        scene: BABYLON.Scene,
        engine: BABYLON.Engine,
        canvas: HTMLCanvasElement,
        shipRoot: BABYLON.TransformNode,
        camera: BABYLON.FreeCamera
    ) {
        this._scene = scene;
        this.engine = engine;
        this._canvas = canvas;
        this._shipRoot = shipRoot;
        this._camera = camera;

        // Initialize Audio and Props
        this.audio = new ShipAudio();
        this.props = new ShipProps(scene, shipRoot);
        this.interactiveObjects = new InteractiveShipObjects(scene, shipRoot, this.audio, this.props);

        // Spawn player on main deck facing forward towards the bow
        // Local deck coords: x=0, z=0.5, y=main deck height
        this._localPos = new BABYLON.Vector3(0, this._getDeckHeight(0, 0.5) + this._eyeHeight, 0.5);

        // Create player hierarchy parented to shipRoot
        this._playerNode = new BABYLON.TransformNode("playerDeckRig", scene);
        this._playerNode.parent = shipRoot;

        this._pitchNode = new BABYLON.TransformNode("playerPitchRig", scene);
        this._pitchNode.parent = this._playerNode;

        // Create first person cutlass model attached to camera
        this.props.createFirstPersonCutlass(this._camera);

        // Attach camera to pitch node
        this._setupCamera();

        // Build HUD UI
        this._buildUI();

        // Register Inputs
        this._registerEventListeners();

        // Update loop
        this._scene.onBeforeRenderObservable.add(() => {
            this.update();
        });
    }

    private _setupCamera(): void {
        // Detach default FreeCamera inputs so our custom FPS controller has full control
        this._camera.inputs.clear();

        // Reparent camera to pitch node
        this._camera.parent = this._pitchNode;
        this._camera.position.set(0, 0, 0);
        this._camera.rotation.set(0, 0, 0);
        this._camera.minZ = 0.05;
        this._camera.fov = 1.05; // ~60 deg vertical, ~90 deg horizontal
    }

    private _getDeckHeight(_x: number, z: number): number {
        // Quarterdeck at stern (Z >= 2.6)
        if (z >= 2.6) {
            return 2.45;
        }
        // Stairs ramp transition between Z=1.8 and Z=2.6
        if (z > 1.8 && z < 2.6) {
            const t = (z - 1.8) / (2.6 - 1.8);
            return BABYLON.Scalar.Lerp(1.55, 2.45, t);
        }
        // Forecastle ramp at bow (Z <= -3.6)
        if (z <= -3.6) {
            const t = Math.min(1, (-3.6 - z) / 0.8);
            return BABYLON.Scalar.Lerp(1.55, 1.95, t);
        }
        // Main deck default
        return 1.55;
    }

    private _clampToDeckBounds(pos: BABYLON.Vector3): void {
        // Z limits from bow (-4.4) to stern quarterdeck (+5.6)
        pos.z = BABYLON.Scalar.Clamp(pos.z, -4.3, 5.6);

        let maxX = 1.55;
        // Narrowing at bow
        if (pos.z < -3.2) {
            const factor = (pos.z - (-4.3)) / (-3.2 - (-4.3)); // 0 at -4.3, 1 at -3.2
            maxX = BABYLON.Scalar.Lerp(0.75, 1.50, factor);
        } else if (pos.z > 2.0) {
            // Quarterdeck width
            maxX = 1.45;
            if (pos.z > 5.0) {
                maxX = 1.25;
            }
        }

        pos.x = BABYLON.Scalar.Clamp(pos.x, -maxX, maxX);
    }

    private _registerEventListeners(): void {
        window.addEventListener("keydown", (e) => {
            const key = e.key.toLowerCase();
            this._keys[key] = true;

            // Audio init on user gesture
            this.audio.init();

            // Interact with nearest object
            if (key === "f") {
                this._onInteract();
            }

            // Space: Jump
            if (key === " " && this._isGrounded && this._isFirstPerson && !this.interactiveObjects.isAtHelm) {
                this._verticalVelocity = this._jumpForce;
                this._isGrounded = false;
                this.audio.playFootstep();
            }

            // C: Toggle between First Person on Deck and Free Spectator Camera
            if (key === "c") {
                this.toggleCameraMode();
            }
        });

        window.addEventListener("keyup", (e) => {
            const key = e.key.toLowerCase();
            this._keys[key] = false;
        });

        // Mouse look with Pointer Lock
        this._canvas.addEventListener("click", () => {
            this.audio.init();
            if (!this._isPointerLocked) {
                this._canvas.requestPointerLock();
            }
        });

        document.addEventListener("pointerlockchange", () => {
            this._isPointerLocked = document.pointerLockElement === this._canvas;
            if (this._embarkOverlay) {
                this._embarkOverlay.style.opacity = this._isPointerLocked ? "0" : "1";
                this._embarkOverlay.style.pointerEvents = this._isPointerLocked ? "none" : "auto";
            }
        });

        window.addEventListener("mousemove", (e) => {
            if (!this._isPointerLocked || !this._isFirstPerson) return;

            const sensitivity = 0.0022;
            this._yaw -= e.movementX * sensitivity;
            this._pitch -= e.movementY * sensitivity;

            // Clamp pitch to avoid neck snapping (-85 deg to +85 deg)
            const maxPitch = Math.PI * 0.46;
            this._pitch = BABYLON.Scalar.Clamp(this._pitch, -maxPitch, maxPitch);
        });

        // Left Click: Attack / Swing Cutlass
        window.addEventListener("mousedown", (e) => {
            if (e.button === 0 && this._isPointerLocked && this._isFirstPerson) {
                if (this.props.isCutlassEquipped) {
                    this.audio.playCutlassSwing();
                    this.props.swingCutlass();
                }
            }
        });
    }

    private _onInteract(): void {
        const nearest = this.interactiveObjects.nearestObject;
        if (nearest) {
            nearest.interact(this.audio, this.props, this);
        }
    }

    public toggleCameraMode(): void {
        this._isFirstPerson = !this._isFirstPerson;

        if (this._isFirstPerson) {
            // Save spectator position before returning to deck
            this._spectatorPos.copyFrom(this._camera.position);
            this._spectatorRot.copyFrom(this._camera.rotation);

            // Restore First Person parented to ship
            this._camera.parent = this._pitchNode;
            this._camera.position.set(0, 0, 0);
            this._camera.rotation.set(0, 0, 0);
            if (this._crosshair) this._crosshair.style.display = "block";
            this.showToast("🚢 First-Person Deck View Active. Walk with WASD, look with mouse.", "DECK CAMERA");
        } else {
            // Unparent camera to allow free spectator flight
            this._camera.parent = null;
            this._camera.position.copyFrom(this._spectatorPos);
            this._camera.rotation.copyFrom(this._spectatorRot);
            if (this._crosshair) this._crosshair.style.display = "none";
            this.showToast("👁️ Spectator Orbit Camera Active. Press [C] to return to Ship Deck.", "SPECTATOR CAMERA");
        }
    }

    public toggleSpyglass(enable: boolean): void {
        if (!this._spyglassOverlay) return;
        this._spyglassOverlay.style.opacity = enable ? "1" : "0";
        this._camera.fov = enable ? 0.35 : 1.05; // 3x optical zoom
    }

    public showToast(text: string, title = "SHIP ACTION"): void {
        if (!this._toastContainer) return;

        const toast = document.createElement("div");
        toast.className = "ship-toast";
        toast.innerHTML = `
            <div class="toast-title">${title}</div>
            <div class="toast-desc">${text}</div>
        `;

        this._toastContainer.appendChild(toast);
        setTimeout(() => {
            toast.classList.add("toast-fade-out");
            setTimeout(() => toast.remove(), 400);
        }, 3200);
    }

    public update(): void {
        if (!this._isFirstPerson) return;

        const dt = 0.016;

        // If at the Helm, A/D steers the ship wheel and rudder instead of normal strafing!
        if (this.interactiveObjects.isAtHelm) {
            let steerDir = 0;
            if (this._keys["a"]) steerDir += 1;
            if (this._keys["d"]) steerDir -= 1;

            if (steerDir !== 0) {
                this.props.rotateHelm(steerDir * dt * 2.5);
                this.audio.playHelmCreak();

                // Rotate the entire ship in the water!
                const shipRot = this._shipRoot.rotationQuaternion!;
                const turnQuat = BABYLON.Quaternion.FromEulerAngles(0, steerDir * dt * 0.45, 0);
                shipRot.multiplyToRef(turnQuat, shipRot);
            }
        } else {
            // Standard FPS Deck Movement
            let moveForward = 0;
            let moveRight = 0;

            if (this._keys["w"] || this._keys["arrowup"]) moveForward += 1;
            if (this._keys["s"] || this._keys["arrowdown"]) moveForward -= 1;
            if (this._keys["a"] || this._keys["arrowleft"]) moveRight -= 1;
            if (this._keys["d"] || this._keys["arrowright"]) moveRight += 1;

            const isMoving = moveForward !== 0 || moveRight !== 0;

            if (isMoving) {
                // Vector in player's local yaw direction (Right-Handed System: Look is -Z, Right is +X)
                const forward = new BABYLON.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
                const right = new BABYLON.Vector3(Math.cos(this._yaw), 0, -Math.sin(this._yaw));

                const moveDir = forward.scale(moveForward).add(right.scale(moveRight)).normalize();
                this._moveVelocity.copyFrom(moveDir.scale(this._walkSpeed));

                // Footstep sounds
                this._footstepTimer += dt;
                if (this._footstepTimer > 0.45 && this._isGrounded) {
                    this.audio.playFootstep();
                    this._footstepTimer = 0;
                }

                // Head bobbing
                this._bobTimer += dt * 11;
            } else {
                this._moveVelocity.set(0, 0, 0);
                this._bobTimer = 0;
                this._footstepTimer = 0.4;
            }

            // Apply horizontal motion
            this._localPos.x += this._moveVelocity.x * dt;
            this._localPos.z += this._moveVelocity.z * dt;

            // Clamp inside ship railings and bulkheads
            this._clampToDeckBounds(this._localPos);

            // Vertical / Jump Physics
            const targetDeckHeight = this._getDeckHeight(this._localPos.x, this._localPos.z);
            const targetEyeY = targetDeckHeight + this._eyeHeight;

            if (!this._isGrounded) {
                this._verticalVelocity += this._gravity * dt;
                this._localPos.y += this._verticalVelocity * dt;

                if (this._localPos.y <= targetEyeY) {
                    this._localPos.y = targetEyeY;
                    this._verticalVelocity = 0;
                    this._isGrounded = true;
                    this.audio.playFootstep();
                }
            } else {
                // Smooth step interpolation for stairs
                this._localPos.y = BABYLON.Scalar.Lerp(this._localPos.y, targetEyeY, 0.25);
            }
        }

        // Apply Head Bobbing
        const bobOffset = Math.sin(this._bobTimer) * 0.035;

        // Update player node transform relative to shipRoot
        this._playerNode.position.set(this._localPos.x, this._localPos.y + bobOffset, this._localPos.z);
        this._playerNode.rotation.set(0, this._yaw, 0);

        // Update pitch node
        this._pitchNode.rotation.set(this._pitch, 0, 0);

        // Calculate facing direction for interaction dot product
        const forwardLocal = new BABYLON.Vector3(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));

        // Update Proximity to Interactive Objects
        const nearest = this.interactiveObjects.updateProximity(this._localPos, forwardLocal);
        this._updatePromptHUD(nearest);
    }

    private _updatePromptHUD(obj: InteractiveObject | null): void {
        if (!this._promptContainer || !this._promptKey || !this._promptText || !this._promptSub) return;

        if (obj) {
            this._promptContainer.style.opacity = "1";
            this._promptContainer.style.transform = "translate(-50%, -50%) scale(1)";
            this._promptText.textContent = obj.actionPrompt;
            this._promptSub.textContent = obj.subtitle;
        } else {
            this._promptContainer.style.opacity = "0";
            this._promptContainer.style.transform = "translate(-50%, -50%) scale(0.92)";
        }
    }

    private _buildUI(): void {
        // 1. Crosshair
        const crosshair = document.createElement("div");
        crosshair.id = "ship-crosshair";
        crosshair.innerHTML = `
            <div class="ch-dot"></div>
            <div class="ch-ring"></div>
        `;
        document.body.appendChild(crosshair);
        this._crosshair = crosshair;

        // 2. Interactive Prompt Card (Center-Bottom)
        const prompt = document.createElement("div");
        prompt.id = "ship-prompt-card";
        prompt.innerHTML = `
            <div class="prompt-badge">
                <span class="prompt-key">F</span>
            </div>
            <div class="prompt-info">
                <div class="prompt-action" id="prompt-action-text">Interact</div>
                <div class="prompt-subtitle" id="prompt-sub-text">Press F to interact</div>
            </div>
        `;
        document.body.appendChild(prompt);
        this._promptContainer = prompt;
        this._promptKey = prompt.querySelector(".prompt-key");
        this._promptText = prompt.querySelector("#prompt-action-text");
        this._promptSub = prompt.querySelector("#prompt-sub-text");

        // 3. Spyglass Vignette Overlay
        const spyglass = document.createElement("div");
        spyglass.id = "spyglass-overlay";
        document.body.appendChild(spyglass);
        this._spyglassOverlay = spyglass;

        // 4. Toast Notification Container
        const toastBox = document.createElement("div");
        toastBox.id = "ship-toast-box";
        document.body.appendChild(toastBox);
        this._toastContainer = toastBox;

        // 5. Initial Click to Embark Banner
        const embark = document.createElement("div");
        embark.id = "embark-overlay";
        embark.innerHTML = `
            <div class="embark-card">
                <div class="embark-badge">⚓ PIRATE ADVENTURE</div>
                <h2 class="embark-title">EMBARK ON THE SHIP</h2>
                <p class="embark-desc">Step aboard the pirate deck, explore the vessel, and take command of the helm, cannons, and sails.</p>
                <div class="embark-keys">
                    <span class="key-pill"><strong>WASD</strong> Walk</span>
                    <span class="key-pill"><strong>Mouse</strong> Look</span>
                    <span class="key-pill"><strong>Space</strong> Jump</span>
                    <span class="key-pill"><strong>F</strong> Interact</span>
                    <span class="key-pill"><strong>C</strong> Camera</span>
                </div>
                <button class="embark-btn">ENTER SHIP DECK</button>
            </div>
        `;
        document.body.appendChild(embark);
        this._embarkOverlay = embark;

        embark.querySelector(".embark-btn")?.addEventListener("click", () => {
            this.audio.init();
            this._canvas.requestPointerLock();
        });

        // 6. Deck Status Compass Bar at Bottom Left
        const deckBar = document.createElement("div");
        deckBar.id = "deck-nav-bar";
        deckBar.innerHTML = `
            <div class="nav-item"><span class="nav-key">[WASD]</span> Walk Deck</div>
            <div class="nav-item"><span class="nav-key">[F]</span> Interact</div>
            <div class="nav-item"><span class="nav-key">[Space]</span> Jump</div>
            <div class="nav-item"><span class="nav-key">[C]</span> Switch Camera</div>
        `;
        document.body.appendChild(deckBar);
    }
}
