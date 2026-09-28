export const fp32 = BABYLON.Tools.FloatRound;
export const f32 = BABYLON.Tools.FloatRound;

export class Vector3Float32 extends BABYLON.Vector3 {

    public getClassName(): string {
        return "Vector3Float32";
    }

    public addInPlaceFromFloats(x: number, y: number, z: number): this {
        this.x = fp32(this.x + x);
        this.y = fp32(this.y + y);
        this.z = fp32(this.z + z);
        return this;
    }

    public add(otherVector: any): any {
        return this.addToRef(otherVector, new Vector3Float32(this._x, this._y, this._z));
    }

    public addScalar(scalar: number): this {
        const result = new Vector3Float32(scalar, scalar, scalar);
        return this.addToRef(result, result);
    }

    public addToRef(otherVector: any, result: any): any {
        return result.copyFromFloats(fp32(this._x + otherVector._x), fp32(this._y + otherVector._y), fp32(this._z + otherVector._z));
    }

    public subtractInPlace(otherVector: any): any {
        this.x = fp32(this.x - otherVector._x);
        this.y = fp32(this.y - otherVector._y);
        this.z = fp32(this.z - otherVector._z);
        return this;
    }

    public subtract(otherVector: any): any {
        return new Vector3Float32(this._x, this._y, this._z).subtractInPlace(otherVector);
    }

    public subtractToRef(otherVector: any, result: any): any {
        return this.subtractFromFloatsToRef(otherVector._x, otherVector._y, otherVector._z, result);
    }

    public subtractFromFloats(x: number, y: number, z: number): this {
        return this.subtractFromFloatsToRef(x, y, z, new Vector3Float32(this._x, this._y, this._z));
    }

    public subtractFromFloatsToRef(x: number, y: number, z: number, result: any): any {
        return result.copyFromFloats(fp32(this._x - x), fp32(this._y - y), fp32(this._z - z));
    }

    public scaleInPlace(scale: number): this {
        this.x = fp32(this.x * scale);
        this.y = fp32(this.y * scale);
        this.z = fp32(this.z * scale);
        return this;
    }

    public scale(scale: number): any {
        return new Vector3Float32(this._x, this._y, this._z).scaleInPlace(scale);
    }

    public scaleToRef(scale: number, result: any): any {
        return result.copyFromFloats(fp32(this._x * scale), fp32(this._y * scale), fp32(this._z * scale));
    }

    public scaleAndAddToRef(scale: number, result: any): any {
        return result.addInPlaceFromFloats(fp32(this._x * scale), fp32(this._y * scale), fp32(this._z * scale));
    }

    public multiplyInPlace(otherVector: BABYLON.DeepImmutable<any>): this {
        this.x = fp32(this.x * otherVector._x);
        this.y = fp32(this.y * otherVector._y);
        this.z = fp32(this.z * otherVector._z);
        return this;
    }

    public multiply(otherVector: BABYLON.DeepImmutable<any>): this {
        return this.multiplyByFloats(otherVector._x, otherVector._y, otherVector._z);
    }

    public multiplyToRef(otherVector: BABYLON.DeepImmutable<any>, result: any): any {
        return result.copyFromFloats(fp32(this._x * otherVector._x), fp32(this._y * otherVector._y), fp32(this._z * otherVector._z));
    }

    public multiplyByFloats(x: number, y: number, z: number): this {
        const result = new Vector3Float32(x, y, z);
        return this.multiplyToRef(result, result);
    }

    public divide(otherVector: BABYLON.DeepImmutable<any>): this {
        return this.divideToRef(otherVector, new Vector3Float32());
    }

    public divideToRef(otherVector: BABYLON.DeepImmutable<any>, result: any): any {
        return result.copyFromFloats(fp32(this._x / otherVector._x), fp32(this._y / otherVector._y), fp32(this._z / otherVector._z));
    }

    public divideInPlace(otherVector: any): this {
        return this.divideToRef(otherVector, this);
    }

    public pow(otherVector: BABYLON.DeepImmutable<any>): any {
        const result = new Vector3Float32();
        result.x = fp32(Math.pow(this._x, otherVector._x));
        result.y = fp32(Math.pow(this._y, otherVector._y));
        result.z = fp32(Math.pow(this._z, otherVector._z));
        return result;
    }

    public length(): number {
        return fp32(Math.sqrt(fp32(fp32(fp32(this._x * this._x) + fp32(this._y * this._y)) + fp32(this._z * this._z))));
    }

