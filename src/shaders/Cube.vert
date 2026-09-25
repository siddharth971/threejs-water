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

void main() {
  // Swizzle from XY plane geometry into horizontal XZ world coordinates
  vPosition = position.xzy;

  // Base floor depth below the water surface
  float depth = poolHeight > 0.0 ? poolHeight : 1.0;
  vPosition.y = -depth;

  // Gentle continental shelf drop-off into deep ocean starting beyond the shallow sea area
  float shallowRadius = max(poolWidth, poolLength);
  if (shallowRadius < 1.0) shallowRadius = 1.0;
  float r = length(vPosition.xz);
  vPosition.y -= smoothstep(shallowRadius * 0.9, shallowRadius * 1.5 + 40.0, r) * 10.0;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
}
