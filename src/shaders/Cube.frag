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
uniform float poolWidth;
uniform float poolLength;
uniform float time;
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

// Analytical slope gradient (∂h/∂x, ∂h/∂z) of the 3D seabed dunes
vec2 getSeabedSlope(vec2 p) {
  vec2 d1 = vec2(0.14, 0.08) * (cos(p.x * 0.14 + p.y * 0.08) * 0.35);
  vec2 d2 = vec2(0.07, -0.12) * (-sin(p.x * 0.07 - p.y * 0.12 + 1.4) * 0.25);
  vec2 d3 = vec2(0.32, 0.22) * (cos(p.x * 0.32 + p.y * 0.22) * 0.10);
  vec2 d4 = vec2(0.55, -0.40) * (-sin(p.x * 0.55 - p.y * 0.40) * 0.04);

  float r = max(length(p), 0.001);
  float t = clamp((r - 12.0) / 53.0, 0.0, 1.0);
  float dDrop = (6.0 * t * (1.0 - t) / 53.0) * 10.0;
  vec2 dropSlope = (p / r) * dDrop;

  return (d1 + d2 + d3 + d4) - dropSlope;
}

vec3 getWallColor(vec3 point) {
  // 1. Refracted sunlight illumination direction
  vec3 refractedLight = -refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);

  // 2. Multi-scale tropical coral sand texture sampling
  vec2 uv1 = point.xz * 0.28;
  vec2 uv2 = point.xz * 0.95;
  vec3 sandTex1 = texture2D(tiles, uv1).rgb;
  vec3 sandTex2 = texture2D(tiles, uv2).rgb;
  vec3 seabedColor = mix(sandTex1, sandTex2, 0.45) * vec3(1.05, 0.98, 0.88);

  // 3. Combined macroscopic 3D sand dune slope and microscopic sand ripples
  vec2 terrainSlope = getSeabedSlope(point.xz);
  float rippleAngle = point.x * 2.8 + sin(point.z * 1.6) * 1.2;
  float sandRipple = sin(rippleAngle) * 0.5 + 0.5;
  vec3 normal = normalize(vec3(-terrainSlope.x + cos(rippleAngle) * 0.06, 1.0, -terrainSlope.y + cos(point.z * 1.6) * 0.04));
  seabedColor *= 0.88 + 0.24 * sandRipple;

  float diffuse = max(0.2, dot(refractedLight, normal));

  // 4. Smooth, silky flowing caustic light network on the seabed
  vec2 c1 = point.xz * 1.4 + refractedLight.xz * 0.4 + vec2(time * 0.08, time * 0.06);
  vec2 c2 = point.xz * 2.2 - vec2(time * 0.07, -time * 0.09);
  vec2 c3 = point.xz * 3.6 + vec2(time * 0.11, time * 0.05);

  float caustA = pow(sin(c1.x * 2.4 + sin(c1.y * 2.2)) * 0.5 + 0.5, 2.2);
  float caustB = pow(sin(c2.x * 3.1 + sin(c2.y * 2.7)) * 0.5 + 0.5, 2.2);
  float caustC = pow(sin(c3.x * 4.2 + sin(c3.y * 3.6)) * 0.5 + 0.5, 2.8);
  float causticLight = (caustA * 0.65 + caustB * 0.45 + caustC * 0.25) * 1.6;

  // Modulate caustics with real-time interactive water heightmap
  vec2 simUv = (point.xz / vec2(poolWidth, poolLength)) * 0.5 + 0.5;
  if (simUv.x >= 0.01 && simUv.x <= 0.99 && simUv.y >= 0.01 && simUv.y <= 0.99) {
    vec4 wInfo = texture2D(water, simUv);
    causticLight += clamp(wInfo.r * 8.0, -0.3, 0.8);
  }

  // 5. Physically grounded soft directional shadows on the seabed
  float shadow = 1.0;
  if (sphereEnabled) {
    for (int i = 0; i < MAX_SPHERES; i++) {
      if (i >= sphereCount) break;
      vec3 toFloor = point - sphereCenters[i];
      float distAlongRay = dot(toFloor, refractedLight);
      if (distAlongRay > 0.0) {
        vec3 rayClosest = sphereCenters[i] + refractedLight * distAlongRay;
        float perpDist = length(point - rayClosest) / sphereRadii[i];
        float penumbra = 0.4 + distAlongRay * 0.25;
        float s = smoothstep(0.5, 0.5 + penumbra, perpDist);
        shadow = min(shadow, mix(0.3, 1.0, s));
      }
      float groundDist = length(point - sphereCenters[i]) / sphereRadii[i];
      shadow = min(shadow, mix(0.45, 1.0, smoothstep(0.9, 2.2, groundDist)));
    }
  } else if (cubeEnabled) {
    vec3 toFloor = point - cubeCenter;
    float distAlongRay = dot(toFloor, refractedLight);
    if (distAlongRay > 0.0) {
      vec3 rayClosest = cubeCenter + refractedLight * distAlongRay;
      float perpDist = length((point - rayClosest) / cubeHalfSize);
      shadow = min(shadow, mix(0.3, 1.0, smoothstep(0.6, 1.8, perpDist)));
    }
  }

  // 6. Composite seabed lighting
  float lightIntensity = diffuse * (0.65 + causticLight * shadow) + 0.35;
  lightIntensity *= shadow;

  // 7. Deep Ocean Falloff at outer perimeter
  float distFromCenter = length(point.xz);
  float shallowExtent = max(poolWidth, poolLength);
  float abyssFactor = smoothstep(shallowExtent * 0.85, shallowExtent * 1.5 + 40.0, distFromCenter);
  seabedColor = mix(seabedColor, deepSeaColor, abyssFactor * 0.96);

  return seabedColor * lightIntensity;
}

void main() {
  vec3 color = getWallColor(vPosition);

  // Beer-Lambert underwater absorption: deeper water absorbs red wavelengths first
  float depth = -vPosition.y;
  float extinction = clamp(depth * 0.25, 0.0, 1.0);
  vec3 waterTint = mix(shallowSeaColor, deepSeaColor, extinction);
  color = mix(color, color * waterTint * 1.4, clamp(depth * 0.3, 0.0, 0.85));

  // Blend into deep blue ocean distance fog
  float dist = length(vPosition.xz);
  float shallowExtent = max(poolWidth, poolLength);
  float fog = clamp((dist - (shallowExtent + 15.0)) / 60.0, 0.0, 1.0);
  color = mix(color, deepSeaColor, fog * 0.98);

  gl_FragColor = vec4(color, 1.0);
}