    public lengthSquared(): number {
        return fp32(fp32(fp32(this._x * this._x) + fp32(this._y * this._y)) + fp32(this._z * this._z));
    }

    public normalize(): this {
        return this.normalizeFromLength(this.length());
    }

    public normalizeFromLength(len: number): this {
        if (len === 0 || len === 1.0) {
            return this;
        }

        return this.scaleInPlace(fp32(1.0 / len));
    }

    public normalizeToNew(): any {
        const normalized = new Vector3Float32(0, 0, 0);
        this.normalizeToRef(normalized);
        return normalized;
    }

    public normalizeToRef(reference: any): any {
        const len = this.length();
        if (len === 0 || len === 1.0) {
            return reference.copyFromFloats(this._x, this._y, this._z);
        }

        return this.scaleToRef(fp32(1.0 / len), reference);
    }

    public copyFromFloats(x: number, y: number, z: number): this {
        this.x = x;
        this.y = y;
        this.z = z;
        return this;
    }

    public static Lerp(start: BABYLON.DeepImmutable<any>, end: BABYLON.DeepImmutable<any>, amount: number): any {
        var result = new Vector3Float32(0, 0, 0);
        Vector3Float32.LerpToRef(start, end, amount, result);
        return result;
    }

    public static LerpToRef(start: any, end: any, amount: number, result: any): any {
        result.x = fp32(start._x + fp32(fp32(end._x - start._x) * amount));
        result.y = fp32(start._y + fp32(fp32(end._y - start._y) * amount));
        result.z = fp32(start._z + fp32(fp32(end._z - start._z) * amount));
        return result;
    }

    public static Dot(left: BABYLON.DeepImmutable<any>, right: BABYLON.DeepImmutable<any>): number {
        return fp32(fp32(fp32(left._x * right._x) + fp32(left._y * right._y)) + fp32(left._z * right._z));
    }

    public static ToFloat32(source: BABYLON.DeepImmutable<BABYLON.Vector3>, destination: any): void {
        destination.set(fp32(source.x), fp32(source.y), fp32(source.z));
    }
}

// SkyMaterial prototype monkey patch for getSunColor
const PI = f32(Math.PI);
const sunPosition = new Vector3Float32();
const sunDirection = new Vector3Float32();
const up = new Vector3Float32();
const temp1 = new Vector3Float32();
const temp2 = new Vector3Float32();
const temp3 = new Vector3Float32();
const EE = f32(1000.0);
const cutoffAngle = f32(PI / f32(1.95));
const steepness = f32(1.5);
const v = f32(4.0);
const TwoPI = f32(2.0 * PI);
const lambda = new Vector3Float32(f32(680E-9), f32(550E-9), f32(450E-9));
const K = new Vector3Float32(f32(0.686), f32(0.678), f32(0.666));
const rayleighZenithLength = f32(8.4E3);
const mieZenithLength = f32(1.25E3);
const unitVec = new Vector3Float32(f32(1), f32(1), f32(1));
const oneAndHalfVec = new Vector3Float32(f32(1.5), f32(1.5), f32(1.5));
const halfOneVec = new Vector3Float32(f32(0.5), f32(0.5), f32(0.5));
const tenthVec = new Vector3Float32(f32(0.1), f32(0.1), f32(0.1));
const texColorCst = new Vector3Float32(f32(f32(0.0) * f32(0.3)), f32(f32(0.001) * f32(0.3)), f32(f32(0.0025) * f32(0.3)));

