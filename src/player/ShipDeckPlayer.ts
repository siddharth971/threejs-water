import { ShipAudio } from './ShipAudio';
import { ShipProps } from './ShipProps';
import { InteractiveShipObjects, InteractiveObject } from './InteractiveShipObjects';
import { Buoyancy } from '../ocean/Buoyancy';
import { PirateCharacter, CharacterPose } from './PirateCharacter';

export enum PlayerGameplayState {
    Walking = 'walking',
    Swimming = 'swimming',
    Helm = 'helm',
    CannonAim = 'cannon_aim',
    SailAdjust = 'sail_adjust',
    Repairing = 'repairing',
    Spyglass = 'spyglass'
}

export enum CameraViewMode {
    FirstPerson = 'first_person',
    ThirdPerson = 'third_person',
    FreeFly = 'free_fly'
}

export class ShipDeckPlayer {
    public scene: BABYLON.Scene;
    public engine: BABYLON.Engine;
    private _canvas: HTMLCanvasElement;
    private _shipRoot: BABYLON.TransformNode;
    private _camera: BABYLON.FreeCamera;
    private _buoyancy: Buoyancy | null = null;
    private _onUnderwaterChanged?: (submerged: boolean) => void;

    // Hierarchy
    private _playerNode: BABYLON.TransformNode;
    private _pitchNode: BABYLON.TransformNode;

    // Components
    public audio: ShipAudio;
    public props: ShipProps;
    public interactiveObjects: InteractiveShipObjects;
    public character: PirateCharacter;

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
    private _swimSpeed = 4.4;
    private _currentVelocity = new BABYLON.Vector3(0, 0, 0);

    // Jump & Swimming physics
    private _verticalVelocity = 0;
    private _isGrounded = true;
    private readonly _gravity = -15.0;
    private readonly _jumpForce = 3.2;
    private _hasHitWater = false;
    private _isUnderwater = false;
    private _canBoardShip = false;
    private _swimStrokeTimer = 0;

    // Smooth head bob
    private _bobTimer = 0;
    private _bobWeight = 0;
    private _footstepTimer = 0;

    // Input tracking & camera mode
    private _keys: { [key: string]: boolean } = {};
    private _isPointerLocked = false;
    public cameraViewMode: CameraViewMode = CameraViewMode.FirstPerson;
    private _tpDistance = 3.4;
    private _charSlashTimer = 0;
    private _isDiving = false;

    private get _isFirstPerson(): boolean {
        return this.cameraViewMode === CameraViewMode.FirstPerson;
    }

    private get _isPlayerControlled(): boolean {
        return this.cameraViewMode !== CameraViewMode.FreeFly;
    }

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
    private _underwaterOverlay: HTMLElement | null = null;

    // Dedicated State HUDs
    private _helmHUD: HTMLElement | null = null;
    private _cannonHUD: HTMLElement | null = null;
    private _sailHUD: HTMLElement | null = null;
    private _repairHUD: HTMLElement | null = null;
    private _deckNavBar: HTMLElement | null = null;
    private _swimNavBar: HTMLElement | null = null;

    // Cached HUD Child Elements & Last-Rendered State (avoid per-frame DOM queries/writes)
    private _helmHeadingEl: HTMLElement | null = null;
    private _helmRudderTextEl: HTMLElement | null = null;
    private _helmRudderNeedleEl: HTMLElement | null = null;
    private _helmSpeedEl: HTMLElement | null = null;
    private _cannonElevEl: HTMLElement | null = null;
    private _cannonTravEl: HTMLElement | null = null;
    private _cannonStatusEl: HTMLElement | null = null;
    private _cannonReloadBarEl: HTMLElement | null = null;
    private _sailTrimTextEl: HTMLElement | null = null;
    private _sailTrimFillEl: HTMLElement | null = null;
    private _repairPctTextEl: HTMLElement | null = null;
    private _repairBarFillEl: HTMLElement | null = null;

    private _lastPromptCardId: string | null = "__init__";
    private _lastHelmHeading = "";
    private _lastHelmRudder = "";
    private _lastHelmNeedlePct = "";
    private _lastHelmSpeed = "";
    private _lastCannonElev = "";
    private _lastCannonTrav = "";
    private _lastCannonStatus = "";
    private _lastCannonBarWidth = "";
    private _lastSailTrimText = "";
    private _lastSailBarWidth = "";
    private _lastRepairPctText = "";
    private _lastRepairBarWidth = "";

    // Scratch vectors & audio cooldowns
    private readonly _tmpForward = new BABYLON.Vector3();
    private readonly _tmpRight = new BABYLON.Vector3();
    private readonly _tmpMoveDir = new BABYLON.Vector3();
    private readonly _tmpTargetVel = new BABYLON.Vector3();
    private readonly _tmpWorldPos = new BABYLON.Vector3();
    private readonly _tmpWorldDir = new BABYLON.Vector3();
    private readonly _tmpShipLocal = new BABYLON.Vector3();
    private readonly _tmpInvShipMat = new BABYLON.Matrix();
    private readonly _localForwardConst = new BABYLON.Vector3(0, 0, -1);
    private readonly _localRightConst = new BABYLON.Vector3(1, 0, 0);
    private _helmAudioCooldown = 0;
    private _sailAudioCooldown = 0;

    constructor(
        scene: BABYLON.Scene,
        engine: BABYLON.Engine,
        canvas: HTMLCanvasElement,
        shipRoot: BABYLON.TransformNode,
        camera: BABYLON.FreeCamera,
        buoyancy?: Buoyancy,
        onUnderwaterChanged?: (submerged: boolean) => void
    ) {
        this.scene = scene;
        this.engine = engine;
        this._canvas = canvas;
        this._shipRoot = shipRoot;
        this._camera = camera;
        if (buoyancy) this._buoyancy = buoyancy;
        if (onUnderwaterChanged) this._onUnderwaterChanged = onUnderwaterChanged;

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

        // Articulated 3D Pirate Captain for Third-Person & Free-Fly views
        this.character = new PirateCharacter(scene, this._playerNode);
        this.character.root.position.set(0, -this._eyeHeight, 0);

        // Create first person cutlass model attached to camera
        this.props.createFirstPersonCutlass(this._camera);

        // Attach camera to pitch node
        this._setupCamera();

        // Build HUD UI
        this._buildUI();

        // Register Inputs
        this._registerEventListeners();
    }

    public registerShadowCasters(shadowGenerator: BABYLON.ShadowGenerator): void {
        this.character.registerShadowCasters(shadowGenerator);
    }

