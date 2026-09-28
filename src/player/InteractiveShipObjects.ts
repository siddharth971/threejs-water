import { ShipAudio } from './ShipAudio';
import { ShipProps } from './ShipProps';

export interface InteractiveObject {
    id: string;
    cardTitle: string;
    actionPrompt: string;
    keyPrompt: string;
    subtitle: string;
    localPos: BABYLON.Vector3;
    interactionRadius: number;
    ringMesh?: BABYLON.Mesh;
    beaconMesh?: BABYLON.Mesh;
    stateTarget: 'helm' | 'cannon_starboard' | 'cannon_port' | 'sail' | 'repair' | 'weapon' | 'chest' | 'lookout';
    interact: (audio: ShipAudio, props: ShipProps, player: any) => void;
}

export class InteractiveShipObjects {
    private _scene: BABYLON.Scene;
    private _shipRoot: BABYLON.TransformNode;
    public audio: ShipAudio;
    public props: ShipProps;

    public objects: InteractiveObject[] = [];
    public nearestObject: InteractiveObject | null = null;
    public nearestDistance = Infinity;

    // 3D Highlighting
    private _highlightLayer: BABYLON.HighlightLayer | null = null;
    private _currentlyHighlightedMeshes: BABYLON.Mesh[] = [];
    private _highlightedObjectId: string | null = null;

    // State Tracking
    public isAtHelm = false;
    public isUsingSpyglass = false;

    constructor(scene: BABYLON.Scene, shipRoot: BABYLON.TransformNode, audio: ShipAudio, props: ShipProps) {
        this._scene = scene;
        this._shipRoot = shipRoot;
        this.audio = audio;
        this.props = props;

        this._setupHighlightLayer();
        this._registerObjects();
        this._createFloorRings();
    }

    private _setupHighlightLayer(): void {
        try {
            this._highlightLayer = new BABYLON.HighlightLayer("shipInteractHighlight", this._scene, {
                mainTextureRatio: 1.0,
                blurHorizontalSize: 1.0,
                blurVerticalSize: 1.0,
                isStroke: true
            });
        } catch {
            this._highlightLayer = null;
        }
    }

