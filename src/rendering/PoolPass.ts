/**
 * @file PoolPass.ts
 * @description Manages rendering the physical seabed floor under the water.
 * Projects the generated caustic texture onto the sandy seabed and calculates
 * depth extinction and ambient occlusion from submerged obstacles.
 */

import * as THREE from 'three';
import type { Water } from '../Water';
import poolVert from '../shaders/Cube.vert';
import poolFrag from '../shaders/Cube.frag';
import type { WaterOpticsState } from './WaterOpticsState';

/**
 * Handles the geometry and materials needed to render the tropical seabed floor.
 */
export class PoolPass {
  /** The 3D Mesh representing the ocean seabed. */
  readonly mesh: THREE.Mesh;
  /** Static geometry for the wide seabed floor. */
  private readonly boxGeometry: THREE.BufferGeometry;
  /** Material shader for the seabed. */
  private readonly boxMaterial: THREE.ShaderMaterial;

  /**
   * Constructs the PoolPass for the seabed.
   *
   * @param tileTexture The base repeating texture representing tropical sand.
   * @param causticTexture The dynamic caustic map texture.
   * @param state The state tracking objects inside the water.
   */
  constructor(
    tileTexture: THREE.Texture,
    causticTexture: THREE.Texture,
    private readonly state: WaterOpticsState
  ) {
    this.boxMaterial = new THREE.ShaderMaterial({
      vertexShader: poolVert,
      fragmentShader: poolFrag,
      uniforms: {
        light: { value: state.lightDirection.clone() },
        ...state.createUniforms(),
        tiles: { value: tileTexture },
        causticTex: { value: causticTexture },
        water: { value: null },
        poolHeight: { value: 1.0 },
        poolWidth: { value: 10.0 },
        poolLength: { value: 10.0 },
      },
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });

    this.boxGeometry = this.createGeometry();
    this.mesh = new THREE.Mesh(this.boxGeometry, this.boxMaterial);
    this.mesh.frustumCulled = false;
  }

  /**
   * Adjusts the seabed geometry and material properties.
   *
   * @param _shape The shape description.
   * @param _cornerRadius Corner radius.
   * @param poolWidth The half-width of the sea.
   * @param poolHeight The depth of the seabed.
   * @param poolLength The half-length of the sea.
   */
  setPoolShape(
    _shape: string,
    _cornerRadius: number,
    poolWidth: number,
    poolHeight: number,
    poolLength: number
  ) {
    this.boxMaterial.uniforms.poolHeight.value = poolHeight;
    this.boxMaterial.uniforms.poolWidth.value = poolWidth;
    this.boxMaterial.uniforms.poolLength.value = poolLength;
    this.mesh.geometry = this.boxGeometry;
    this.mesh.material = this.boxMaterial;
  }

  /**
   * Prepares the active seabed material uniforms prior to rendering the scene.
   * Copies current water texture, light vectors, and optical state variables.
   *
   * @param water The Water simulation instance.
   */
  prepare(water: Water) {
    const activeMaterial = this.mesh.material as THREE.ShaderMaterial;
    activeMaterial.uniforms.water.value = water.textureA.texture;
    activeMaterial.uniforms.light.value.copy(this.state.lightDirection);
    this.state.syncUniforms(activeMaterial);
    activeMaterial.uniformsNeedUpdate = true;
  }

  /**
   * Generates a wide planar seabed geometry.
   */
  private createGeometry() {
    return new THREE.PlaneGeometry(600, 600, 96, 96);
  }
}