    private _syncCameraRigForState(): void {
        if (this.cameraViewMode === CameraViewMode.FreeFly) {
            this.character.setVisible(true);
            return;
        }
        this._camera.parent = this._pitchNode;
        const hideForSight = this.gameplayState === PlayerGameplayState.CannonAim || this.gameplayState === PlayerGameplayState.Spyglass;
        if (this.cameraViewMode === CameraViewMode.ThirdPerson && !hideForSight) {
            this._camera.position.set(0.42, 0.30, this._tpDistance);
            this._camera.rotation.set(-0.08, 0, 0);
            this.character.setVisible(true);
        } else {
            this._camera.position.set(0, 0, 0);
            this._camera.rotation.set(0, 0, 0);
            this.character.setVisible(false);
        }
    }

    private _setupCamera(): void {
        this._camera.inputs.clear();
        this._camera.parent = this._pitchNode;
        this._camera.position.set(0, 0, 0);
        this._camera.rotation.set(0, 0, 0);
        this._camera.minZ = 0.05;
        this._camera.fov = 1.05;
        this._camera.inertia = 0;
        (this._camera as any).angularSensibility = 0;
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

    private _getDeckMaxX(z: number): number {
        let maxX = 1.55;
        if (z < -3.2) {
            const factor = Math.max(0, Math.min(1, (z - (-4.3)) / (-3.2 - (-4.3))));
            maxX = BABYLON.Scalar.Lerp(0.75, 1.50, factor);
        } else if (z > 2.0) {
            maxX = 1.45;
            if (z > 5.0) {
                maxX = 1.25;
            }
        }
        return maxX;
    }

    private _clampToDeckBounds(pos: BABYLON.Vector3): void {
        pos.z = BABYLON.Scalar.Clamp(pos.z, -4.3, 6.35);
        const maxX = this._getDeckMaxX(pos.z);
        pos.x = BABYLON.Scalar.Clamp(pos.x, -maxX, maxX);
    }

    private _registerEventListeners(): void {
        window.addEventListener("keydown", (e) => {
            const key = e.key.toLowerCase();
            this._keys[key] = true;

            this.audio.init();

            // F Key: Interact, Climb Aboard, or Exit current gameplay state
            if (key === "f") {
                this._handleInteractKey();
            }

            // ESC Key: Exit current interactive station back to walking (not swimming)
            if (key === "escape") {
                if (this.gameplayState !== PlayerGameplayState.Walking && this.gameplayState !== PlayerGameplayState.Swimming) {
                    this.exitToWalkingState();
                }
            }

            // Space: Jump (when walking, single press) or action trigger (fire cannon, hammer nail)
            if (key === " ") {
                if (this.gameplayState === PlayerGameplayState.Walking) {
                    if (!e.repeat && this._isGrounded && this._isPlayerControlled) {
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

            // C: Cycle First-Person -> Third-Person -> Free Camera
            if (key === "c" && (this.gameplayState === PlayerGameplayState.Walking || this.gameplayState === PlayerGameplayState.Swimming)) {
                this.toggleCameraMode();
            }
        });

        window.addEventListener("keyup", (e) => {
            const key = e.key.toLowerCase();
            this._keys[key] = false;
        });

        // Mouse Wheel: Adjust Third-Person camera distance
        window.addEventListener("wheel", (e) => {
            if (this.cameraViewMode === CameraViewMode.ThirdPerson && this._isPointerLocked) {
                this._tpDistance = BABYLON.Scalar.Clamp(this._tpDistance + e.deltaY * 0.0025, 2.0, 6.2);
                this._syncCameraRigForState();
            }
        }, { passive: true });

        this._canvas.addEventListener("click", () => {
            this.audio.init();
            if (!this._isPointerLocked) {
                try {
                    const promise = (this._canvas as any).requestPointerLock({ unadjustedMovement: true });
                    if (promise && promise.catch) {
                        promise.catch(() => this._canvas.requestPointerLock());
                    }
                } catch {
                    this._canvas.requestPointerLock();
                }
            }
        });

        document.addEventListener("pointerlockchange", () => {
            this._isPointerLocked = document.pointerLockElement === this._canvas;
        });

        window.addEventListener("mousemove", (e) => {
            if (!this._isPointerLocked) return;
            this._mouseDeltaX += e.movementX;
            this._mouseDeltaY += e.movementY;
        });

        // Left Click: State actions or Cutlass swing
        window.addEventListener("mousedown", (e) => {
            if (e.button === 0 && this._isPointerLocked && this._isPlayerControlled) {
                if (this.gameplayState === PlayerGameplayState.CannonAim) {
                    this.fireActiveCannon();
                } else if (this.gameplayState === PlayerGameplayState.Repairing) {
                    this.hammerRepair();
                } else if (this.gameplayState === PlayerGameplayState.Walking) {
                    if (this.props.isCutlassEquipped) {
                        this.audio.playCutlassSwing();
                        this.props.swingCutlass();
                        this._charSlashTimer = 0.38;
                    }
                }
            }
        });
    }

    private _handleInteractKey(): void {
        // Climb back aboard ship when swimming near hull
        if (this.gameplayState === PlayerGameplayState.Swimming) {
            if (this._canBoardShip) {
                this._climbAboardShip();
            }
            return;
        }

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
        this._syncCameraRigForState();

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
        this._syncCameraRigForState();

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
        this._syncCameraRigForState();

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
        this._syncCameraRigForState();

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
        this._syncCameraRigForState();

        this.showToast("🔭 Raised brass Spyglass! Scanning horizon swell for distant ships. Press [F] to lower.", "LOOKOUT SPYGLASS");
    }

    public exitSpyglassState(): void {
        this.gameplayState = PlayerGameplayState.Walking;
        this.interactiveObjects.isUsingSpyglass = false;

        if (this._spyglassOverlay) this._spyglassOverlay.style.opacity = "0";
        this._camera.fov = 1.05;
        this._syncCameraRigForState();

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
        if (this.cameraViewMode === CameraViewMode.FirstPerson) {
            this.cameraViewMode = CameraViewMode.ThirdPerson;
            this._mouseDeltaX = 0;
            this._mouseDeltaY = 0;
            this._syncCameraRigForState();

            if (this._crosshair) {
                this._crosshair.style.display = this.gameplayState === PlayerGameplayState.Walking ? "block" : "none";
            }
            if (this._swimNavBar) {
                this._swimNavBar.style.display = this.gameplayState === PlayerGameplayState.Swimming ? "flex" : "none";
            }
            if (this._deckNavBar) {
                this._deckNavBar.style.display = this.gameplayState === PlayerGameplayState.Walking ? "flex" : "none";
            }
            this.showToast("🏴‍☠️ Third-Person Captain View! Mouse wheel zooms distance. Press [C] for Free Camera.", "THIRD PERSON");
        } else if (this.cameraViewMode === CameraViewMode.ThirdPerson) {
            this.cameraViewMode = CameraViewMode.FreeFly;
            this._camera.getViewMatrix(true);
            this._spectatorPos.copyFrom(this._camera.globalPosition);
            const worldFwd = BABYLON.Vector3.TransformNormal(this._localForwardConst, this._camera.getWorldMatrix());
            const worldYaw = Math.atan2(-worldFwd.x, -worldFwd.z);
            this._spectatorRot.set(this._currentPitch, worldYaw, 0);

            this._camera.parent = null;
            this._camera.position.copyFrom(this._spectatorPos);
            this._camera.rotation.copyFrom(this._spectatorRot);
            this._mouseDeltaX = 0;
            this._mouseDeltaY = 0;
            this._syncCameraRigForState();

            this._updatePromptCardUI(null);
            if (this._crosshair) this._crosshair.style.display = "none";
            if (this._deckNavBar) this._deckNavBar.style.display = "none";
            if (this._swimNavBar) this._swimNavBar.style.display = "none";
            this.showToast("🕊️ Free-Fly Camera Active! Fly anywhere with WASD + Mouse + Space/E. Press [C] to return.", "FREE CAMERA");
        } else {
            this.cameraViewMode = CameraViewMode.FirstPerson;
            this._spectatorPos.copyFrom(this._camera.position);
            this._spectatorRot.copyFrom(this._camera.rotation);

            this._targetYaw = this._currentYaw;
            this._targetPitch = this._currentPitch;
            this._mouseDeltaX = 0;
            this._mouseDeltaY = 0;
            this._currentVelocity.set(0, 0, 0);
            this._syncCameraRigForState();

            if (this._crosshair) {
                this._crosshair.style.display = this.gameplayState === PlayerGameplayState.Walking ? "block" : "none";
            }
            if (this._swimNavBar) {
                this._swimNavBar.style.display = this.gameplayState === PlayerGameplayState.Swimming ? "flex" : "none";
            }
            if (this._deckNavBar) {
                this._deckNavBar.style.display = this.gameplayState === PlayerGameplayState.Walking ? "flex" : "none";
            }
            this.showToast("🚢 First-Person View Active. Press [C] for Third-Person Captain.", "FIRST PERSON");
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

    private _resolveCharacterPose(): CharacterPose {
        switch (this.gameplayState) {
            case PlayerGameplayState.Walking:
                if (!this._isGrounded) return "jump";
                return Math.hypot(this._currentVelocity.x, this._currentVelocity.z) > 0.35 ? "walk" : "idle";
            case PlayerGameplayState.Swimming:
                if (!this._hasHitWater) return "jump";
                return this._isDiving ? "dive" : "swim";
            case PlayerGameplayState.Helm:
                return "helm";
            case PlayerGameplayState.SailAdjust:
                return "sail";
            case PlayerGameplayState.Repairing:
                return "repair";
            case PlayerGameplayState.CannonAim:
            case PlayerGameplayState.Spyglass:
            default:
                return "idle";
        }
    }

    private _updateCharacterVisuals(dt: number, moveSpeedRatio: number): void {
        this._charSlashTimer = Math.max(0, this._charSlashTimer - dt);

        const targetCharY =
            this.gameplayState === PlayerGameplayState.Swimming && this._hasHitWater ? -1.35 : -this._eyeHeight;
        this.character.root.position.y = BABYLON.Scalar.Lerp(
            this.character.root.position.y,
            targetCharY,
            1.0 - Math.exp(-12.0 * dt)
        );

        const showFirstPersonCutlass =
            this._isFirstPerson &&
            this.props.isCutlassEquipped &&
            this.gameplayState === PlayerGameplayState.Walking;
        if (this.props.cutlassViewMesh && this.props.cutlassViewMesh.isEnabled() !== showFirstPersonCutlass) {
            this.props.cutlassViewMesh.setEnabled(showFirstPersonCutlass);
        }

        const showCharCutlass =
            this.props.isCutlassEquipped && this.gameplayState !== PlayerGameplayState.Swimming;
        this.character.setCutlassEquipped(showCharCutlass);

        const slashDuration = 0.38;
        const isSlashing = this._charSlashTimer > 0;
        const slashProgress = isSlashing ? 1.0 - this._charSlashTimer / slashDuration : 0;

        this.character.update(dt, {
            pose: this._resolveCharacterPose(),
            moveSpeedRatio,
            isSlashing,
            slashProgress,
        });
    }

    public update(): void {
        const dt = Math.min(0.04, this.engine.getDeltaTime() / 1000 || 0.016);

        if (!this._isPlayerControlled) {
            this._updateCharacterVisuals(dt, 0);
            this._updateSpectatorState(dt);
            return;
        }

        // Update active reload timer for cannon
        if (this.cannonReloadTimer > 0) {
            this.cannonReloadTimer = Math.max(0, this.cannonReloadTimer - dt);
        }

        // Branch update based on gameplay state
        switch (this.gameplayState) {
            case PlayerGameplayState.Walking:
                this._updateWalkingState(dt);
                break;
            case PlayerGameplayState.Swimming:
                this._updateSwimmingState(dt);
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

        let moveSpeedRatio = 0;
        if (this.gameplayState === PlayerGameplayState.Walking) {
            moveSpeedRatio = BABYLON.Scalar.Clamp(
                Math.hypot(this._currentVelocity.x, this._currentVelocity.z) / this._walkSpeed,
                0,
                1.2
            );
        } else if (this.gameplayState === PlayerGameplayState.Swimming) {
            moveSpeedRatio = BABYLON.Scalar.Clamp(
                Math.hypot(this._currentVelocity.x, this._currentVelocity.z) / this._swimSpeed,
                0,
                1.5
            );
        }
        this._updateCharacterVisuals(dt, moveSpeedRatio);

        // Update player node transforms (ship-local when aboard, world-space when swimming)
        this._playerNode.position.set(this._localPos.x, this._localPos.y, this._localPos.z);
        this._playerNode.rotation.set(0, this._currentYaw, 0);
        this._pitchNode.rotation.set(this._currentPitch, 0, 0);
        this._playerNode.computeWorldMatrix(true);
        this._pitchNode.computeWorldMatrix(true);
        this._camera.getViewMatrix(true);

        // Centralized camera-depth underwater rendering check (works across 1st-person & 3rd-person)
        const camPos = this._camera.globalPosition;
        const camWaterY = this._buoyancy ? this._buoyancy.getWaterHeight(camPos) : 0;
        this._applyUnderwaterState(camPos.y < camWaterY - 0.05);
    }

    private _updateSpectatorState(dt: number): void {
        const sensitivity = 0.0022;
        this._camera.rotation.y -= this._mouseDeltaX * sensitivity;
        this._camera.rotation.x = BABYLON.Scalar.Clamp(
            this._camera.rotation.x - this._mouseDeltaY * sensitivity,
            -Math.PI * 0.48,
            Math.PI * 0.48
        );
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        const speed = this._keys["shift"] ? 18.0 : 8.0;
        let moveForward = 0;
        let moveRight = 0;
        let moveUp = 0;

        if (this._keys["w"] || this._keys["arrowup"]) moveForward += 1;
        if (this._keys["s"] || this._keys["arrowdown"]) moveForward -= 1;
        if (this._keys["a"] || this._keys["arrowleft"]) moveRight -= 1;
        if (this._keys["d"] || this._keys["arrowright"]) moveRight += 1;
        if (this._keys[" "]) moveUp += 1;
        if (this._keys["e"] || this._keys["control"]) moveUp -= 1;

        this._camera.getViewMatrix(true);
        const camWorld = this._camera.getWorldMatrix();
        BABYLON.Vector3.TransformNormalToRef(this._localForwardConst, camWorld, this._tmpForward);
        BABYLON.Vector3.TransformNormalToRef(this._localRightConst, camWorld, this._tmpRight);
        this._tmpForward.normalize();
        this._tmpRight.normalize();

        if (moveForward !== 0 || moveRight !== 0 || moveUp !== 0) {
            this._tmpMoveDir.set(
                this._tmpForward.x * moveForward + this._tmpRight.x * moveRight,
                this._tmpForward.y * moveForward + this._tmpRight.y * moveRight + moveUp,
                this._tmpForward.z * moveForward + this._tmpRight.z * moveRight
            );
            if (this._tmpMoveDir.lengthSquared() > 1e-6) {
                this._tmpMoveDir.normalize();
                this._camera.position.addInPlaceFromFloats(
                    this._tmpMoveDir.x * speed * dt,
                    this._tmpMoveDir.y * speed * dt,
                    this._tmpMoveDir.z * speed * dt
                );
            }
        }

        const waterY = this._buoyancy ? this._buoyancy.getWaterHeight(this._camera.position) : 0;
        const submerged = this._camera.position.y < waterY - 0.05;
        this._applyUnderwaterState(submerged);
        this._camera.getViewMatrix(true);
    }

    private _applyUnderwaterState(submerged: boolean): void {
        if (submerged === this._isUnderwater) {
            return;
        }
        this._isUnderwater = submerged;
        this.audio.setUnderwater(submerged);
        if (this._underwaterOverlay) {
            this._underwaterOverlay.style.opacity = submerged ? "1" : "0";
        }
        if (submerged) {
            this.scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
            this.scene.fogDensity = 0.085;
            this.scene.fogColor.set(0.02, 0.22, 0.34);
            this.scene.clearColor.set(0.02, 0.22, 0.34, 1.0);
        } else {
            this.scene.fogMode = BABYLON.Scene.FOGMODE_NONE;
            this.scene.fogDensity = 0;
            this.scene.clearColor.set(0.2, 0.2, 0.3, 1.0);
        }
        this._onUnderwaterChanged?.(submerged);
    }

    private _updateWalkingState(dt: number): void {
        // Direct 1:1 responsive mouse look (zero lag, instant precision)
        const sensitivity = 0.0022;
        this._currentYaw -= this._mouseDeltaX * sensitivity;
        this._currentPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        const maxPitch = this.cameraViewMode === CameraViewMode.ThirdPerson ? 0.25 : Math.PI * 0.46;
        const minPitch = this.cameraViewMode === CameraViewMode.ThirdPerson ? -0.65 : -maxPitch;
        this._currentPitch = BABYLON.Scalar.Clamp(this._currentPitch, minPitch, maxPitch);
        this._targetYaw = this._currentYaw;
        this._targetPitch = this._currentPitch;

        // Standard FPS Deck Movement
        let moveForward = 0;
        let moveRight = 0;

        if (this._keys["w"] || this._keys["arrowup"]) moveForward += 1;
        if (this._keys["s"] || this._keys["arrowdown"]) moveForward -= 1;
        if (this._keys["a"] || this._keys["arrowleft"]) moveRight -= 1;
        if (this._keys["d"] || this._keys["arrowright"]) moveRight += 1;

        const isMoving = moveForward !== 0 || moveRight !== 0;

        const sinYaw = Math.sin(this._currentYaw);
        const cosYaw = Math.cos(this._currentYaw);
        this._tmpForward.set(-sinYaw, 0, -cosYaw);
        this._tmpRight.set(cosYaw, 0, -sinYaw);

        this._tmpTargetVel.set(0, 0, 0);
        if (isMoving) {
            this._tmpMoveDir.set(
                this._tmpForward.x * moveForward + this._tmpRight.x * moveRight,
                0,
                this._tmpForward.z * moveForward + this._tmpRight.z * moveRight
            );
            this._tmpMoveDir.normalize();
            this._tmpMoveDir.scaleToRef(this._walkSpeed, this._tmpTargetVel);

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
        BABYLON.Vector3.LerpToRef(this._currentVelocity, this._tmpTargetVel, moveLerp, this._currentVelocity);

        this._localPos.x += this._currentVelocity.x * dt;
        this._localPos.z += this._currentVelocity.z * dt;

        // Allow leaping overboard over the ship rails while airborne (jumping)
        const maxX = this._getDeckMaxX(this._localPos.z);
        const isOutOfBounds = this._localPos.z < -4.3 || this._localPos.z > 6.35 || Math.abs(this._localPos.x) > maxX;
        if (!this._isGrounded && isOutOfBounds) {
            this._enterSwimmingFromDeck();
            return;
        }

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
        const nearest = this.interactiveObjects.updateProximity(this._localPos, this._tmpForward);
        this._updatePromptCardUI(nearest);
    }

    private _enterSwimmingFromDeck(): void {
        const shipWorldMat = this._shipRoot.getWorldMatrix();

        // Convert ship-local eye position & forward look to world coordinates
        BABYLON.Vector3.TransformCoordinatesToRef(this._localPos, shipWorldMat, this._tmpWorldPos);
        BABYLON.Vector3.TransformNormalToRef(this._tmpForward, shipWorldMat, this._tmpWorldDir);
        const worldYaw = Math.atan2(-this._tmpWorldDir.x, -this._tmpWorldDir.z);

        // Convert horizontal velocity into world space and ensure outward clearance from the hull
        BABYLON.Vector3.TransformNormalToRef(this._currentVelocity, shipWorldMat, this._currentVelocity);
        if (Math.hypot(this._currentVelocity.x, this._currentVelocity.z) < 2.2) {
            this._tmpMoveDir.set(this._localPos.x, 0, this._localPos.z - 1.0);
            if (this._tmpMoveDir.lengthSquared() < 1e-4) {
                this._tmpMoveDir.copyFrom(this._tmpForward);
            } else {
                this._tmpMoveDir.normalize();
            }
            BABYLON.Vector3.TransformNormalToRef(this._tmpMoveDir, shipWorldMat, this._tmpMoveDir);
            this._tmpMoveDir.y = 0;
            this._tmpMoveDir.normalize();
            this._currentVelocity.x += this._tmpMoveDir.x * 2.2;
            this._currentVelocity.z += this._tmpMoveDir.z * 2.2;
        }

        this._playerNode.parent = null;
        this._localPos.copyFrom(this._tmpWorldPos);
        this._currentYaw = worldYaw;
        this._targetYaw = worldYaw;

        this.gameplayState = PlayerGameplayState.Swimming;
        this._hasHitWater = false;
        this._isDiving = false;
        this._isUnderwater = false;
        this._canBoardShip = false;
        this._swimStrokeTimer = 0.2;

        this.interactiveObjects.clearHighlight();
        this._updatePromptCardUI(null);
        if (this.props.cutlassViewMesh) {
            this.props.cutlassViewMesh.setEnabled(false);
        }
        if (this._deckNavBar) this._deckNavBar.style.display = "none";
        if (this._swimNavBar) this._swimNavBar.style.display = "flex";

        this.showToast("🌊 Overboard! Swim with [WASD], [Space] Surface, [E/Ctrl] Dive. Swim near hull & press [F] to board.", "IN THE SEA");
    }

    private _updateSwimmingState(dt: number): void {
        const sensitivity = 0.0022;
        this._currentYaw -= this._mouseDeltaX * sensitivity;
        this._currentPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        const maxPitch = Math.PI * 0.47;
        this._currentPitch = BABYLON.Scalar.Clamp(this._currentPitch, -maxPitch, maxPitch);
        this._targetYaw = this._currentYaw;
        this._targetPitch = this._currentPitch;

        const waterY = this._buoyancy ? this._buoyancy.getWaterHeight(this._localPos) : 0;
        const surfaceEyeY = waterY + 0.20;

        if (!this._hasHitWater) {
            this._isDiving = false;
            // Free-fall from ship deck until impacting ocean surface
            this._verticalVelocity += this._gravity * dt;
            this._localPos.x += this._currentVelocity.x * dt;
            this._localPos.z += this._currentVelocity.z * dt;
            this._localPos.y += this._verticalVelocity * dt;

            if (this._localPos.y <= surfaceEyeY) {
                this._hasHitWater = true;
                this._verticalVelocity = Math.max(-1.6, this._verticalVelocity * 0.18);
                this.audio.playWaterSplash();
                this.props.createWaterSplashAt(new BABYLON.Vector3(this._localPos.x, waterY, this._localPos.z), 0.45);
            }
        } else {
            let moveForward = 0;
            let moveRight = 0;
            if (this._keys["w"] || this._keys["arrowup"]) moveForward += 1;
            if (this._keys["s"] || this._keys["arrowdown"]) moveForward -= 1;
            if (this._keys["a"] || this._keys["arrowleft"]) moveRight -= 1;
            if (this._keys["d"] || this._keys["arrowright"]) moveRight += 1;

            const isMoving = moveForward !== 0 || moveRight !== 0;
            const swimSpeed = this._keys["shift"] ? 6.8 : this._swimSpeed;

            const sinYaw = Math.sin(this._currentYaw);
            const cosYaw = Math.cos(this._currentYaw);
            this._tmpForward.set(-sinYaw, 0, -cosYaw);
            this._tmpRight.set(cosYaw, 0, -sinYaw);

            this._tmpTargetVel.set(0, 0, 0);
            if (isMoving) {
                this._tmpMoveDir.set(
                    this._tmpForward.x * moveForward + this._tmpRight.x * moveRight,
                    0,
                    this._tmpForward.z * moveForward + this._tmpRight.z * moveRight
                );
                this._tmpMoveDir.normalize();
                this._tmpMoveDir.scaleToRef(swimSpeed, this._tmpTargetVel);

                this._swimStrokeTimer += dt;
                if (this._swimStrokeTimer >= 0.62) {
                    this.audio.playSwimStroke();
                    this._swimStrokeTimer = 0;
                }
            } else {
                this._swimStrokeTimer = 0.45;
            }

            const dragLerp = 1.0 - Math.exp(-(isMoving ? 6.0 : 4.5) * dt);
            BABYLON.Vector3.LerpToRef(this._currentVelocity, this._tmpTargetVel, dragLerp, this._currentVelocity);

            this._localPos.x += this._currentVelocity.x * dt;
            this._localPos.z += this._currentVelocity.z * dt;

            // Smooth vertical swim / dive / critically-damped wave float (no pogo bouncing)
            const bodySubmerged = this._localPos.y < waterY - 0.10;
            const divingDown = this._keys["e"] || this._keys["control"] || (bodySubmerged && moveForward > 0 && this._currentPitch < -0.25);
            const swimmingUp = this._keys[" "] || (bodySubmerged && moveForward > 0 && this._currentPitch > 0.25);
            this._isDiving = divingDown || bodySubmerged;

            if (divingDown) {
                const diveSpeed = this._keys["shift"] ? -4.8 : -3.4;
                this._verticalVelocity = BABYLON.Scalar.Lerp(this._verticalVelocity, diveSpeed, 1.0 - Math.exp(-6.0 * dt));
                this._localPos.y += this._verticalVelocity * dt;
            } else if (swimmingUp) {
                if (this._localPos.y < surfaceEyeY) {
                    this._verticalVelocity = BABYLON.Scalar.Lerp(this._verticalVelocity, 3.8, 1.0 - Math.exp(-7.0 * dt));
                    this._localPos.y = Math.min(surfaceEyeY + 0.06, this._localPos.y + this._verticalVelocity * dt);
                } else {
                    // Gently hold head slightly higher on surface without leaping out of water
                    this._verticalVelocity = 0;
                    this._localPos.y = BABYLON.Scalar.Lerp(this._localPos.y, surfaceEyeY + 0.06, 1.0 - Math.exp(-8.0 * dt));
                }
            } else if (this._localPos.y < surfaceEyeY - 0.12) {
                // Smoothly float upward from underwater back toward the surface
                const riseSpeed = Math.min(3.0, (surfaceEyeY - this._localPos.y) * 3.2);
                this._verticalVelocity = BABYLON.Scalar.Lerp(this._verticalVelocity, riseSpeed, 1.0 - Math.exp(-5.0 * dt));
                this._localPos.y = Math.min(surfaceEyeY, this._localPos.y + this._verticalVelocity * dt);
            } else {
                // Ride wave surface cleanly with zero overshoot bounce
                this._verticalVelocity = 0;
                this._localPos.y = BABYLON.Scalar.Lerp(this._localPos.y, surfaceEyeY, 1.0 - Math.exp(-7.5 * dt));
            }

            // Clamp maximum dive depth
            const minDiveY = waterY - 14.0;
            if (this._localPos.y < minDiveY) {
                this._localPos.y = minDiveY;
                this._verticalVelocity = Math.max(0, this._verticalVelocity);
            }
        }

        // Ship hull collision & Climb Aboard proximity in ship-local space
        const shipWorldMat = this._shipRoot.getWorldMatrix();
        shipWorldMat.invertToRef(this._tmpInvShipMat);
        BABYLON.Vector3.TransformCoordinatesToRef(this._localPos, this._tmpInvShipMat, this._tmpShipLocal);

        const clampedLocalZ = BABYLON.Scalar.Clamp(this._tmpShipLocal.z, -4.3, 6.35);
        const deckMaxX = this._getDeckMaxX(clampedLocalZ);
        const hullMaxX = deckMaxX + 0.38;

        // Prevent swimming inside the ship hull below deck rail level
        if (this._tmpShipLocal.y < 2.15 && this._tmpShipLocal.y > -2.5 &&
            this._tmpShipLocal.z > -4.68 && this._tmpShipLocal.z < 6.70 &&
            Math.abs(this._tmpShipLocal.x) < hullMaxX) {
            const pushX = hullMaxX - Math.abs(this._tmpShipLocal.x);
            const pushBow = this._tmpShipLocal.z - (-4.68);
            const pushStern = 6.70 - this._tmpShipLocal.z;

            if (pushX <= pushBow && pushX <= pushStern) {
                this._tmpShipLocal.x = (this._tmpShipLocal.x >= 0 ? 1 : -1) * hullMaxX;
            } else if (pushBow <= pushStern) {
                this._tmpShipLocal.z = -4.68;
            } else {
                this._tmpShipLocal.z = 6.70;
            }
            BABYLON.Vector3.TransformCoordinatesToRef(this._tmpShipLocal, shipWorldMat, this._localPos);
        }

        // Re-evaluate boarding distance after hull push
        const dxHull = Math.max(0, Math.abs(this._tmpShipLocal.x) - deckMaxX);
        const dzHull = this._tmpShipLocal.z < -4.3 ? -4.3 - this._tmpShipLocal.z : this._tmpShipLocal.z > 6.35 ? this._tmpShipLocal.z - 6.35 : 0;
        const hullDist = Math.hypot(dxHull, dzHull);

        this._canBoardShip = this._hasHitWater && hullDist <= 2.9 && this._tmpShipLocal.y > -3.5;
        this._updateBoardPromptUI(this._canBoardShip);
    }

    private _climbAboardShip(): void {
        const shipWorldMat = this._shipRoot.getWorldMatrix();
        shipWorldMat.invertToRef(this._tmpInvShipMat);

        BABYLON.Vector3.TransformCoordinatesToRef(this._localPos, this._tmpInvShipMat, this._tmpShipLocal);
        const targetZ = BABYLON.Scalar.Clamp(this._tmpShipLocal.z, -3.9, 5.9);
        const maxX = Math.max(0.4, this._getDeckMaxX(targetZ) - 0.35);
        const targetX = BABYLON.Scalar.Clamp(this._tmpShipLocal.x, -maxX, maxX);
        const deckY = this._getDeckHeight(targetX, targetZ);

        // Convert world yaw back to ship-local yaw
        const worldFwd = this._tmpForward.set(-Math.sin(this._currentYaw), 0, -Math.cos(this._currentYaw));
        BABYLON.Vector3.TransformNormalToRef(worldFwd, this._tmpInvShipMat, this._tmpWorldDir);
        const localYaw = Math.atan2(-this._tmpWorldDir.x, -this._tmpWorldDir.z);

        this._playerNode.parent = this._shipRoot;
        this._localPos.set(targetX, deckY + this._eyeHeight, targetZ);
        this._currentYaw = localYaw;
        this._targetYaw = localYaw;
        this._verticalVelocity = 0;
        this._isGrounded = true;
        this._currentVelocity.set(0, 0, 0);

        this._canBoardShip = false;
        this._isDiving = false;
        this._applyUnderwaterState(false);
        this.audio.playFootstep();
        if (this.props.isCutlassEquipped && this.props.cutlassViewMesh) {
            this.props.cutlassViewMesh.setEnabled(true);
        }

        this.gameplayState = PlayerGameplayState.Walking;
        this._updateBoardPromptUI(false);
        if (this._swimNavBar) this._swimNavBar.style.display = "none";
        if (this._deckNavBar) this._deckNavBar.style.display = "flex";

        this.showToast("⚓ Climbed back aboard the pirate ship!", "ON DECK");
    }

    private _updateHelmState(dt: number): void {
        this._updatePromptCardUI(null);

        // Direct 1:1 mouse look while captaining the helm (zero lag)
        const sensitivity = 0.0022;
        this._currentYaw -= this._mouseDeltaX * sensitivity;
        this._currentPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        // Clamp view so captain stays facing forward (±80 deg yaw, -38 deg to +45 deg pitch)
        const maxTurn = (80.0 * Math.PI) / 180;
        const minPitch = (-38.0 * Math.PI) / 180;
        const maxPitch = this.cameraViewMode === CameraViewMode.ThirdPerson ? 0.28 : (45.0 * Math.PI) / 180;
        this._currentYaw = BABYLON.Scalar.Clamp(this._currentYaw, -maxTurn, maxTurn);
        this._currentPitch = BABYLON.Scalar.Clamp(this._currentPitch, minPitch, maxPitch);
        this._targetYaw = this._currentYaw;
        this._targetPitch = this._currentPitch;

        // A / D steers the rudder and turns the wheel:
        // [A] = Port (left), [D] = Starboard (right)
        let steerInput = 0;
        if (this._keys["a"] || this._keys["arrowleft"]) steerInput = -1; // Port (left)
        if (this._keys["d"] || this._keys["arrowright"]) steerInput = 1;  // Starboard (right)

        // Smooth rudder angle response: -30 (Port) to +30 (Starboard)
        const targetRudder = steerInput * 30; // degrees
        this.rudderAngle += (targetRudder - this.rudderAngle) * (1.0 - Math.exp(-6.0 * dt));

        this._helmAudioCooldown = Math.max(0, this._helmAudioCooldown - dt);
        if (steerInput !== 0) {
            // Turn wheel: left for Port, right for Starboard
            this.props.rotateHelm(-steerInput * dt * 2.8);
            if (this._helmAudioCooldown <= 0) {
                this.audio.playHelmCreak();
                this._helmAudioCooldown = 0.16;
            }

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
        BABYLON.Vector3.TransformNormalToRef(this._localForwardConst, this._shipRoot.getWorldMatrix(), this._tmpForward);
        this._tmpForward.normalize();
        const moveDist = this.currentShipSpeed * dt;
        this._shipRoot.position.addInPlaceFromFloats(this._tmpForward.x * moveDist, this._tmpForward.y * moveDist, this._tmpForward.z * moveDist);

        // Calculate heading in compass degrees
        const headingDeg = Math.round(((Math.atan2(this._tmpForward.x, -this._tmpForward.z) * 180) / Math.PI + 360) % 360);

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
        // Direct 1:1 Cannon aim look
        const mouseSensitivity = 0.0022;
        const baseBroadsideYaw = this.isStarboardCannon ? -Math.PI / 2 : Math.PI / 2;

        this._targetYaw -= this._mouseDeltaX * mouseSensitivity;
        this._targetPitch -= this._mouseDeltaY * mouseSensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        // Keys also adjust aim smoothly:
        // W = pitch up, S = pitch down
        if (this._keys["w"] || this._keys["arrowup"]) this._targetPitch += dt * 0.55;
        if (this._keys["s"] || this._keys["arrowdown"]) this._targetPitch -= dt * 0.55;

        // A = traverse left, D = traverse right (relative to camera facing out the gunport)
        if (this._keys["a"] || this._keys["arrowleft"]) this._targetYaw += dt * 0.65;
        if (this._keys["d"] || this._keys["arrowright"]) this._targetYaw -= dt * 0.65;

        // Clamp elevation: -8 deg (down towards sea) to +26 deg (up towards rigging/sky)
        const minPitch = (-8.0 * Math.PI) / 180;
        const maxPitch = (26.0 * Math.PI) / 180;
        this._targetPitch = BABYLON.Scalar.Clamp(this._targetPitch, minPitch, maxPitch);

        // Clamp traverse: ±28 deg from gunport center
        const maxTraverse = (28.0 * Math.PI) / 180;
        this._targetYaw = BABYLON.Scalar.Clamp(this._targetYaw, baseBroadsideYaw - maxTraverse, baseBroadsideYaw + maxTraverse);

        this._currentYaw = this._targetYaw;

        // Handle firing recoil kick
        let recoilPitch = 0;
        if (this._cannonRecoilTime > 0) {
            this._cannonRecoilTime -= dt;
            recoilPitch = Math.sin((this._cannonRecoilTime / 0.35) * Math.PI) * 0.08;
        }
        this._currentPitch = this._targetPitch + recoilPitch;

        // Calculate elevation & traverse in degrees for HUD display
        this.cannonElevation = (this._targetPitch * 180) / Math.PI;
        const rawTraverseRad = this._targetYaw - baseBroadsideYaw;
        this.cannonTraverse = (rawTraverseRad * 180) / Math.PI * (this.isStarboardCannon ? -1 : 1);

        this._updateCannonHUD();
    }

    private _updateSailAdjustState(dt: number): void {
        this._updatePromptCardUI(null);

        // Direct 1:1 mouse look while adjusting rigging (zero lag)
        const sensitivity = 0.0022;
        this._currentYaw -= this._mouseDeltaX * sensitivity;
        this._currentPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        // Generous vertical pitch range: from -25 deg (deck) to +72 deg (high masthead & crows nest)
        const minPitch = this.cameraViewMode === CameraViewMode.ThirdPerson ? -0.65 : (-25.0 * Math.PI) / 180;
        const maxPitch = this.cameraViewMode === CameraViewMode.ThirdPerson ? 0.28 : (72.0 * Math.PI) / 180;
        this._currentPitch = BABYLON.Scalar.Clamp(this._currentPitch, minPitch, maxPitch);
        this._targetYaw = this._currentYaw;
        this._targetPitch = this._currentPitch;

        // W hoists / trims canvas, S reefs / furls canvas
        this._sailAudioCooldown = Math.max(0, this._sailAudioCooldown - dt);
        if (this._keys["w"] || this._keys["arrowup"]) {
            this.sailTrimPercent = Math.min(100, this.sailTrimPercent + dt * 25);
            this.props.setSailTrim(this.sailTrimPercent / 100);
            if (this._sailAudioCooldown <= 0) {
                this.audio.playSailFlutter();
                this._sailAudioCooldown = 0.55;
            }
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

    private _updateSpyglassState(_dt: number): void {
        this._updatePromptCardUI(null);

        // Direct 1:1 telescope look (zero lag)
        const sensitivity = 0.0010;
        this._currentYaw -= this._mouseDeltaX * sensitivity;
        this._currentPitch -= this._mouseDeltaY * sensitivity;
        this._mouseDeltaX = 0;
        this._mouseDeltaY = 0;

        const maxPitch = Math.PI * 0.40;
        this._currentPitch = BABYLON.Scalar.Clamp(this._currentPitch, -maxPitch, maxPitch);
        this._targetYaw = this._currentYaw;
        this._targetPitch = this._currentPitch;
    }

    // =========================================================================
    // HUD & PROMPT CARD UI RENDERING
    // =========================================================================

    private _showPromptCard(id: string | null, title = "", action = "", subtitle = ""): void {
        if (!this._cardContainer || !this._cardTitle || !this._cardAction || !this._cardSub) return;

        if (id === this._lastPromptCardId) {
            return;
        }
        this._lastPromptCardId = id;

        if (id !== null) {
            this._cardTitle.textContent = title;
            this._cardAction.textContent = action;
            this._cardSub.textContent = subtitle;
            this._cardContainer.classList.add("is-visible");
        } else {
            this._cardContainer.classList.remove("is-visible");
        }
    }

    private _updatePromptCardUI(obj: InteractiveObject | null): void {
        if (obj && this.gameplayState === PlayerGameplayState.Walking) {
            this._showPromptCard(obj.id, obj.cardTitle, obj.actionPrompt, obj.subtitle);
        } else {
            this._showPromptCard(null);
        }
    }

    private _updateBoardPromptUI(canBoard: boolean): void {
        if (canBoard && this.gameplayState === PlayerGameplayState.Swimming) {
            this._showPromptCard(
                "__board_ship__",
                "SHIP HULL",
                "Climb Aboard",
                "Grab the railing & climb back onto the deck"
            );
        } else {
            this._showPromptCard(null);
        }
    }

    private _updateHelmHUD(headingDeg: number): void {
        if (!this._helmHUD) return;

        if (this._helmHeadingEl) {
            const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
            const dirIdx = Math.round(headingDeg / 22.5) % 16;
            const headingText = `${String(headingDeg).padStart(3, '0')}° ${dirs[dirIdx]} • AHEAD`;
            if (headingText !== this._lastHelmHeading) {
                this._lastHelmHeading = headingText;
                this._helmHeadingEl.textContent = headingText;
            }
        }

        if (this._helmRudderTextEl) {
            const side = this.rudderAngle < -1 ? "PORT" : this.rudderAngle > 1 ? "STARBOARD" : "MIDSHIPS";
            const deg = Math.abs(Math.round(this.rudderAngle));
            const rudderText = side === "MIDSHIPS" ? "0° MIDSHIPS" : `${deg}° ${side}`;
            if (rudderText !== this._lastHelmRudder) {
                this._lastHelmRudder = rudderText;
                this._helmRudderTextEl.textContent = rudderText;
            }
        }

        if (this._helmRudderNeedleEl) {
            const pct = (50 + (this.rudderAngle / 30) * 42).toFixed(2) + "%";
            if (pct !== this._lastHelmNeedlePct) {
                this._lastHelmNeedlePct = pct;
                this._helmRudderNeedleEl.style.left = pct;
            }
        }

        if (this._helmSpeedEl) {
            const speedText = `${this.currentShipSpeed.toFixed(1)} KTS`;
            if (speedText !== this._lastHelmSpeed) {
                this._lastHelmSpeed = speedText;
                this._helmSpeedEl.textContent = speedText;
            }
        }
    }

    private _updateCannonHUD(): void {
        if (!this._cannonHUD) return;

        if (this._cannonElevEl) {
            const sign = this.cannonElevation >= 0 ? "+" : "";
            const elevText = `${sign}${this.cannonElevation.toFixed(1)}°`;
            if (elevText !== this._lastCannonElev) {
                this._lastCannonElev = elevText;
                this._cannonElevEl.textContent = elevText;
            }
        }

        if (this._cannonTravEl) {
            const sign = this.cannonTraverse >= 0 ? "+" : "";
            const travText = `${sign}${this.cannonTraverse.toFixed(1)}°`;
            if (travText !== this._lastCannonTrav) {
                this._lastCannonTrav = travText;
                this._cannonTravEl.textContent = travText;
            }
        }

        if (this._cannonStatusEl && this._cannonReloadBarEl) {
            if (this.cannonReloadTimer <= 0) {
                if (this._lastCannonStatus !== "READY") {
                    this._lastCannonStatus = "READY";
                    this._cannonStatusEl.textContent = "READY TO FIRE";
                    this._cannonStatusEl.className = "cannon-status ready";
                }
                if (this._lastCannonBarWidth !== "100%") {
                    this._lastCannonBarWidth = "100%";
                    this._cannonReloadBarEl.style.width = "100%";
                }
            } else {
                const statusText = `RELOADING... [${this.cannonReloadTimer.toFixed(1)}s]`;
                if (statusText !== this._lastCannonStatus) {
                    this._lastCannonStatus = statusText;
                    this._cannonStatusEl.textContent = statusText;
                    this._cannonStatusEl.className = "cannon-status reloading";
                }
                const p = 1.0 - this.cannonReloadTimer / 2.4;
                const widthPct = `${Math.round(p * 100)}%`;
                if (widthPct !== this._lastCannonBarWidth) {
                    this._lastCannonBarWidth = widthPct;
                    this._cannonReloadBarEl.style.width = widthPct;
                }
            }
        }
    }

    private _updateSailHUD(): void {
        if (!this._sailHUD) return;

        if (this._sailTrimTextEl && this._sailTrimFillEl) {
            const roundPct = Math.round(this.sailTrimPercent);
            const trimText = `${roundPct}% HOISTED`;
            const widthPct = `${roundPct}%`;
            if (trimText !== this._lastSailTrimText) {
                this._lastSailTrimText = trimText;
                this._sailTrimTextEl.textContent = trimText;
            }
            if (widthPct !== this._lastSailBarWidth) {
                this._lastSailBarWidth = widthPct;
                this._sailTrimFillEl.style.width = widthPct;
            }
        }
    }

    private _updateRepairHUD(): void {
        if (!this._repairHUD) return;

        if (this._repairPctTextEl && this._repairBarFillEl) {
            const pct = Math.round(this.props.repairProgress * 100);
            const pctText = `${pct}% INTEGRITY`;
            const widthPct = `${pct}%`;
            if (pctText !== this._lastRepairPctText) {
                this._lastRepairPctText = pctText;
                this._repairPctTextEl.textContent = pctText;
            }
            if (widthPct !== this._lastRepairBarWidth) {
                this._lastRepairBarWidth = widthPct;
                this._repairBarFillEl.style.width = widthPct;
            }
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

        // 2. Compact Bottom-Right Interaction Prompt (keeps game viewport unobstructed)
        const cardBox = document.createElement("div");
        cardBox.id = "ship-interaction-card";
        cardBox.innerHTML = `
            <div class="interact-prompt-pill">
                <div class="interact-key-badge">
                    <span class="card-key-cap">F</span>
                </div>
                <div class="interact-prompt-body">
                    <div class="interact-prompt-header">
                        <span class="card-headline-title" id="interact-card-title">CANNON</span>
                        <span class="card-action-verb" id="interact-card-action">Use Cannon</span>
                    </div>
                    <div class="card-action-sub" id="interact-card-sub">Aim naval broadside & fire</div>
                </div>
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

        // 3b. Underwater Blue-Teal Vignette Overlay
        const underwater = document.createElement("div");
        underwater.id = "underwater-overlay";
        document.body.appendChild(underwater);
        this._underwaterOverlay = underwater;

        // 4. Toast Notification Container
        const toastBox = document.createElement("div");
        toastBox.id = "ship-toast-box";
        document.body.appendChild(toastBox);
        this._toastContainer = toastBox;

        // 6. Bottom Navigation Controls Bar (Deck + Swim)
        const deckBar = document.createElement("div");
        deckBar.id = "deck-nav-bar";
        deckBar.innerHTML = `
            <div class="nav-item"><span class="nav-key">[WASD]</span> Walk Deck</div>
            <div class="nav-item"><span class="nav-key">[F]</span> Interact</div>
            <div class="nav-item"><span class="nav-key">[Space]</span> Jump / Dive Overboard</div>
            <div class="nav-item"><span class="nav-key">[C]</span> View (1st/3rd/Free)</div>
            <div class="nav-item"><span class="nav-key">[T]</span> Sky</div>
        `;
        document.body.appendChild(deckBar);
        this._deckNavBar = deckBar;

        const swimBar = document.createElement("div");
        swimBar.id = "swim-nav-bar";
        swimBar.innerHTML = `
            <div class="nav-item"><span class="nav-key">[WASD]</span> Swim</div>
            <div class="nav-item"><span class="nav-key">[Shift]</span> Sprint</div>
            <div class="nav-item"><span class="nav-key">[Space]</span> Surface</div>
            <div class="nav-item"><span class="nav-key">[E / Ctrl]</span> Dive</div>
            <div class="nav-item"><span class="nav-key">[C]</span> View (1st/3rd/Free)</div>
            <div class="nav-item"><span class="nav-key">[T]</span> Sky</div>
        `;
        document.body.appendChild(swimBar);
        this._swimNavBar = swimBar;

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
        this._helmHeadingEl = helmHUD.querySelector("#helm-heading-text");
        this._helmRudderTextEl = helmHUD.querySelector("#helm-rudder-text");
        this._helmRudderNeedleEl = helmHUD.querySelector("#helm-rudder-needle");
        this._helmSpeedEl = helmHUD.querySelector("#helm-speed-text");

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
        this._cannonElevEl = cannonHUD.querySelector("#cannon-elev-text");
        this._cannonTravEl = cannonHUD.querySelector("#cannon-trav-text");
        this._cannonStatusEl = cannonHUD.querySelector("#cannon-status-text");
        this._cannonReloadBarEl = cannonHUD.querySelector("#cannon-reload-bar");

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
        this._sailTrimTextEl = sailHUD.querySelector("#sail-trim-text");
        this._sailTrimFillEl = sailHUD.querySelector("#sail-trim-fill");

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
        this._repairPctTextEl = repairHUD.querySelector("#repair-pct-text");
        this._repairBarFillEl = repairHUD.querySelector("#repair-bar-fill");
    }
}
