import { ShipAudio } from './ShipAudio';
import { ShipProps } from './ShipProps';

export interface InteractiveObject {
    id: string;
    name: string;
    actionPrompt: string;
    subtitle: string;
    localPos: BABYLON.Vector3;
    interactionRadius: number;
    ringMesh?: BABYLON.Mesh;
    interact: (audio: ShipAudio, props: ShipProps, player: any) => { message: string; submessage?: string };
}

export class InteractiveShipObjects {
    private _scene: BABYLON.Scene;
    private _shipRoot: BABYLON.TransformNode;
    public audio: ShipAudio;
    public props: ShipProps;

    public objects: InteractiveObject[] = [];
    public nearestObject: InteractiveObject | null = null;
    public nearestDistance = Infinity;

    // Helm Steering State
    public isAtHelm = false;

    // Spyglass State
    public isUsingSpyglass = false;

    constructor(scene: BABYLON.Scene, shipRoot: BABYLON.TransformNode, audio: ShipAudio, props: ShipProps) {
        this._scene = scene;
        this._shipRoot = shipRoot;
        this.audio = audio;
        this.props = props;

        this._registerObjects();
        this._createFloorRings();
    }

    private _registerObjects(): void {
        // 1. Helm (Steering wheel on quarterdeck)
        this.objects.push({
            id: 'helm',
            name: "Ship's Helm",
            actionPrompt: 'Take the Helm',
            subtitle: 'Steer the vessel across the ocean',
            localPos: new BABYLON.Vector3(0, 2.45, 5.2),
            interactionRadius: 2.0,
            interact: (audio, _props, player) => {
                this.isAtHelm = !this.isAtHelm;
                audio.playHelmCreak();
                if (this.isAtHelm) {
                    player.showToast("⚓ You took the Helm! Use [A] and [D] to steer the ship. Press [F] to release.", "STEERING VESSEL");
                    return { message: "Release Helm", submessage: "Use [A]/[D] to steer" };
                } else {
                    player.showToast("Released the helm back to free walking.", "HELM RELEASED");
                    return { message: "Take the Helm", submessage: "Steer the vessel across the ocean" };
                }
            }
        });

        // 2a. Starboard Cannon
        this.objects.push({
            id: 'starboard_cannon',
            name: 'Starboard Cannon',
            actionPrompt: 'Fire Starboard Cannon',
            subtitle: 'Loaded with heavy round shot and black powder',
            localPos: new BABYLON.Vector3(1.35, 1.55, 0.5),
            interactionRadius: 2.2,
            interact: (audio, props, player) => {
                audio.playCannonBlast();
                props.fireCannon(true);
                player.showToast("💥 BOOM! Starboard broadside cannon unleashed into the sea!", "BROADSIDE FIRED");
                return { message: "Fire Starboard Cannon", submessage: "Reloading shot..." };
            }
        });

        // 2b. Port Cannon
        this.objects.push({
            id: 'port_cannon',
            name: 'Port Cannon',
            actionPrompt: 'Fire Port Cannon',
            subtitle: 'Loaded with heavy round shot and black powder',
            localPos: new BABYLON.Vector3(-1.35, 1.55, 0.5),
            interactionRadius: 2.2,
            interact: (audio, props, player) => {
                audio.playCannonBlast();
                props.fireCannon(false);
                player.showToast("💥 BOOM! Port broadside cannon unleashed into the sea!", "BROADSIDE FIRED");
                return { message: "Fire Port Cannon", submessage: "Reloading shot..." };
            }
        });

        // 3. Sails & Main Mast
        this.objects.push({
            id: 'sails',
            name: 'Main Mast & Sails',
            actionPrompt: 'Trim Sails',
            subtitle: 'Adjust canvas rigging for maximum wind catch',
            localPos: new BABYLON.Vector3(0, 1.55, 0.9),
            interactionRadius: 2.2,
            interact: (audio, props, player) => {
                audio.playSailFlutter();
                const trimmed = props.toggleSails();
                if (trimmed) {
                    player.showToast("⛵ Sails hoisted to full billow! Catching the sea breeze.", "SAILS TRIMMED");
                    return { message: "Reef Sails", submessage: "Canvas at full billow" };
                } else {
                    player.showToast("⛵ Sails reefed for heavy seas.", "SAILS REEFED");
                    return { message: "Trim Sails", submessage: "Canvas furled" };
                }
            }
        });

        // 4. Repair Point (Hull planks)
        this.objects.push({
            id: 'repair_point',
            name: 'Damaged Hull Planking',
            actionPrompt: 'Repair Hull Planking',
            subtitle: 'Loose oak planks needing reinforcement',
            localPos: new BABYLON.Vector3(-1.25, 1.55, -1.2),
            interactionRadius: 2.0,
            interact: (audio, props, player) => {
                audio.playHammer();
                props.repairHullPlank();
                player.showToast("🔨 Thwack! Planks secured and caulked. Hull integrity 100%!", "HULL REPAIRED");
                return { message: "Inspect Hull", submessage: "Hull reinforced with oak & brass" };
            }
        });

        // 5. Weapon Rack (Cutlass & Flintlock)
        this.objects.push({
            id: 'weapon_rack',
            name: 'Armory Weapon Rack',
            actionPrompt: 'Draw Pirate Cutlass',
            subtitle: 'Razor-sharp curved naval steel blade',
            localPos: new BABYLON.Vector3(0.95, 2.45, 2.2),
            interactionRadius: 2.0,
            interact: (audio, props, player) => {
                if (!props.isCutlassEquipped) {
                    audio.playCutlassDraw();
                    props.equipCutlass();
                    player.showToast("⚔️ Pirate Cutlass drawn! Left-Click or press [F] to swing blade!", "WEAPON EQUIPPED");
                    return { message: "Slash Cutlass", submessage: "Naval steel blade ready" };
                } else {
                    audio.playCutlassSwing();
                    props.swingCutlass();
                    player.showToast("⚔️ SWOOSH! Cutlass flourished in combat stance!", "SLASH ATTACK");
                    return { message: "Slash Cutlass", submessage: "Click to attack" };
                }
            }
        });

        // 6. Treasure Chest (Quarterdeck Captain's Chest)
        this.objects.push({
            id: 'treasure_chest',
            name: "Captain's Treasure Chest",
            actionPrompt: 'Open Treasure Chest',
            subtitle: 'Bound in weathered oak and solid brass',
            localPos: new BABYLON.Vector3(-0.95, 2.45, 4.8),
            interactionRadius: 2.0,
            interact: (audio, props, player) => {
                audio.playChestOpen();
                const opened = props.toggleTreasureChest();
                if (opened) {
                    player.showToast("💎 Golden radiance pours forth! 500 Doubloons & sparkling Aztec gems discovered!", "TREASURE CLAIMED");
                    return { message: "Close Chest", submessage: "Contains gleaming gold & gems" };
                } else {
                    player.showToast("Chest locked securely.", "CHEST CLOSED");
                    return { message: "Open Treasure Chest", submessage: "Bound in brass" };
                }
            }
        });

        // 7. Ship Edge / Prow Lookout
        this.objects.push({
            id: 'ship_edge',
            name: 'Prow Lookout Rail',
            actionPrompt: 'Gaze at the Horizon',
            subtitle: 'Look out over the endless ocean swell and skies',
            localPos: new BABYLON.Vector3(0, 2.05, -3.85),
            interactionRadius: 2.2,
            interact: (audio, _props, player) => {
                audio.startAmbientSea();
                this.isUsingSpyglass = !this.isUsingSpyglass;
                player.toggleSpyglass(this.isUsingSpyglass);
                if (this.isUsingSpyglass) {
                    player.showToast("🔭 Raised Spyglass! Scanning the deep blue horizon for distant land...", "LOOKOUT SPYGLASS");
                    return { message: "Lower Spyglass", submessage: "Viewing horizon" };
                } else {
                    player.showToast("Lowered spyglass.", "LOOKOUT");
                    return { message: "Gaze at the Horizon", submessage: "Look out over the ocean" };
                }
            }
        });
    }

