/**
 * WATER SURFACE VERTEX SHADER (Above View)
 *
 * Displaces vertices across the expansive sea surface.
 * Combines real-time interactive wave simulation ripples (in the central sea)
 * with rhythmic procedural ocean swells across the whole horizon.
 */

uniform sampler2D water;
uniform float time;
uniform float poolWidth;
uniform float poolLength;

varying vec3 vPosition;

void main() {
  vPosition = position.xzy;

  float pWidth = poolWidth > 0.0 ? poolWidth : 1.0;
  float pLength = poolLength > 0.0 ? poolLength : 1.0;

  // Normalized coords for interactive simulation
  vec2 simUv = (vPosition.xz / vec2(pWidth, pLength)) * 0.5 + 0.5;

  // Mask interactive ripples within the central sea area with smooth edge falloff
  vec2 edgeDist = abs(vPosition.xz / vec2(pWidth, pLength));
  float inInteractive = clamp(1.0 - (max(edgeDist.x, edgeDist.y) - 0.75) / 0.25, 0.0, 1.0);

  vec4 info = texture2D(water, clamp(simUv, 0.0, 1.0));

  // Organic ocean swells across the whole sea
  float oceanSwell = sin(vPosition.x * 1.5 + time * 1.7) * 0.018
                   + sin(vPosition.z * 1.8 + time * 2.1 + 1.2) * 0.014
                   + sin((vPosition.x + vPosition.z) * 2.8 - time * 1.4) * 0.009
                   + sin((vPosition.x * 0.8 - vPosition.z * 1.2) * 4.2 + time * 2.5) * 0.005;

  vPosition.y += info.r * inInteractive + oceanSwell;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
}
