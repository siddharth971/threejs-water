export interface BuoyancyFrame {
    v1: BABYLON.Vector3;
    v2?: BABYLON.Vector3;
    v3?: BABYLON.Vector3;
}

export interface MeshBuoyancy {
    mesh: BABYLON.TransformNode;
    frame: BuoyancyFrame;
    yOffset: number;
    spaceCoordinates: number;
    initQuaternion: BABYLON.Quaternion;
    smoothedY: number;
    hasSampledHeight: boolean;
}

export class Buoyancy {

    private _size: number;
    private _displacementMap: BABYLON.Nullable<Uint16Array>;
    private _lengthScale: number;
    private _meshes: MeshBuoyancy[];
    private _numSteps: number;
    private _attenuation: number;
    private readonly _waveTiltQuat = new BABYLON.Quaternion();
    private readonly _targetRotQuat = new BABYLON.Quaternion();

    public enabled = true;

    constructor(size: number, numSteps: number = 5, attenuation: number = 1) {
        this._size = size;
        this._displacementMap = null;
        this._lengthScale = 0;
        this._numSteps = numSteps;
        this._attenuation = attenuation;
        this._meshes = [];
    }

    public setWaterHeightMap(map: BABYLON.Nullable<Uint16Array>, lengthScale: number): void {
        this._displacementMap = map;
        this._lengthScale = lengthScale;
    }

    public addMesh(mesh: BABYLON.TransformNode, frame: BuoyancyFrame, yOffset = 0, spaceCoordinates = 0): void {
        this._meshes.push({
            mesh,
            frame,
            yOffset,
            spaceCoordinates,
            initQuaternion: mesh.rotationQuaternion!.clone(),
            smoothedY: mesh.position.y,
            hasSampledHeight: false,
        });
    }

    public rotateMeshYaw(mesh: BABYLON.TransformNode, deltaYaw: number): void {
        const item = this._meshes.find(m => m.mesh === mesh);
        if (item) {
            const rot = BABYLON.Quaternion.FromEulerAngles(0, deltaYaw, 0);
            item.initQuaternion.multiplyToRef(rot, item.initQuaternion);
        }
    }

    public set size(size: number) {
        this._size = size;
    }

    public get attenuation() {
        return this._attenuation;
    }

    public set attenuation(val: number) {
        this._attenuation = val;
    }

    public get numSteps() {
        return this._numSteps;
    }

    public set numSteps(val: number) {
        this._numSteps = val;
    }

    public update(dt = 1 / 60): void {
        if (!this.enabled) {
            return;
        }

        const clampedDt = Math.min(0.05, Math.max(0.001, dt));
        for (let i = 0; i < this._meshes.length; ++i) {
            this._updateMesh(this._meshes[i], clampedDt);
        }
    }

    public getWaterHeight(position: BABYLON.Vector3): number {
        const tmp = BABYLON.TmpVectors.Vector3[0];
        const steps = Math.max(1, this._numSteps);

        this._getWaterDisplacement(position, tmp);
        for (let i = 1; i < steps; ++i) {
            position.subtractToRef(tmp, tmp);
            this._getWaterDisplacement(position, tmp);
        }

        return Number.isFinite(tmp.y) ? tmp.y : 0;
    }

