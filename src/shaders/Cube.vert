/**
 * SEABED VERTEX SHADER
 *
 * Positions the tropical ocean seabed floor beneath the water.
 * The central shallows (r <= 1.2) provide a pristine level sand bed
 * for interactive object physics and caustics, while outer vertices
 * gracefully slope downward into the deep ocean abyss.
 */

uniform float poolHeight;
varying vec3 vPosition;

void main() {
  // Swizzle from XY plane geometry into horizontal XZ world coordinates
  vPosition = position.xzy;

  // Base floor depth below the water surface
  float depth = poolHeight > 0.0 ? poolHeight : 1.0;
  vPosition.y = -depth;

  // Gentle continental shelf drop-off into deep ocean
  float r = length(vPosition.xz);
  vPosition.y -= smoothstep(1.2, 7.0, r) * 2.0;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
}