(BABYLON.SkyMaterial.prototype as any).getSunColor = function() {
    const sunIntensity = (zenithAngleCos: number) => {
	    return f32(EE * Math.max(0.0, f32(1.0 - f32(Math.exp((-f32(cutoffAngle - f32(Math.acos(zenithAngleCos)))/f32(steepness)))))));
    };

    const simplifiedRayleigh = () => {
        const c = f32(0.0005);
        temp1.set(f32(c / 94), f32(c / 40), f32(c / 18));
        return temp1;
    };

    const totalMie = (_lambda: Vector3Float32, _K: Vector3Float32, T: number) => {
        const c = f32(f32((f32(0.2) * T)) * f32(10E-18));
        const p = f32(v - 2.0);
        const m = f32(f32(f32(0.434) * c) * PI);
        temp2.set(
            f32(f32(m * f32(Math.pow(f32(TwoPI / _lambda.x), p))) * f32(_K.x)),
            f32(f32(m * f32(Math.pow(f32(TwoPI / _lambda.y), p))) * f32(_K.y)),
            f32(f32(m * f32(Math.pow(f32(TwoPI / _lambda.z), p))) * f32(_K.z))
        );
        return temp2;
    };

    const rayleighPhase = (cosTheta: number) => {	 
        return f32(f32(3.0 / f32(16.0 * PI)) * f32(1.0 + f32(Math.pow(cosTheta, 2.0))));
    };

    const hgPhase = (cosTheta: number, g: number) => {
        return f32(f32(1.0 / f32(4.0 * PI)) * f32((f32(1.0 - f32(Math.pow(g, 2.0))) / f32(Math.pow(1.0 - f32(f32(2.0 * g) * cosTheta) + f32(Math.pow(g, 2.0)), 1.5)))));
    };

    const A = f32(0.15);
    const B = f32(0.50);
    const C = f32(0.10);
    const D = f32(0.20);
    const EEE = f32(0.02);
    const F = f32(0.30);
    const W = new Vector3Float32(f32(1000.0), f32(1000.0), f32(1000.0));

    const Uncharted2Tonemap = (x: Vector3Float32) => {
        const c1 = x.scale(A).addScalar(f32(C * B));
        const c2 = x.scale(A).addScalar(B);
        const c3 = x.multiply(c1).addScalar(f32(D * EEE));
        const c4 = x.multiply(c2).addScalar(f32(D * F));
        return c3.divide(c4).addScalar(-f32(EEE / F));
    };

    Vector3Float32.ToFloat32(this.sunPosition, sunPosition);
    Vector3Float32.ToFloat32(this.up, up);

	const sunfade = f32(1.0 - BABYLON.Scalar.Clamp(f32(1.0 - f32(Math.exp(f32(sunPosition.y / 450000.0)))), 0.0, 1.0));
	const rayleighCoefficient = f32(f32(this.rayleigh) - (1.0 * f32(1.0 - sunfade)));

    sunPosition.normalizeToRef(sunDirection);

	const sunE = sunIntensity(Vector3Float32.Dot(sunDirection, up));
	const betaR = simplifiedRayleigh().scale(rayleighCoefficient);
	const betaM = totalMie(lambda, K, f32(this.turbidity)).scale(f32(this.mieCoefficient));

	const zenithAngle = f32(Math.acos(Math.max(0.0, sunDirection.y)));

	const sR = f32(rayleighZenithLength / f32(f32(Math.cos(zenithAngle)) +
        f32(f32(0.15) * f32(Math.pow(f32(f32(93.885) - f32(f32(zenithAngle * 180.0) / PI)), f32(-1.253))))));

	const sM = f32(mieZenithLength / (f32(Math.cos(zenithAngle)) +
        f32(f32(0.15) * f32(Math.pow(f32(f32(93.885) - f32(f32(zenithAngle * 180.0) / PI)), f32(-1.253))))));

	const Fex = betaR.scale(sR).add(betaM.scale(sM));
    Fex.set(f32(Math.exp(-Fex.x)), f32(Math.exp(-Fex.y)), f32(Math.exp(-Fex.z)));

	const cosTheta = 1.0;
	const rPhase = rayleighPhase(cosTheta * 0.5 + 0.5);
	const mPhase = hgPhase(cosTheta, f32(this.mieDirectionalG));
	const betaRTheta = betaR.scale(rPhase);
	const betaMTheta = betaM.scale(mPhase);
	
    const f1 = betaRTheta.add(betaMTheta).divide(betaR.add(betaM)).scale(sunE);
    let Lin = f1.multiply(unitVec.subtract(Fex)).pow(oneAndHalfVec);

    const l1 = f1.multiply(Fex).pow(halfOneVec);
    const l2 = BABYLON.Scalar.Clamp(f32(Math.pow(f32(1.0 - Vector3Float32.Dot(up, sunDirection)), 5.0)), 0, 1);

	Lin = Lin.multiply(Vector3Float32.Lerp(unitVec, l1, l2));

    const L0 = tenthVec.multiply(Fex);
	L0.addInPlace(Fex.scale(f32(sunE * 19000.0)));

    const whiteScale = unitVec.divide(Uncharted2Tonemap(W));
    const texColor = Lin.add(L0).scale(f32(0.04)).add(texColorCst);

    const curr = Uncharted2Tonemap(texColor.scale(f32(Math.log2(f32(2.0 / f32(Math.pow(this.luminance, 4.0)))))));

    Vector3Float32.ClampToRef(curr.multiply(whiteScale), halfOneVec, unitVec, temp3);

    const retColor = new BABYLON.Color3(temp3.x, temp3.y, temp3.z);

    return retColor;
};
