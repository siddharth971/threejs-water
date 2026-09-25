precision highp float;

/**
 * SPHERE OBJECT FRAGMENT SHADER
 *
 * Renders the interactive sphere object floating in the sea.
 *
 * LIGHTING MODEL:
 * 1. Base diffuse color (bright marine buoy)
 * 2. Environment cubemap reflection with Fresnel
 * 3. Diffuse lighting from sunlight / refracted sunlight
 * 4. Caustic patterns when submerged
 * 5. Underwater color tinting
 */

// Optical constants for Snell's Law
const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;

// Blue-green tint for underwater light absorption
const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);

// Light direction (normalized, pointing toward sun)
uniform vec3 light;

// Varyings passed from vertex shader
varying vec3 vSphereCenter;
varying float vSphereRadius;

// Pool dimensions for coordinate scaling
uniform float poolWidth;
uniform float poolHeight;
uniform float poolLength;

// Simulation textures
uniform sampler2D water;      // Wave heightmap (R = height)
uniform sampler2D causticTex; // Caustic light intensity map
uniform samplerCube sky;      // Sky environment cubemap for reflections

varying vec3 vPosition; // World-space fragment position

/**
 * Calculates shading and illumination for the sphere obstacle.
 * Uses sky cubemap reflections with Fresnel blending for a realistic glossy look.
 */
vec3 getSphereColor(vec3 point) {
  // Base sphere albedo color: clean bright marine buoy sphere
  vec3 color = vec3(0.92, 0.93, 0.95);

  // Surface normal of the sphere at this point
  vec3 sphereNormal = normalize((point - vSphereCenter) / vSphereRadius);

  // Sample local water displacement height
  vec4 info = texture2D(water, point.xz * vec2(0.5 / poolWidth, 0.5 / poolLength) + 0.5);
  bool isUnderwater = point.y < info.r;

  // Refracted light direction vector as it passes from air into water
  vec3 refractedLight = -refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  vec3 activeLight = isUnderwater ? refractedLight : light;

  // Calculate diffuse reflection
  float diffuse = max(0.12, dot(activeLight, sphereNormal));

  if (isUnderwater) {
    // If the sphere fragment is submerged, project caustics from the water surface
    vec4 caustic = texture2D(
      causticTex,
      0.75 *
        (point.xz - point.y * refractedLight.xz / refractedLight.y) *
        vec2(0.5 / poolWidth, 0.5 / poolLength) +
        0.5
    );
    diffuse *= (0.7 + caustic.r * 2.2);
    color = color * diffuse * underwaterColor;

    // Subtle underwater sky tint through refracted reflection
    vec3 viewDir = normalize(cameraPosition - point);
    vec3 refractRefl = reflect(-viewDir, sphereNormal);
    vec3 skyRef = textureCube(sky, refractRefl).rgb;
    color += skyRef * 0.06;
  } else {
    // Above water: direct sunlight illumination + sky environment reflection
    vec3 viewDir = normalize(cameraPosition - point);

    // Fresnel: more reflection at grazing angles
    float fresnel = mix(0.04, 1.0, pow(1.0 - max(0.0, dot(sphereNormal, viewDir)), 5.0));

    // Sky cubemap reflection
    vec3 reflectDir = reflect(-viewDir, sphereNormal);
    vec3 skyReflection = textureCube(sky, reflectDir).rgb;

    // Sun specular highlight
    vec3 halfVec = normalize(light + viewDir);
    float spec = pow(max(0.0, dot(sphereNormal, halfVec)), 64.0);

    // Blend diffuse base with sky reflection via Fresnel
    vec3 diffuseColor = color * (diffuse * 0.8 + 0.28);
    color = mix(diffuseColor, skyReflection, fresnel * 0.65) + vec3(spec * 0.9);
  }

  return color;
}

void main() {
  gl_FragColor = vec4(getSphereColor(vPosition), 1.0);
}

