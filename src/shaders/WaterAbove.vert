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

// Directional ocean swell displacement (smooth, long-wavelength tropical swells)
float getOceanSwell(vec2 p, float t) {
  float w1 = sin(dot(p, vec2(0.24, 0.14)) - t * 0.85) * 0.032;
  float w2 = sin(dot(p, vec2(-0.16, 0.30)) - t * 1.05 + 1.2) * 0.020;
  float w3 = sin(dot(p, vec2(0.35, -0.22)) - t * 1.35 + 2.4) * 0.012;
  float w4 = sin(dot(p, vec2(0.55, 0.45)) - t * 1.8 + 0.5) * 0.006;
  return w1 + w2 + w3 + w4;
}

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

  float oceanSwell = getOceanSwell(vPosition.xz, time);

  vPosition.y += info.r * inInteractive + oceanSwell;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
}