    /**
     * Creates glowing nautical ring decals on the deck beneath each interactive object
     */
    private _createFloorRings(): void {
        const ringMat = new BABYLON.PBRMaterial("interactiveRingMat", this._scene);
        ringMat.albedoColor = new BABYLON.Color3(0.95, 0.75, 0.25);
        ringMat.emissiveColor = new BABYLON.Color3(0.35, 0.25, 0.05);
        ringMat.metallic = 0.8;
        ringMat.roughness = 0.3;
        ringMat.alpha = 0.55;

        for (const obj of this.objects) {
            const ring = BABYLON.MeshBuilder.CreateTorus(
                `ring_${obj.id}`,
                { diameter: 0.9, thickness: 0.035, tessellation: 32 },
                this._scene
            );
            ring.parent = this._shipRoot;
            ring.position.set(obj.localPos.x, obj.localPos.y + 0.04, obj.localPos.z);
            ring.material = ringMat;
            obj.ringMesh = ring;
        }

        // Animate glowing rings pulsing
        let ringTime = 0;
        this._scene.onBeforeRenderObservable.add(() => {
            ringTime += 0.03;
            const pulse = 0.85 + Math.sin(ringTime) * 0.15;
            for (const obj of this.objects) {
                if (obj.ringMesh) {
                    obj.ringMesh.scaling.set(pulse, 1, pulse);
                }
            }
        });
    }

    /**
     * Evaluates distance from player local position to all interactive objects.
     * Selects closest object within interactionRadius.
     */
    public updateProximity(playerLocalPos: BABYLON.Vector3, playerFacingForward: BABYLON.Vector3): InteractiveObject | null {
        let closest: InteractiveObject | null = null;
        let minDistance = Infinity;

        for (const obj of this.objects) {
            const dist = BABYLON.Vector3.Distance(
                new BABYLON.Vector3(playerLocalPos.x, 0, playerLocalPos.z),
                new BABYLON.Vector3(obj.localPos.x, 0, obj.localPos.z)
            );

            // Also check Y difference (cannot interact across decks)
            const yDist = Math.abs(playerLocalPos.y - obj.localPos.y);

            if (dist <= obj.interactionRadius && yDist < 1.8) {
                // Check if facing roughly towards object (within 130 degrees field of view)
                const toObj = obj.localPos.subtract(playerLocalPos).normalize();
                const dot = BABYLON.Vector3.Dot(playerFacingForward, toObj);

                if (dot > -0.2) {
                    if (dist < minDistance) {
                        minDistance = dist;
                        closest = obj;
                    }
                }
            }
        }

        this.nearestObject = closest;
        this.nearestDistance = minDistance;

        // Highlight nearest ring
        for (const obj of this.objects) {
            if (obj.ringMesh) {
                if (obj === closest) {
                    obj.ringMesh.visibility = 1.0;
                } else {
                    obj.ringMesh.visibility = 0.35;
                }
            }
        }

        return closest;
    }
}