    private _registerObjects(): void {
        // 1. Helm (Steering wheel on quarterdeck)
        this.objects.push({
            id: 'helm',
            cardTitle: 'HELM',
            actionPrompt: 'Control Ship',
            keyPrompt: 'Press F',
            subtitle: 'Take wheel, steer rudder & navigate the ocean',
            localPos: new BABYLON.Vector3(0, 2.45, 3.8),
            interactionRadius: 2.1,
            stateTarget: 'helm',
            interact: (_audio, _props, player) => {
                player.enterHelmState();
            }
        });

        // 2a. Starboard Cannon
        this.objects.push({
            id: 'starboard_cannon',
            cardTitle: 'CANNON',
            actionPrompt: 'Use Cannon',
            keyPrompt: 'Press F',
            subtitle: 'Aim starboard naval artillery & fire broadside',
            localPos: new BABYLON.Vector3(1.35, 1.55, 0.5),
            interactionRadius: 2.3,
            stateTarget: 'cannon_starboard',
            interact: (_audio, _props, player) => {
                player.enterCannonState(true);
            }
        });

        // 2b. Port Cannon
        this.objects.push({
            id: 'port_cannon',
            cardTitle: 'CANNON',
            actionPrompt: 'Use Cannon',
            keyPrompt: 'Press F',
            subtitle: 'Aim port naval artillery & fire broadside',
            localPos: new BABYLON.Vector3(-1.35, 1.55, 0.5),
            interactionRadius: 2.3,
            stateTarget: 'cannon_port',
            interact: (_audio, _props, player) => {
                player.enterCannonState(false);
            }
        });

        // 3. Sails & Main Mast
        this.objects.push({
            id: 'sails',
            cardTitle: 'SAIL',
            actionPrompt: 'Adjust Sail',
            keyPrompt: 'Press F',
            subtitle: 'Trim rigging, hoist canvas & catch the wind',
            localPos: new BABYLON.Vector3(0, 1.55, 0.9),
            interactionRadius: 2.3,
            stateTarget: 'sail',
            interact: (_audio, _props, player) => {
                player.enterSailState();
            }
        });

        // 4. Repair Point (Damaged Hull Planking)
        this.objects.push({
            id: 'repair_point',
            cardTitle: 'REPAIR POINT',
            actionPrompt: 'Repair Hull',
            keyPrompt: 'Press F',
            subtitle: 'Hammer loose oak planks & seal seawater leaks',
            localPos: new BABYLON.Vector3(-1.25, 1.55, -1.2),
            interactionRadius: 2.1,
            stateTarget: 'repair',
            interact: (_audio, _props, player) => {
                player.enterRepairState();
            }
        });

        // 5. Weapon Rack (Armory on quarterdeck stairs)
        this.objects.push({
            id: 'weapon_rack',
            cardTitle: 'WEAPON RACK',
            actionPrompt: 'Draw Cutlass',
            keyPrompt: 'Press F',
            subtitle: 'Equip tempered naval steel cutlass for combat',
            localPos: new BABYLON.Vector3(0.95, 2.45, 2.2),
            interactionRadius: 2.1,
            stateTarget: 'weapon',
            interact: (audio, props, player) => {
                if (!props.isCutlassEquipped) {
                    audio.playCutlassDraw();
                    props.equipCutlass();
                    player.showToast("⚔️ Pirate Cutlass drawn! Left-Click to slash.", "WEAPON EQUIPPED");
                } else {
                    audio.playCutlassSwing();
                    props.swingCutlass();
                    player.showToast("⚔️ SWOOSH! Cutlass flourished in combat stance!", "SLASH ATTACK");
                }
            }
        });

        // 6. Treasure Chest (Captain's Stash on quarterdeck)
        this.objects.push({
            id: 'treasure_chest',
            cardTitle: 'TREASURE CHEST',
            actionPrompt: 'Open Chest',
            keyPrompt: 'Press F',
            subtitle: "Brass-bound chest filled with Aztec doubloons",
            localPos: new BABYLON.Vector3(-0.95, 2.45, 4.8),
            interactionRadius: 2.1,
            stateTarget: 'chest',
            interact: (audio, props, player) => {
                audio.playChestOpen();
                const opened = props.toggleTreasureChest();
                if (opened) {
                    player.showToast("💎 Golden radiance pours forth! 500 Doubloons discovered!", "TREASURE CLAIMED");
                } else {
                    player.showToast("Chest locked securely.", "CHEST CLOSED");
                }
            }
        });

        // 7. Ship Lookout / Bow Rail
        this.objects.push({
            id: 'ship_edge',
            cardTitle: 'SHIP LOOKOUT',
            actionPrompt: 'Use Spyglass',
            keyPrompt: 'Press F',
            subtitle: 'Scan the endless ocean horizon with brass optics',
            localPos: new BABYLON.Vector3(0, 2.05, -3.85),
            interactionRadius: 2.3,
            stateTarget: 'lookout',
            interact: (_audio, _props, player) => {
                player.enterSpyglassState();
            }
        });
    }

    /**
     * Creates glowing floor targeting rings and animated hovering 3D diamond waypoints
     */
    private _createFloorRings(): void {
        const ringMat = new BABYLON.PBRMaterial("interactiveRingMat", this._scene);
        ringMat.albedoColor = new BABYLON.Color3(1.0, 0.82, 0.25);
        ringMat.emissiveColor = new BABYLON.Color3(0.5, 0.35, 0.08);
        ringMat.metallic = 0.85;
        ringMat.roughness = 0.25;
        ringMat.alpha = 0.65;

        const beaconMat = new BABYLON.PBRMaterial("beaconDiamondMat", this._scene);
        beaconMat.albedoColor = new BABYLON.Color3(1.0, 0.88, 0.35);
        beaconMat.emissiveColor = new BABYLON.Color3(0.7, 0.5, 0.1);
        beaconMat.metallic = 0.9;
        beaconMat.roughness = 0.2;

        for (const obj of this.objects) {
            // Floor ring
            const ring = BABYLON.MeshBuilder.CreateTorus(
                `ring_${obj.id}`,
                { diameter: 0.95, thickness: 0.038, tessellation: 36 },
                this._scene
            );
            ring.parent = this._shipRoot;
            ring.position.set(obj.localPos.x, obj.localPos.y + 0.04, obj.localPos.z);
            ring.material = ringMat;
            ring.visibility = 0.3;
            obj.ringMesh = ring;

            // Hovering floating diamond waypoint marker
            const beacon = BABYLON.MeshBuilder.CreatePolyhedron(
                `beacon_${obj.id}`,
                { type: 1, size: 0.12 }, // Octahedron diamond
                this._scene
            );
            beacon.parent = this._shipRoot;
            beacon.position.set(obj.localPos.x, obj.localPos.y + 1.1, obj.localPos.z);
            beacon.material = beaconMat;
            beacon.visibility = 0.0; // Visible only when in range
            obj.beaconMesh = beacon;
        }

        // Animate glowing rings and floating diamond beacons
        let animTime = 0;
        this._scene.onBeforeRenderObservable.add(() => {
            animTime += 0.035;
            const pulse = 0.92 + Math.sin(animTime * 1.5) * 0.12;
            const bob = Math.sin(animTime * 2.0) * 0.06;

            for (const obj of this.objects) {
                if (obj.ringMesh) {
                    obj.ringMesh.scaling.set(pulse, 1, pulse);
                }
                if (obj.beaconMesh) {
                    obj.beaconMesh.rotation.y += 0.025;
                    obj.beaconMesh.position.y = obj.localPos.y + 1.1 + bob;
                }
            }
        });
    }

