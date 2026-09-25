precision highp float;

/**
 * TROPICAL SEABED FRAGMENT SHADER
 *
 * Renders the sandy ocean floor with:
 * - High-detail tropical coral sand texture with multi-scale blending
 * - Organic underwater sand ripple shading and micro-relief
 * - Real-time refracted caustic patterns dancing on the sand
 * - Soft ambient occlusion shadows from submerged objects
 * - Physically inspired tropical sea water depth absorption (Beer-Lambert)
 * - Seamless fade into deep oceanic abyss at the perimeter
 */

// Optical constants
const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;

// Tropical water tinting
const vec3 shallowSeaColor = vec3(0.08, 0.82, 0.86);
const vec3 deepSeaColor = vec3(0.01, 0.08, 0.22);
const float torusKnotShadowRadius = 0.13;

// Scene uniforms
uniform vec3 light; // Light direction (toward sun)
uniform float poolHeight;
#define MAX_SPHERES 10
uniform vec3 sphereCenters[MAX_SPHERES];
uniform float sphereRadii[MAX_SPHERES];
uniform int sphereCount;
uniform bool sphereEnabled;
uniform vec3 cubeCenter;
uniform vec3 cubeHalfSize;
uniform bool cubeEnabled;
#define MAX_TORUS_KNOTS 10
uniform vec3 torusKnotCenters[MAX_TORUS_KNOTS];
uniform int torusKnotCount;
uniform bool torusKnotEnabled;
#define MAX_MESHES 10
uniform vec3 meshCenters[MAX_MESHES];
uniform int meshCount;
uniform float meshBoundingRadius;
uniform float meshShadowRadius;
uniform bool meshEnabled;
uniform sampler2D tiles; // Seabed sand texture
uniform sampler2D causticTex; // Dynamic caustic light map
uniform sampler2D water; // Water simulation heightmap

varying vec3 vPosition; // World-space position from vertex shader

vec3 getWallColor(vec3 point) {
  float scale = 0.65; // Base brightness multiplier

  // 1. Procedural sand ripple normal perturbation
  float rippleAngle = point.x * 10.0 + sin(point.z * 5.0) * 1.8;
  float sandRipple = sin(rippleAngle) * 0.5 + 0.5;
  vec3 normal = normalize(vec3(
    cos(rippleAngle) * 0.08,
    1.0,
    cos(point.z * 5.0) * 0.05
  ));

  // 2. Multi-scale dual texture sampling to avoid repetitive tiling
  vec2 uv1 = point.xz * 0.45 + vec2(0.5, 0.5);
  vec2 uv2 = point.xz * 1.8 + vec2(0.2, 0.7);
  vec3 sandTex1 = texture2D(tiles, uv1).rgb;
  vec3 sandTex2 = texture2D(tiles, uv2).rgb;
  vec3 seabedColor = mix(sandTex1, sandTex2, 0.35) * (0.85 + 0.3 * sandRipple);

  // Warm tropical coral sand tone
  seabedColor *= vec3(1.04, 0.98, 0.88);

  // 3. Proximity-based ambient occlusion from floating/submerged objects
  if (sphereEnabled) {
    for (int i = 0; i < MAX_SPHERES; i++) {
      if (i >= sphereCount) break;
      scale *= 1.0 - 0.6 / pow(max(length(point - sphereCenters[i]) / sphereRadii[i], 1.0), 4.0);
    }
  } else if (cubeEnabled) {
    float cubeDistance = length((point - cubeCenter) / cubeHalfSize);
    scale *= 1.0 - 0.6 / pow(max(cubeDistance, 1.0), 4.0);
  } else if (torusKnotEnabled) {
    for (int i = 0; i < MAX_TORUS_KNOTS; i++) {
      if (i >= torusKnotCount) break;
      float knotDistance = length(point - torusKnotCenters[i]);
      scale *= 1.0 - 0.6 / pow(max(knotDistance / torusKnotShadowRadius, 1.0), 4.0);
    }
  } else if (meshEnabled) {
    for (int i = 0; i < MAX_MESHES; i++) {
      if (i >= meshCount) break;
      float meshDistance = length(point - meshCenters[i]);
      scale *= 1.0 - 0.6 / pow(max(meshDistance / meshShadowRadius, 1.0), 4.0);
    }
  }

  // 4. Refracted sunlight illumination
  vec3 refractedLight = -refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  float diffuse = max(0.0, dot(refractedLight, normal));

  // 5. Dynamic Caustics Projection onto the seabed
  // Sample caustics with slant compensation for light angle
  vec2 causticCoord = 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5;
  vec4 caustic = texture2D(causticTex, causticCoord);

  // Smooth caustic fade at edges of interactive area
  float causticMask = clamp(1.0 - (length(point.xz) - 0.8) / 0.4, 0.0, 1.0);
  scale += diffuse * (caustic.r * 3.2 * caustic.g) * causticMask;
  scale += diffuse * 0.4; // Ambient sea floor bounce

  // 6. Deep Ocean Falloff at outer perimeter
  float distFromCenter = length(point.xz);
  float abyssFactor = clamp((distFromCenter - 1.2) / 4.5, 0.0, 1.0);
  seabedColor = mix(seabedColor, deepSeaColor, abyssFactor * 0.95);

  return seabedColor * scale;
}

void main() {
  vec3 color = getWallColor(vPosition);

  // Beer-Lambert underwater absorption: deeper water absorbs red wavelengths first
  float depth = -vPosition.y;
  float extinction = clamp(depth * 0.35, 0.0, 1.0);
  vec3 waterTint = mix(shallowSeaColor, deepSeaColor, extinction);
  color = mix(color, color * waterTint * 1.5, clamp(depth * 0.4, 0.0, 0.85));

  // Blend into deep blue ocean distance fog
  float dist = length(vPosition.xz);
  float fog = clamp((dist - 1.5) / 5.0, 0.0, 1.0);
  color = mix(color, deepSeaColor, fog * 0.9);

  gl_FragColor = vec4(color, 1.0);
}
