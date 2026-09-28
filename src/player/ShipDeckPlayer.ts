import { ShipAudio } from './ShipAudio';
import { ShipProps } from './ShipProps';
import { InteractiveShipObjects, InteractiveObject } from './InteractiveShipObjects';
import { Buoyancy } from '../ocean/Buoyancy';

export enum PlayerGameplayState {
    Walking = 'walking',
    Helm = 'helm',
    CannonAim = 'cannon_aim',
    SailAdjust = 'sail_adjust',
    Repairing = 'repairing',
    Spyglass = 'spyglass'
}

export class ShipDeckPlayer {
    private _scene: BABYLON.Scene;
    public engine: BABYLON.Engine;
    private _canvas: HTMLCanvasElement;
    private _shipRoot: BABYLON.TransformNode;
    private _camera: BABYLON.FreeCamera;
    private _buoyancy: Buoyancy | null = null;

    // Hierarchy
    private _playerNode: BABYLON.TransformNode;
    private _pitchNode: BABYLON.TransformNode;

    // Components
    public audio: ShipAudio;
    public props: ShipProps;
    public interactiveObjects: InteractiveShipObjects;

    // Gameplay State Machine
    public gameplayState: PlayerGameplayState = PlayerGameplayState.Walking;

    // Movement state (Ship local coordinates)
    private _localPos: BABYLON.Vector3;
    private _savedWalkPos = new BABYLON.Vector3(0, 1.55 + 1.62, 0.5);
    private _targetYaw = 0; // Face forward towards bow (-Z) initially
    private _currentYaw = 0;
    private _targetPitch = 0;
    private _currentPitch = 0;
    private _mouseDeltaX = 0;
    private _mouseDeltaY = 0;

    private _eyeHeight = 1.62;
    private _walkSpeed = 3.5;
    private _currentVelocity = new BABYLON.Vector3(0, 0, 0);

    // Jump physics
    private _verticalVelocity = 0;
    private _isGrounded = true;
    private readonly _gravity = -14.0;
    private readonly _jumpForce = 4.6;

    // Smooth head bob
    private _bobTimer = 0;
    private _bobWeight = 0;
    private _footstepTimer = 0;

    // Input tracking
    private _keys: { [key: string]: boolean } = {};
    private _isPointerLocked = false;
    private _isFirstPerson = true;

    // Free camera backup state
    private _spectatorPos = new BABYLON.Vector3(-17.3, 5, -9);
    private _spectatorRot = new BABYLON.Vector3(0.214, 1.597, 0);

    // --- Helm State Properties ---
    public rudderAngle = 0; // -32 deg to +32 deg
    public shipThrottle = 6.0; // Knots (-2 to +14)
    public currentShipSpeed = 6.0;

    // --- Cannon Aim State Properties ---
    public isStarboardCannon = true;
    public cannonElevation = 4.0; // deg (-6 to +20)
    public cannonTraverse = 0.0; // deg (-25 to +25)
    public cannonReloadTimer = 0; // cooldown seconds
    private _cannonRecoilTime = 0;

    // --- Sail Adjust State Properties ---
    public sailTrimPercent = 85;

    // --- HTML UI Elements ---
    private _cardContainer: HTMLElement | null = null;
    private _cardTitle: HTMLElement | null = null;
    private _cardAction: HTMLElement | null = null;
    private _cardSub: HTMLElement | null = null;

    private _crosshair: HTMLElement | null = null;
    private _toastContainer: HTMLElement | null = null;
    private _spyglassOverlay: HTMLElement | null = null;

    // Dedicated State HUDs
    private _helmHUD: HTMLElement | null = null;
    private _cannonHUD: HTMLElement | null = null;
    private _sailHUD: HTMLElement | null = null;
    private _repairHUD: HTMLElement | null = null;
    private _deckNavBar: HTMLElement | null = null;

    constructor(
        scene: BABYLON.Scene,
        engine: BABYLON.Engine,
        canvas: HTMLCanvasElement,
        shipRoot: BABYLON.TransformNode,
        camera: BABYLON.FreeCamera,
        buoyancy?: Buoyancy
    ) {
        this._scene = scene;
        this.engine = engine;
        this._canvas = canvas;
        this._shipRoot = shipRoot;
        this._camera = camera;
        if (buoyancy) this._buoyancy = buoyancy;

        // Initialize Audio and Props
        this.audio = new ShipAudio();
        this.props = new ShipProps(scene, shipRoot);
        this.interactiveObjects = new InteractiveShipObjects(scene, shipRoot, this.audio, this.props);

        // Spawn player on main deck facing forward towards the bow
        this._localPos = new BABYLON.Vector3(0, this._getDeckHeight(0, 0.5) + this._eyeHeight, 0.5);
        this._savedWalkPos.copyFrom(this._localPos);

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
        this._camera.inputs.clear();
        this._camera.parent = this._pitchNode;
        this._camera.position.set(0, 0, 0);
        this._camera.rotation.set(0, 0, 0);
        this._camera.minZ = 0.05;
        this._camera.fov = 1.05;
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
        pos.z = BABYLON.Scalar.Clamp(pos.z, -4.3, 6.35);

        let maxX = 1.55;
        if (pos.z < -3.2) {
            const factor = (pos.z - (-4.3)) / (-3.2 - (-4.3));
            maxX = BABYLON.Scalar.Lerp(0.75, 1.50, factor);
        } else if (pos.z > 2.0) {
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

            this.audio.init();

            // F Key: Interact or Exit current gameplay state
            if (key === "f") {
                this._handleInteractKey();
            }

            // ESC Key: Exit current interactive state back to walking
            if (key === "escape") {
                if (this.gameplayState !== PlayerGameplayState.Walking) {
                    this.exitToWalkingState();
                }
            }

            // Space: Jump (when walking) or action trigger (fire cannon, hammer nail)
            if (key === " ") {
                if (this.gameplayState === PlayerGameplayState.Walking) {
                    if (this._isGrounded && this._isFirstPerson) {
                        this._verticalVelocity = this._jumpForce;
                        this._isGrounded = false;
                        this.audio.playFootstep();
                    }
                } else if (this.gameplayState === PlayerGameplayState.CannonAim) {
                    this.fireActiveCannon();
                } else if (this.gameplayState === PlayerGameplayState.Repairing) {
                    this.hammerRepair();
                }
            }

            // C: Toggle between First Person on Deck and Free Spectator Camera
            if (key === "c" && this.gameplayState === PlayerGameplayState.Walking) {
                this.toggleCameraMode();
            }
        });