    /**
     * Evaluates distance from player local position to all interactive objects.
     * When distance < interactionRadius, updates 3D highlighting on meshes and floor rings.
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

            if (dist <= obj.interactionRadius && yDist < 1.85) {
                // Check if facing roughly towards object (within 130 degrees field of view)
                const toObj = obj.localPos.subtract(playerLocalPos).normalize();
                const dot = BABYLON.Vector3.Dot(playerFacingForward, toObj);

                if (dot > -0.25) {
                    if (dist < minDistance) {
                        minDistance = dist;
                        closest = obj;
                    }
                }
            }
        }

        this.nearestObject = closest;
        this.nearestDistance = minDistance;

        // Apply 3D Highlighting
        this._update3DHighlighting(closest);

        return closest;
    }

    /**
     * Updates Babylon.js HighlightLayer and visual beacons
     */
    private _update3DHighlighting(closest: InteractiveObject | null): void {
        const closestId = closest ? closest.id : null;

        if (closestId !== this._highlightedObjectId) {
            // Unhighlight previous
            if (this._highlightLayer && this._currentlyHighlightedMeshes.length > 0) {
                for (const m of this._currentlyHighlightedMeshes) {
                    try {
                        this._highlightLayer.removeMesh(m);
                    } catch {
                        // Safe mesh removal
                    }
                }
                this._currentlyHighlightedMeshes = [];
            }

            this._highlightedObjectId = closestId;

            // Highlight new closest object meshes
            if (closest && this._highlightLayer) {
                const targetMeshes = this.props.getHighlightMeshesForObject(closest.id);
                const goldAura = new BABYLON.Color3(1.0, 0.78, 0.25);

                for (const mesh of targetMeshes) {
                    try {
                        this._highlightLayer.addMesh(mesh, goldAura);
                        this._currentlyHighlightedMeshes.push(mesh);
                    } catch {
                        // Safe highlight add
                    }
                }
            }
        }

        // Update floor rings & floating waypoint beacons
        for (const obj of this.objects) {
            const isTarget = obj === closest;
            if (obj.ringMesh) {
                obj.ringMesh.visibility = isTarget ? 1.0 : 0.25;
            }
            if (obj.beaconMesh) {
                obj.beaconMesh.visibility = isTarget ? 0.95 : 0.0;
            }
        }
    }

    /**
     * Clears all active 3D highlights (e.g. when entering a gameplay state)
     */
    public clearHighlight(): void {
        if (this._highlightLayer && this._currentlyHighlightedMeshes.length > 0) {
            for (const m of this._currentlyHighlightedMeshes) {
                try {
                    this._highlightLayer.removeMesh(m);
                } catch {
                    // Safe cleanup
                }
            }
            this._currentlyHighlightedMeshes = [];
        }
        this._highlightedObjectId = null;

        for (const obj of this.objects) {
            if (obj.ringMesh) obj.ringMesh.visibility = 0.25;
            if (obj.beaconMesh) obj.beaconMesh.visibility = 0.0;
        }
    }
}
