/**
 * SEABED VERTEX SHADER
 *
 * Positions the tropical ocean seabed floor beneath the water.
 * The central shallows (r <= 1.2) provide a pristine level sand bed
 * for interactive object physics and caustics, while outer vertices
 * gracefully slope downward into the deep ocean abyss.
 */

uniform float poolHeight;
uniform float poolWidth;
uniform float poolLength;
varying vec3 vPosition;

/**
 * Natural multi-harmonic undersea sand dunes, sandbars, and bathymetric ridges.
 * Gives realistic 3D elevation variation across the ocean seabed floor.
 */
float getSeabedElevation(vec2 p) {
  float dune1 = sin(p.x * 0.14 + p.y * 0.08) * 0.35;
  float dune2 = cos(p.x * 0.07 - p.y * 0.12 + 1.4) * 0.25;
  float dune3 = sin(p.x * 0.32 + p.y * 0.22) * 0.10;
  float dune4 = cos(p.x * 0.55 - p.y * 0.40) * 0.04;
  float terrain = dune1 + dune2 + dune3 + dune4;

  // Continental shelf drop-off into deeper sapphire ocean
  float r = length(p);
  float dropOff = smoothstep(12.0, 65.0, r) * 10.0;
  return terrain - dropOff;
}

void main() {
  // Swizzle from XY plane geometry into horizontal XZ world coordinates
  vPosition = position.xzy;

  // Base floor depth below the water surface modulated by 3D bathymetry
  float depth = poolHeight > 0.0 ? poolHeight : 1.2;
  vPosition.y = -depth + getSeabedElevation(vPosition.xz);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
}