        window.addEventListener("keyup", (e) => {
            const key = e.key.toLowerCase();
            this._keys[key] = false;
        });

        this._canvas.addEventListener("click", () => {
            this.audio.init();
            if (!this._isPointerLocked) {
                this._canvas.requestPointerLock();
            }
        });

        document.addEventListener("pointerlockchange", () => {
            this._isPointerLocked = document.pointerLockElement === this._canvas;
        });

        window.addEventListener("mousemove", (e) => {
            if (!this._isPointerLocked || !this._isFirstPerson) return;
            this._mouseDeltaX += e.movementX;
            this._mouseDeltaY += e.movementY;
        });

        // Left Click: State actions or Cutlass swing
        window.addEventListener("mousedown", (e) => {
            if (e.button === 0 && this._isPointerLocked && this._isFirstPerson) {
                if (this.gameplayState === PlayerGameplayState.CannonAim) {
                    this.fireActiveCannon();
                } else if (this.gameplayState === PlayerGameplayState.Repairing) {
                    this.hammerRepair();
                } else if (this.gameplayState === PlayerGameplayState.Walking) {
                    if (this.props.isCutlassEquipped) {
                        this.audio.playCutlassSwing();
                        this.props.swingCutlass();
                    }
                }
            }
        });
    }

    private _handleInteractKey(): void {
        // If currently in a dedicated gameplay state, pressing F exits back to walking
        if (this.gameplayState !== PlayerGameplayState.Walking) {
            this.exitToWalkingState();
            return;
        }

        // Otherwise interact with nearest object in range
        const nearest = this.interactiveObjects.nearestObject;
        if (nearest) {
            nearest.interact(this.audio, this.props, this);
        }
    }

    // =========================================================================
    // GAMEPLAY STATE MACHINE: HELM
    // =========================================================================

    public enterHelmState(): void {
        this.gameplayState = PlayerGameplayState.Helm;
        this._savedWalkPos.copyFrom(this._localPos);

        // Position captain at the default steering wheel station on the stern poop deck
        // Wheel is at original model position (X = 0, Y = 2.90, Z = 6.03), Captain stands at X = 0, Z = 6.08 overlooking the ship
        this._localPos.set(0, 2.45 + this._eyeHeight, 6.08);
        this._targetYaw = 0; // Facing forward towards bow (-Z) overlooking the entire pirate vessel
        this._currentYaw = 0;
        this._targetPitch = -0.10; // Looking over the wheel down across the ship deck and waves
        this._currentPitch = -0.10;
        this._currentVelocity.set(0, 0, 0);

        this.interactiveObjects.clearHighlight();
        this.interactiveObjects.isAtHelm = true;
        this.audio.playHelmCreak();

        if (this._crosshair) this._crosshair.style.display = "none";
        if (this._helmHUD) this._helmHUD.style.display = "flex";
        if (this._deckNavBar) this._deckNavBar.style.display = "none";

        this.showToast("⚓ Helm Station active! Steer rudder with [A] / [D], adjust speed with [W] / [S]. Press [F] to release.", "CONTROL SHIP");
    }

    public exitHelmState(): void {
        this.gameplayState = PlayerGameplayState.Walking;
        this.interactiveObjects.isAtHelm = false;
        // Step back slightly from the wheel onto the poop deck
        this._localPos.set(0, 2.45 + this._eyeHeight, 5.75);

        if (this._crosshair) this._crosshair.style.display = "block";
        if (this._helmHUD) this._helmHUD.style.display = "none";
        if (this._deckNavBar) this._deckNavBar.style.display = "flex";

        this.showToast("Released the helm. Free walking active.", "HELM RELEASED");
    }

    // =========================================================================
    // GAMEPLAY STATE MACHINE: CANNON AIM & FIRE
    // =========================================================================

    public enterCannonState(isStarboard: boolean): void {
        this.gameplayState = PlayerGameplayState.CannonAim;
        this.isStarboardCannon = isStarboard;
        this._savedWalkPos.copyFrom(this._localPos);

        // Lock camera behind gun carriage sighting through gunport
        if (isStarboard) {
            this._localPos.set(0.65, 1.55 + 1.25, 0.5);
            this._targetYaw = -Math.PI / 2; // Face starboard (+X)
            this._currentYaw = -Math.PI / 2;
        } else {
            this._localPos.set(-0.65, 1.55 + 1.25, 0.5);
            this._targetYaw = Math.PI / 2; // Face port (-X)
            this._currentYaw = Math.PI / 2;
        }

        this.cannonElevation = 4.0;
        this.cannonTraverse = 0.0;
        this._targetPitch = (this.cannonElevation * Math.PI) / 180;
        this._currentPitch = this._targetPitch;
        this._currentVelocity.set(0, 0, 0);

        this.interactiveObjects.clearHighlight();

        if (this._crosshair) this._crosshair.style.display = "block";
        if (this._cannonHUD) this._cannonHUD.style.display = "flex";
        if (this._deckNavBar) this._deckNavBar.style.display = "none";

        const sideName = isStarboard ? "Starboard" : "Port";
        this.showToast(`🎯 Sighting ${sideName} broadside cannon! Aim with Mouse or WASD. Click or Space to FIRE!`, "AIM CANNON");
    }

    public fireActiveCannon(): void {
        if (this.cannonReloadTimer > 0) {
            return;
        }

        this.audio.playCannonBlast();
        // Fire along the camera's sightline ray directly through the aiming reticle
        const forwardRay = this._camera.getForwardRay();
        this.props.fireCannon(this.isStarboardCannon, forwardRay.direction);

        // Recoil shake
        this._cannonRecoilTime = 0.35;
        this.cannonReloadTimer = 2.4;

        this.showToast("💥 BOOM! Heavy broadside round shot unleashed into the waves!", "BROADSIDE FIRED");
    }

    public exitCannonState(): void {
        this.gameplayState = PlayerGameplayState.Walking;

        // Step back onto deck
        const returnX = this.isStarboardCannon ? 0.35 : -0.35;
        this._localPos.set(returnX, 1.55 + this._eyeHeight, 0.5);
        this._targetPitch = 0;

        if (this._crosshair) this._crosshair.style.display = "block";
        if (this._cannonHUD) this._cannonHUD.style.display = "none";
        if (this._deckNavBar) this._deckNavBar.style.display = "flex";

        this.showToast("Stepped back from the cannon. Free walking active.", "CANNON RELEASED");
    }

    // =========================================================================
    // GAMEPLAY STATE MACHINE: ADJUST SAIL
    // =========================================================================

    public enterSailState(): void {
        this.gameplayState = PlayerGameplayState.SailAdjust;
        this._savedWalkPos.copyFrom(this._localPos);

        // Stand on the starboard deck beside the halyard rigging, looking up and across at the grand billowing canvas sails
        this._localPos.set(0.85, 1.55 + this._eyeHeight, 0.20);
        this._targetYaw = 2.75; // Turn around toward the main mast & sails (~158 deg)
        this._currentYaw = 2.75;
        this._targetPitch = 0.48; // Look up ~28 deg directly at the full canvas
        this._currentPitch = 0.48;
        this._currentVelocity.set(0, 0, 0);

        this.interactiveObjects.clearHighlight();
        this.audio.playSailFlutter();

        if (this._crosshair) this._crosshair.style.display = "none";
        if (this._sailHUD) this._sailHUD.style.display = "flex";
        if (this._deckNavBar) this._deckNavBar.style.display = "none";

        this.showToast("⛵ Rigging Station active! Use [W] to Hoist/Billow Canvas, [S] to Reef for heavy seas.", "ADJUST SAIL");
    }

    public exitSailState(): void {
        this.gameplayState = PlayerGameplayState.Walking;
        this._localPos.set(0.70, 1.55 + this._eyeHeight, 0.20);
        this._targetPitch = 0;

        if (this._crosshair) this._crosshair.style.display = "block";
        if (this._sailHUD) this._sailHUD.style.display = "none";
        if (this._deckNavBar) this._deckNavBar.style.display = "flex";

        this.showToast("Sail rigging secured. Free walking active.", "SAIL SECURED");
    }

    // =========================================================================
    // GAMEPLAY STATE MACHINE: REPAIR HULL
    // =========================================================================

    public enterRepairState(): void {
        this.gameplayState = PlayerGameplayState.Repairing;
        this._savedWalkPos.copyFrom(this._localPos);

        // Stand beside damaged plank looking down
        this._localPos.set(-1.15, 1.55 + this._eyeHeight, -1.2);
        this._targetYaw = Math.PI * 0.15;
        this._currentYaw = this._targetYaw;
        this._targetPitch = -0.72; // Look down at deck planks
        this._currentPitch = -0.72;
        this._currentVelocity.set(0, 0, 0);

        this.interactiveObjects.clearHighlight();

        if (this._crosshair) this._crosshair.style.display = "none";
        if (this._repairHUD) this._repairHUD.style.display = "flex";
        if (this._deckNavBar) this._deckNavBar.style.display = "none";

        this.showToast("🔨 Damaged oak planking! Left-Click or Space to hammer iron nails & reinforce hull.", "REPAIR HULL");
    }

    public hammerRepair(): void {
        this.audio.playHammer();
        const res = this.props.hammerRepairPlank();

        // Small camera impact jolt
        this._targetPitch -= 0.05;

        const pct = Math.round(res.progress * 100);
        if (res.isFinished) {
            this.showToast("🏆 Hull integrity restored to 100%! Oak timber fully caulked and seaworthy.", "HULL REPAIRED");
        } else {
            this.showToast(`🔨 Thwack! Nail driven deeper. Hull integrity: ${pct}%`, "REPAIRING HULL");
        }
    }

    public exitRepairState(): void {
        this.gameplayState = PlayerGameplayState.Walking;
        this._localPos.set(-0.95, 1.55 + this._eyeHeight, -1.2);
        this._targetPitch = 0;

        if (this._crosshair) this._crosshair.style.display = "block";
        if (this._repairHUD) this._repairHUD.style.display = "none";
        if (this._deckNavBar) this._deckNavBar.style.display = "flex";

        this.showToast("Plank inspection concluded. Free walking active.", "REPAIR FINISHED");
    }

    // =========================================================================
    // GAMEPLAY STATE MACHINE: SPYGLASS
    // =========================================================================

    public enterSpyglassState(): void {
        this.gameplayState = PlayerGameplayState.Spyglass;
        this.interactiveObjects.isUsingSpyglass = true;
        this.audio.startAmbientSea();

        if (this._spyglassOverlay) this._spyglassOverlay.style.opacity = "1";
        this._camera.fov = 0.32; // 3.5x optical zoom

        this.showToast("🔭 Raised brass Spyglass! Scanning horizon swell for distant ships. Press [F] to lower.", "LOOKOUT SPYGLASS");
    }

    public exitSpyglassState(): void {
        this.gameplayState = PlayerGameplayState.Walking;
        this.interactiveObjects.isUsingSpyglass = false;

        if (this._spyglassOverlay) this._spyglassOverlay.style.opacity = "0";
        this._camera.fov = 1.05;

        this.showToast("Lowered spyglass.", "LOOKOUT");
    }

    /**
     * Unified exit from any interactive state back to free walking
     */
    public exitToWalkingState(): void {
        switch (this.gameplayState) {
            case PlayerGameplayState.Helm:
                this.exitHelmState();
                break;
            case PlayerGameplayState.CannonAim:
                this.exitCannonState();
                break;
            case PlayerGameplayState.SailAdjust:
                this.exitSailState();
                break;
            case PlayerGameplayState.Repairing:
                this.exitRepairState();
                break;
            case PlayerGameplayState.Spyglass:
                this.exitSpyglassState();
                break;
            default:
                break;
        }
    }

    public toggleCameraMode(): void {
        this._isFirstPerson = !this._isFirstPerson;

        if (this._isFirstPerson) {
            this._spectatorPos.copyFrom(this._camera.position);
            this._spectatorRot.copyFrom(this._camera.rotation);

            this._targetYaw = this._currentYaw;
            this._targetPitch = this._currentPitch;
            this._mouseDeltaX = 0;
            this._mouseDeltaY = 0;
            this._currentVelocity.set(0, 0, 0);

            this._camera.parent = this._pitchNode;
            this._camera.position.set(0, 0, 0);
            this._camera.rotation.set(0, 0, 0);
            if (this._crosshair) this._crosshair.style.display = "block";
            this.showToast("🚢 First-Person Deck View Active. Walk with WASD, look with mouse.", "DECK CAMERA");
        } else {
            this._camera.parent = null;
            this._camera.position.copyFrom(this._spectatorPos);
            this._camera.rotation.copyFrom(this._spectatorRot);
            if (this._crosshair) this._crosshair.style.display = "none";
            this.showToast("👁️ Spectator Orbit Camera Active. Press [C] to return to Ship Deck.", "SPECTATOR CAMERA");
        }
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

    // =========================================================================
    // MAIN UPDATE LOOP
    // =========================================================================

    public update(): void {
        if (!this._isFirstPerson) return;

        const dt = Math.min(0.04, this.engine.getDeltaTime() / 1000 || 0.016);

        // Update active reload timer for cannon
        if (this.cannonReloadTimer > 0) {
            this.cannonReloadTimer = Math.max(0, this.cannonReloadTimer - dt);
        }

        // Branch update based on gameplay state
        switch (this.gameplayState) {
            case PlayerGameplayState.Walking:
                this._updateWalkingState(dt);
                break;
            case PlayerGameplayState.Helm:
                this._updateHelmState(dt);
                break;
            case PlayerGameplayState.CannonAim:
                this._updateCannonAimState(dt);
                break;
            case PlayerGameplayState.SailAdjust:
                this._updateSailAdjustState(dt);
                break;
            case PlayerGameplayState.Repairing:
                this._updateRepairingState(dt);
                break;
            case PlayerGameplayState.Spyglass:
                this._updateSpyglassState(dt);
                break;
        }

        // Update player node transforms relative to shipRoot
        this._playerNode.position.set(this._localPos.x, this._localPos.y, this._localPos.z);
        this._playerNode.rotation.set(0, this._currentYaw, 0);
        this._pitchNode.rotation.set(this._currentPitch, 0, 0);
    }

    private _updateWalkingState(dt: number): void {
        // Process mouse look with responsive exponential smoothing
        const sensitivity = 0.0020;
        this._targetYaw -= this._mouseDeltaX * sensitivity;
        this._targetPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        const maxPitch = Math.PI * 0.46;
        this._targetPitch = BABYLON.Scalar.Clamp(this._targetPitch, -maxPitch, maxPitch);

        const mouseLerp = 1.0 - Math.exp(-28.0 * dt);
        this._currentYaw += (this._targetYaw - this._currentYaw) * mouseLerp;
        this._currentPitch += (this._targetPitch - this._currentPitch) * mouseLerp;

        // Standard FPS Deck Movement
        let moveForward = 0;
        let moveRight = 0;

        if (this._keys["w"] || this._keys["arrowup"]) moveForward += 1;
        if (this._keys["s"] || this._keys["arrowdown"]) moveForward -= 1;
        if (this._keys["a"] || this._keys["arrowleft"]) moveRight -= 1;
        if (this._keys["d"] || this._keys["arrowright"]) moveRight += 1;

        const isMoving = moveForward !== 0 || moveRight !== 0;

        const forward = new BABYLON.Vector3(-Math.sin(this._currentYaw), 0, -Math.cos(this._currentYaw));
        const right = new BABYLON.Vector3(Math.cos(this._currentYaw), 0, -Math.sin(this._currentYaw));

        let targetVelocity = BABYLON.Vector3.Zero();
        if (isMoving) {
            const moveDir = forward.scale(moveForward).add(right.scale(moveRight)).normalize();
            targetVelocity = moveDir.scale(this._walkSpeed);

            this._footstepTimer += dt;
            if (this._footstepTimer > 0.45 && this._isGrounded) {
                this.audio.playFootstep();
                this._footstepTimer = 0;
            }

            this._bobTimer += dt * 10;
        } else {
            this._footstepTimer = 0.4;
        }

        const accelRate = isMoving ? 14.0 : 18.0;
        const moveLerp = 1.0 - Math.exp(-accelRate * dt);
        BABYLON.Vector3.LerpToRef(this._currentVelocity, targetVelocity, moveLerp, this._currentVelocity);

        this._localPos.x += this._currentVelocity.x * dt;
        this._localPos.z += this._currentVelocity.z * dt;

        this._clampToDeckBounds(this._localPos);

        const targetBobWeight = isMoving ? 1.0 : 0.0;
        this._bobWeight = BABYLON.Scalar.Lerp(this._bobWeight, targetBobWeight, 1.0 - Math.exp(-8.0 * dt));

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
            const stepLerp = 1.0 - Math.exp(-16.0 * dt);
            this._localPos.y = BABYLON.Scalar.Lerp(this._localPos.y, targetEyeY, stepLerp);
        }

        const bobOffset = Math.sin(this._bobTimer) * 0.030 * this._bobWeight;
        this._localPos.y += bobOffset;

        // Proximity detection for Interactive Objects
        const forwardLocal = new BABYLON.Vector3(-Math.sin(this._currentYaw), 0, -Math.cos(this._currentYaw));
        const nearest = this.interactiveObjects.updateProximity(this._localPos, forwardLocal);
        this._updatePromptCardUI(nearest);
    }

    private _updateHelmState(dt: number): void {
        this._updatePromptCardUI(null);

        // Free mouse look while captaining the ship (no more fixed staring!)
        const sensitivity = 0.0020;
        this._targetYaw -= this._mouseDeltaX * sensitivity;
        this._targetPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        // Clamp view so captain stays facing forward with generous freedom (±80 deg yaw, ±40 deg pitch)
        const maxTurn = (80.0 * Math.PI) / 180;
        const minPitch = (-38.0 * Math.PI) / 180;
        const maxPitch = (45.0 * Math.PI) / 180;
        this._targetYaw = BABYLON.Scalar.Clamp(this._targetYaw, -maxTurn, maxTurn);
        this._targetPitch = BABYLON.Scalar.Clamp(this._targetPitch, minPitch, maxPitch);

        const mouseLerp = 1.0 - Math.exp(-24.0 * dt);
        this._currentYaw += (this._targetYaw - this._currentYaw) * mouseLerp;
        this._currentPitch += (this._targetPitch - this._currentPitch) * mouseLerp;

        // A / D steers the rudder and turns the wheel:
        // [A] = Port (left), [D] = Starboard (right)
        let steerInput = 0;
        if (this._keys["a"] || this._keys["arrowleft"]) steerInput = -1; // Port (left)
        if (this._keys["d"] || this._keys["arrowright"]) steerInput = 1;  // Starboard (right)

        // Smooth rudder angle response: -30 (Port) to +30 (Starboard)
        const targetRudder = steerInput * 30; // degrees
        this.rudderAngle += (targetRudder - this.rudderAngle) * (1.0 - Math.exp(-6.0 * dt));

        if (steerInput !== 0) {
            // Turn wheel: left for Port, right for Starboard
            this.props.rotateHelm(-steerInput * dt * 2.8);
            this.audio.playHelmCreak();

            // Rotate ship hull in the ocean water via buoyancy
            const turnRate = 0.38; // rad/s
            if (this._buoyancy) {
                this._buoyancy.rotateMeshYaw(this._shipRoot, -steerInput * turnRate * dt);
            }
        }

        // W / S adjusts ship throttle speed
        if (this._keys["w"] || this._keys["arrowup"]) {
            this.shipThrottle = Math.min(14.0, this.shipThrottle + dt * 4.5);
        }
        if (this._keys["s"] || this._keys["arrowdown"]) {
            this.shipThrottle = Math.max(-2.0, this.shipThrottle - dt * 4.5);
        }

        // Smooth ship speed inertia
        this.currentShipSpeed += (this.shipThrottle - this.currentShipSpeed) * (1.0 - Math.exp(-2.5 * dt));

        // Physically glide the pirate ship through the ocean waves
        // In Babylon RHS, bow is along local -Z
        const forwardLocal = new BABYLON.Vector3(0, 0, -1);
        const forwardWorld = BABYLON.Vector3.TransformNormal(forwardLocal, this._shipRoot.getWorldMatrix()).normalize();
        this._shipRoot.position.addInPlace(forwardWorld.scale(this.currentShipSpeed * dt));

        // Calculate heading in compass degrees
        const headingDeg = Math.round(((Math.atan2(forwardWorld.x, -forwardWorld.z) * 180) / Math.PI + 360) % 360);

        // Update Helm HUD elements
        this._updateHelmHUD(headingDeg);
    }

    private _updateCannonAimState(dt: number): void {
        this._updatePromptCardUI(null);

        // Natural FPS Mouse look controls:
        // Moving mouse UP -> tilts aim UP
        // Moving mouse DOWN -> tilts aim DOWN
        // Moving mouse LEFT -> traverses aim LEFT
        // Moving mouse RIGHT -> traverses aim RIGHT
        const mouseSensitivity = 0.0020;
        const baseBroadsideYaw = this.isStarboardCannon ? -Math.PI / 2 : Math.PI / 2;

        this._targetYaw -= this._mouseDeltaX * mouseSensitivity;
        this._targetPitch -= this._mouseDeltaY * mouseSensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        // Keys also adjust aim smoothly:
        // W = pitch up, S = pitch down
        if (this._keys["w"] || this._keys["arrowup"]) this._targetPitch += dt * 0.45;
        if (this._keys["s"] || this._keys["arrowdown"]) this._targetPitch -= dt * 0.45;

        // A = traverse left, D = traverse right (relative to camera facing out the gunport)
        if (this._keys["a"] || this._keys["arrowleft"]) this._targetYaw += dt * 0.55;
        if (this._keys["d"] || this._keys["arrowright"]) this._targetYaw -= dt * 0.55;

        // Clamp elevation: -8 deg (down towards sea) to +26 deg (up towards rigging/sky)
        const minPitch = (-8.0 * Math.PI) / 180;
        const maxPitch = (26.0 * Math.PI) / 180;
        this._targetPitch = BABYLON.Scalar.Clamp(this._targetPitch, minPitch, maxPitch);

        // Clamp traverse: ±28 deg from gunport center
        const maxTraverse = (28.0 * Math.PI) / 180;
        this._targetYaw = BABYLON.Scalar.Clamp(this._targetYaw, baseBroadsideYaw - maxTraverse, baseBroadsideYaw + maxTraverse);

        // Exponential smoothing for buttery smooth aiming
        const aimLerp = 1.0 - Math.exp(-24.0 * dt);
        this._currentYaw += (this._targetYaw - this._currentYaw) * aimLerp;

        // Handle firing recoil kick
        let recoilPitch = 0;
        if (this._cannonRecoilTime > 0) {
            this._cannonRecoilTime -= dt;
            recoilPitch = Math.sin((this._cannonRecoilTime / 0.35) * Math.PI) * 0.08;
        }
        this._currentPitch += (this._targetPitch + recoilPitch - this._currentPitch) * aimLerp;

        // Calculate elevation & traverse in degrees for HUD display
        this.cannonElevation = (this._targetPitch * 180) / Math.PI;
        const rawTraverseRad = this._targetYaw - baseBroadsideYaw;
        this.cannonTraverse = (rawTraverseRad * 180) / Math.PI * (this.isStarboardCannon ? -1 : 1);

        this._updateCannonHUD();
    }

    private _updateSailAdjustState(dt: number): void {
        this._updatePromptCardUI(null);

        // Free mouse look while adjusting rigging (freely inspect sails, mast, rigging, ocean)
        const sensitivity = 0.0020;
        this._targetYaw -= this._mouseDeltaX * sensitivity;
        this._targetPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        // Generous vertical pitch range: from -25 deg (deck) to +72 deg (high masthead & crows nest)
        const minPitch = (-25.0 * Math.PI) / 180;
        const maxPitch = (72.0 * Math.PI) / 180;
        this._targetPitch = BABYLON.Scalar.Clamp(this._targetPitch, minPitch, maxPitch);

        const mouseLerp = 1.0 - Math.exp(-24.0 * dt);
        this._currentYaw += (this._targetYaw - this._currentYaw) * mouseLerp;
        this._currentPitch += (this._targetPitch - this._currentPitch) * mouseLerp;

        // W hoists / trims canvas, S reefs / furls canvas
        if (this._keys["w"] || this._keys["arrowup"]) {
            this.sailTrimPercent = Math.min(100, this.sailTrimPercent + dt * 25);
            this.props.setSailTrim(this.sailTrimPercent / 100);
            this.audio.playSailFlutter();
        }
        if (this._keys["s"] || this._keys["arrowdown"]) {
            this.sailTrimPercent = Math.max(25, this.sailTrimPercent - dt * 25);
            this.props.setSailTrim(this.sailTrimPercent / 100);
        }

        this._updateSailHUD();
    }

    private _updateRepairingState(_dt: number): void {
        this._updatePromptCardUI(null);
        this._updateRepairHUD();
    }

    private _updateSpyglassState(dt: number): void {
        this._updatePromptCardUI(null);

        // Smooth telescope look with optical dampening
        const sensitivity = 0.0009;
        this._targetYaw -= this._mouseDeltaX * sensitivity;
        this._targetPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        const maxPitch = Math.PI * 0.40;
        this._targetPitch = BABYLON.Scalar.Clamp(this._targetPitch, -maxPitch, maxPitch);

        const mouseLerp = 1.0 - Math.exp(-22.0 * dt);
        this._currentYaw += (this._targetYaw - this._currentYaw) * mouseLerp;
        this._currentPitch += (this._targetPitch - this._currentPitch) * mouseLerp;
    }

    // =========================================================================
    // HUD & PROMPT CARD UI RENDERING
    // =========================================================================

    private _updatePromptCardUI(obj: InteractiveObject | null): void {
        if (!this._cardContainer || !this._cardTitle || !this._cardAction || !this._cardSub) return;

        if (obj && this.gameplayState === PlayerGameplayState.Walking) {
            this._cardTitle.textContent = obj.cardTitle;
            this._cardAction.textContent = obj.actionPrompt;
            this._cardSub.textContent = obj.subtitle;

            this._cardContainer.style.opacity = "1";
            this._cardContainer.style.transform = "translate(-50%, -50%) scale(1)";
            this._cardContainer.style.pointerEvents = "auto";
        } else {
            this._cardContainer.style.opacity = "0";
            this._cardContainer.style.transform = "translate(-50%, -50%) scale(0.92)";
            this._cardContainer.style.pointerEvents = "none";
        }
    }

    private _updateHelmHUD(headingDeg: number): void {
        if (!this._helmHUD) return;

        const compassEl = this._helmHUD.querySelector("#helm-heading-text");
        if (compassEl) {
            const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
            const dirIdx = Math.round(headingDeg / 22.5) % 16;
            compassEl.textContent = `${String(headingDeg).padStart(3, '0')}° ${dirs[dirIdx]} • AHEAD`;
        }

        const rudderEl = this._helmHUD.querySelector("#helm-rudder-text");
        if (rudderEl) {
            const side = this.rudderAngle < -1 ? "PORT" : this.rudderAngle > 1 ? "STARBOARD" : "MIDSHIPS";
            const deg = Math.abs(Math.round(this.rudderAngle));
            rudderEl.textContent = side === "MIDSHIPS" ? "0° MIDSHIPS" : `${deg}° ${side}`;
        }

        const needleEl = this._helmHUD.querySelector("#helm-rudder-needle") as HTMLElement;
        if (needleEl) {
            // Rudder angle is -30 (Port / Left) to +30 (Starboard / Right)
            // Left is PORT [A] (~8%), Right is [D] STBD (~92%), Center is 50%
            const pct = 50 + (this.rudderAngle / 30) * 42;
            needleEl.style.left = `${pct}%`;
        }

        const speedEl = this._helmHUD.querySelector("#helm-speed-text");
        if (speedEl) {
            speedEl.textContent = `${this.currentShipSpeed.toFixed(1)} KTS`;
        }
    }

    private _updateCannonHUD(): void {
        if (!this._cannonHUD) return;

        const elevEl = this._cannonHUD.querySelector("#cannon-elev-text");
        if (elevEl) {
            const sign = this.cannonElevation >= 0 ? "+" : "";
            elevEl.textContent = `${sign}${this.cannonElevation.toFixed(1)}°`;
        }

        const travEl = this._cannonHUD.querySelector("#cannon-trav-text");
        if (travEl) {
            const sign = this.cannonTraverse >= 0 ? "+" : "";
            travEl.textContent = `${sign}${this.cannonTraverse.toFixed(1)}°`;
        }

        const statusEl = this._cannonHUD.querySelector("#cannon-status-text");
        const barEl = this._cannonHUD.querySelector("#cannon-reload-bar") as HTMLElement;

        if (statusEl && barEl) {
            if (this.cannonReloadTimer <= 0) {
                statusEl.textContent = "READY TO FIRE";
                statusEl.className = "cannon-status ready";
                barEl.style.width = "100%";
            } else {
                statusEl.textContent = `RELOADING... [${this.cannonReloadTimer.toFixed(1)}s]`;
                statusEl.className = "cannon-status reloading";
                const p = 1.0 - this.cannonReloadTimer / 2.4;
                barEl.style.width = `${Math.round(p * 100)}%`;
            }
        }
    }

    private _updateSailHUD(): void {
        if (!this._sailHUD) return;

        const trimEl = this._sailHUD.querySelector("#sail-trim-text");
        const barEl = this._sailHUD.querySelector("#sail-trim-fill") as HTMLElement;
        if (trimEl && barEl) {
            const roundPct = Math.round(this.sailTrimPercent);
            trimEl.textContent = `${roundPct}% HOISTED`;
            barEl.style.width = `${roundPct}%`;
        }
    }

    private _updateRepairHUD(): void {
        if (!this._repairHUD) return;

        const intEl = this._repairHUD.querySelector("#repair-pct-text");
        const barEl = this._repairHUD.querySelector("#repair-bar-fill") as HTMLElement;
        if (intEl && barEl) {
            const pct = Math.round(this.props.repairProgress * 100);
            intEl.textContent = `${pct}% INTEGRITY`;
            barEl.style.width = `${pct}%`;
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

        // 2. Exact Card Box matching user's ASCII diagram:
        // ┌──────────────────────┐
        // │       CANNON         │
        // │                      │
        // │      Press F         │
        // │     Use Cannon       │
        // └──────────────────────┘
        const cardBox = document.createElement("div");
        cardBox.id = "ship-interaction-card";
        cardBox.innerHTML = `
            <div class="card-ascii-box">
                <div class="card-corner-tag c-tl">┌</div>
                <div class="card-border-line-top"></div>
                <div class="card-corner-tag c-tr">┐</div>

                <div class="card-body-content">
                    <div class="card-headline-title" id="interact-card-title">CANNON</div>
                    
                    <div class="card-ornament-sep"></div>

                    <div class="card-press-key-row">
                        <span class="card-key-cap">F</span>
                        <span class="card-press-label">Press F</span>
                    </div>

                    <div class="card-action-verb" id="interact-card-action">Use Cannon</div>
                    <div class="card-action-sub" id="interact-card-sub">Aim naval broadside & fire</div>
                </div>

                <div class="card-corner-tag c-bl">└</div>
                <div class="card-border-line-bottom"></div>
                <div class="card-corner-tag c-br">┘</div>
            </div>
        `;
        document.body.appendChild(cardBox);
        this._cardContainer = cardBox;
        this._cardTitle = cardBox.querySelector("#interact-card-title");
        this._cardAction = cardBox.querySelector("#interact-card-action");
        this._cardSub = cardBox.querySelector("#interact-card-sub");

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

        // 6. Bottom Navigation Controls Bar
        const deckBar = document.createElement("div");
        deckBar.id = "deck-nav-bar";
        deckBar.innerHTML = `
            <div class="nav-item"><span class="nav-key">[WASD]</span> Walk Deck</div>
            <div class="nav-item"><span class="nav-key">[F]</span> Interact Station</div>
            <div class="nav-item"><span class="nav-key">[Space]</span> Jump</div>
            <div class="nav-item"><span class="nav-key">[C]</span> Orbit Camera</div>
        `;
        document.body.appendChild(deckBar);
        this._deckNavBar = deckBar;

        // 7. Dedicated HELM HUD
        const helmHUD = document.createElement("div");
        helmHUD.id = "helm-hud";
        helmHUD.innerHTML = `
            <div class="helm-compass-banner">
                <div class="compass-icon">🧭</div>
                <div class="compass-heading" id="helm-heading-text">045° NE • AHEAD</div>
            </div>
            <div class="helm-controls-panel">
                <div class="helm-gauge-row">
                    <span class="gauge-label">RUDDER ANGLE</span>
                    <div class="rudder-track">
                        <div class="rudder-needle" id="helm-rudder-needle"></div>
                        <span class="rudder-marker port">PORT ◄ [A]</span>
                        <span class="rudder-marker stbd">[D] ► STBD</span>
                    </div>
                    <span class="gauge-val" id="helm-rudder-text">0° MIDSHIPS</span>
                </div>
                <div class="helm-gauge-row">
                    <span class="gauge-label">THROTTLE SPEED</span>
                    <span class="gauge-val highlight" id="helm-speed-text">6.0 KTS</span>
                    <span class="gauge-hint">[W] Ahead / [S] Astern</span>
                </div>
                <div class="helm-exit-prompt">
                    <span class="exit-key-cap">F</span>
                    <span>Press [F] or [ESC] to Release Wheel</span>
                </div>
            </div>
        `;
        document.body.appendChild(helmHUD);
        this._helmHUD = helmHUD;

        // 8. Dedicated CANNON AIM HUD
        const cannonHUD = document.createElement("div");
        cannonHUD.id = "cannon-hud";
        cannonHUD.innerHTML = `
            <div class="cannon-reticle">
                <div class="reticle-circle"></div>
                <div class="reticle-cross h"></div>
                <div class="reticle-cross v"></div>
                <div class="reticle-ticks">
                    <span class="tick t1"></span>
                    <span class="tick t2"></span>
                    <span class="tick t3"></span>
                </div>
            </div>
            <div class="cannon-aim-panel">
                <div class="aim-badge">🎯 NAVAL BROADSIDE SIGHTS</div>
                <div class="aim-readouts">
                    <div class="readout-item">
                        <span class="ro-label">ELEVATION</span>
                        <span class="ro-val" id="cannon-elev-text">+4.0°</span>
                    </div>
                    <div class="readout-item">
                        <span class="ro-label">TRAVERSE</span>
                        <span class="ro-val" id="cannon-trav-text">0.0°</span>
                    </div>
                </div>
                <div class="cannon-status-box">
                    <div class="cannon-status ready" id="cannon-status-text">READY TO FIRE</div>
                    <div class="reload-track"><div class="reload-bar" id="cannon-reload-bar" style="width: 100%;"></div></div>
                </div>
                <div class="cannon-hints">
                    <span class="hint-pill"><strong>Mouse / WASD</strong> Aim Cannon</span>
                    <span class="hint-pill fire"><strong>Left-Click / Space</strong> FIRE!</span>
                    <span class="hint-pill exit"><strong>F / ESC</strong> Exit</span>
                </div>
            </div>
        `;
        document.body.appendChild(cannonHUD);
        this._cannonHUD = cannonHUD;

        // 9. Dedicated SAIL HUD
        const sailHUD = document.createElement("div");
        sailHUD.id = "sail-hud";
        sailHUD.innerHTML = `
            <div class="sail-rigging-panel">
                <div class="sail-badge">⛵ MAIN MAST RIGGING</div>
                <div class="sail-trim-row">
                    <span class="sail-label">CANVAS TRIM</span>
                    <div class="sail-track"><div class="sail-fill" id="sail-trim-fill" style="width: 85%;"></div></div>
                    <span class="sail-val" id="sail-trim-text">85% HOISTED</span>
                </div>
                <div class="sail-metrics">
                    <div class="metric-item"><span class="m-lbl">WIND SPEED</span><span class="m-val">18 KTS ENE</span></div>
                    <div class="metric-item"><span class="m-lbl">CATCH EFFICIENCY</span><span class="m-val">94%</span></div>
                </div>
                <div class="sail-hints">
                    <span class="hint-pill"><strong>[W]</strong> Hoist Canvas (Billow)</span>
                    <span class="hint-pill"><strong>[S]</strong> Reef Canvas (Furl)</span>
                    <span class="hint-pill exit"><strong>[F / ESC]</strong> Exit Rigging</span>
                </div>
            </div>
        `;
        document.body.appendChild(sailHUD);
        this._sailHUD = sailHUD;

        // 10. Dedicated REPAIR HUD
        const repairHUD = document.createElement("div");
        repairHUD.id = "repair-hud";
        repairHUD.innerHTML = `
            <div class="repair-deck-panel">
                <div class="repair-badge">🔨 SHIPWRIGHT REPAIR</div>
                <div class="repair-integrity-row">
                    <span class="repair-label">HULL INTEGRITY</span>
                    <div class="repair-track"><div class="repair-fill" id="repair-bar-fill" style="width: 65%;"></div></div>
                    <span class="repair-val" id="repair-pct-text">65% INTEGRITY</span>
                </div>
                <div class="repair-status-text">DAMAGED OAK TIMBER • WATER SEEPAGE DETECTED</div>
                <div class="repair-hints">
                    <span class="hint-pill hammer"><strong>Left-Click / Space</strong> Hammer Nails</span>
                    <span class="hint-pill exit"><strong>[F / ESC]</strong> Exit Repair</span>
                </div>
            </div>
        `;
        document.body.appendChild(repairHUD);
        this._repairHUD = repairHUD;
    }
}