    private _updateMesh(meshBuoyancy: MeshBuoyancy, dt: number): void {
        const tmp = BABYLON.TmpVectors.Vector3[5];
        const tmp2 = BABYLON.TmpVectors.Vector3[6];
        const tmp3 = BABYLON.TmpVectors.Vector3[7];

        const { mesh, frame, yOffset, spaceCoordinates, initQuaternion } = meshBuoyancy;
        const worldMatrix = mesh.getWorldMatrix();

        BABYLON.Vector3.TransformCoordinatesToRef(frame.v1, worldMatrix, tmp);

        const y = this.getWaterHeight(tmp);
        if (!Number.isFinite(y)) {
            return;
        }
        const targetY = y + yOffset;

        if (!meshBuoyancy.hasSampledHeight && this._displacementMap) {
            meshBuoyancy.smoothedY = targetY;
            meshBuoyancy.hasSampledHeight = true;
        } else {
            const ySmooth = 1.0 - Math.exp(-8.5 * dt);
            meshBuoyancy.smoothedY = BABYLON.Scalar.Lerp(meshBuoyancy.smoothedY, targetY, ySmooth);
        }

        mesh.position.y = meshBuoyancy.smoothedY;

        if (frame.v2 && frame.v3) {
            BABYLON.Vector3.TransformCoordinatesToRef(frame.v2, worldMatrix, tmp2);
            BABYLON.Vector3.TransformCoordinatesToRef(frame.v3, worldMatrix, tmp3);

            const yForward = this.getWaterHeight(tmp2);
            const yRight = this.getWaterHeight(tmp3);

            const dxForward = tmp2.x - tmp.x;
            const dzForward = tmp2.z - tmp.z;
            const distForward = Math.max(0.5, Math.hypot(dxForward, dzForward));

            const dxRight = tmp3.x - tmp.x;
            const dzRight = tmp3.z - tmp.z;
            const distRight = Math.max(0.5, Math.hypot(dxRight, dzRight));

            const pitch = Math.atan2(yForward - y, distForward) * this._attenuation;
            const roll = Math.atan2(yRight - y, distRight) * this._attenuation;

            if (spaceCoordinates === 0) {
                BABYLON.Quaternion.FromEulerAnglesToRef(-pitch, roll, 0, this._waveTiltQuat);
            } else {
                BABYLON.Quaternion.FromEulerAnglesToRef(-pitch, 0, roll, this._waveTiltQuat);
            }

            initQuaternion.multiplyToRef(this._waveTiltQuat, this._targetRotQuat);
            const rotSmooth = 1.0 - Math.exp(-5.0 * dt);
            BABYLON.Quaternion.SlerpToRef(mesh.rotationQuaternion!, this._targetRotQuat, rotSmooth, mesh.rotationQuaternion!);
        }

        mesh.computeWorldMatrix(true);
    }

    private _getWaterDisplacement(position: BABYLON.Vector3, result: BABYLON.Vector3): void {
        if (!this._displacementMap) {
            result.set(position.x, position.y, position.z);
            return;
        }

        const mask = this._size - 1;

        const x = (position.x / this._lengthScale) * this._size;
        const z = (position.z / this._lengthScale) * this._size;

        const v0 = BABYLON.TmpVectors.Vector3[1];
        const v1 = BABYLON.TmpVectors.Vector3[2];
        const vA = BABYLON.TmpVectors.Vector3[3];
        const vB = BABYLON.TmpVectors.Vector3[4];

        let v0x = Math.floor(x);
        let v0z = Math.floor(z);

        const xRatio = x - v0x;
        const zRatio = z - v0z;

        v0x = v0x & mask;
        v0z = v0z & mask;

        this._getDisplacement(v0x, v0z, v0);
        this._getDisplacement((v0x + 1) & mask, v0z, v1);

        v1.subtractToRef(v0, vA).scaleToRef(xRatio, vA).addToRef(v0, vA);

        this._getDisplacement(v0x, (v0z + 1) & mask, v0);
        this._getDisplacement((v0x + 1) & mask, (v0z + 1) & mask, v1);

        v1.subtractToRef(v0, vB).scaleToRef(xRatio, vB).addToRef(v0, vB);

        vB.subtractToRef(vA, result).scaleToRef(zRatio, result).addToRef(vA, result);
    }

    private _getDisplacement(x: number, z: number, result: BABYLON.Vector3): void {
        if (this._displacementMap) {
            result.x = BABYLON.TextureTools.FromHalfFloat(this._displacementMap[z * this._size * 4 + x * 4 + 0]);
            result.y = BABYLON.TextureTools.FromHalfFloat(this._displacementMap[z * this._size * 4 + x * 4 + 1]);
            result.z = BABYLON.TextureTools.FromHalfFloat(this._displacementMap[z * this._size * 4 + x * 4 + 2]);
        }
    }
}
