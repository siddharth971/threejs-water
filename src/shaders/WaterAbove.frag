precision highp float;

/**
 * WATER SURFACE FRAGMENT SHADER (View from Above)
 *
 * This shader renders the water surface as seen from above, implementing:
 * 1. Fresnel reflectance - how much light reflects vs refracts based on angle
 * 2. Parallax displacement - finding the correct water height at each pixel
 * 3. Ray tracing - following reflected/refracted rays to find colors
 * 4. Caustic integration - adding underwater light patterns
 *
 * The water surface acts as an interface between two media (air and water),
 * governed by Snell's Law for refraction and Fresnel equations for reflectance.
 */

// Index of Refraction constants
const float IOR_AIR = 1.0; // n₁: air (approximately vacuum)
const float IOR_WATER = 1.333; // n₂: water at 20°C for visible light

// Tropical water tinting colors for light absorption simulation (Beer's Law)
const vec3 abovewaterColor = vec3(0.08, 0.85, 0.88); // Crystal turquoise surface tint
const vec3 underwaterColor = vec3(0.04, 0.75, 0.82); // Underwater ambient tint

uniform float poolHeight; // Seabed depth
const float torusKnotShadowRadius = 0.13; // Shadow falloff radius for torus knot

uniform vec3 light;
#define MAX_SPHERES 10
uniform vec3 sphereCenters[MAX_SPHERES];
uniform float sphereRadii[MAX_SPHERES];
uniform int sphereCount;
uniform bool sphereEnabled;
#define MAX_CUBES 10
uniform vec3 cubeCenters[MAX_CUBES];
uniform vec3 cubeHalfSizes[MAX_CUBES];
uniform int cubeCount;
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
uniform sampler2D tiles;
uniform sampler2D causticTex;
uniform sampler2D objectReflectionTex;
uniform sampler2D objectClippedReflectionTex;
uniform sampler2D objectRefractionTex;
uniform sampler2D water;
uniform samplerCube sky;
uniform vec3 eye;
uniform mat4 viewProjectionMatrix;
uniform mat4 reflectionViewProjectionMatrix;

varying vec3 vPosition;

uniform float poolWidth;
uniform float poolLength;
uniform float time;
#include "./MeshWaterOptics.glsl"

/**
 * Calculates intersections of a ray with the pool bounding box limits.
 */
vec2 intersectCube(vec3 origin, vec3 ray, vec3 cubeMin, vec3 cubeMax) {
  vec3 tMin = (cubeMin - origin) / ray;
  vec3 tMax = (cubeMax - origin) / ray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  return vec2(tNear, tFar);
}

/**
 * Ray-Sphere intersection using the quadratic formula.
 *
 * Geometric setup:
 *   - Sphere: all points P where |P - C|² = r²
 *   - Ray: P(t) = O + t*D (origin O, direction D, parameter t ≥ 0)
 *
 * Substituting ray into sphere equation yields quadratic:
 *   at² + bt + c = 0
 *
 * Where:
 *   a = D·D (always > 0)
 *   b = 2(O-C)·D
 *   c = (O-C)·(O-C) - r²
 *
 * Solutions: t = (-b ± √(b²-4ac)) / 2a
 * We use -b - √... to get the nearest intersection (smallest positive t).
 */
float intersectSphere(vec3 origin, vec3 ray, vec3 center, float radius) {
  vec3 toSphere = origin - center; // Vector from sphere center to ray origin
  float a = dot(ray, ray); // ||D||² (= 1 if ray is normalized)
  float b = 2.0 * dot(toSphere, ray);
  float c = dot(toSphere, toSphere) - radius * radius;
  float discriminant = b * b - 4.0 * a * c;

  if (discriminant > 0.0) {
    float t = (-b - sqrt(discriminant)) / (2.0 * a); // Nearest intersection
    if (t > 0.0) return t; // Only valid if in front of ray origin
  }
  return 1.0e6; // No valid intersection
}

/**
 * Calculates exit/entry bounds on a sphere obstacle.
 */
float intersectSphereBounds(vec3 origin, vec3 ray, vec3 center, float radius) {
  vec3 toSphere = origin - center;
  float a = dot(ray, ray);
  float b = 2.0 * dot(toSphere, ray);
  float c = dot(toSphere, toSphere) - radius * radius;
  float discriminant = b * b - 4.0 * a * c;
  if (discriminant > 0.0) {
    float root = sqrt(discriminant);
    float near = (-b - root) / (2.0 * a);
    float far = (-b + root) / (2.0 * a);
    if (near > 0.0) return near;
    if (far > 0.0) return 0.0;
  }
  return 1.0e6;
}

/**
 * Signed Distance Function (SDF) for a (2,3) Torus Knot (Trefoil Knot).
 *
 * A (p,q) torus knot winds p times through the hole and q times around
 * the torus. This creates a continuous closed curve in 3D space.
 *
 * The SDF is computed by discretizing the knot curve into line segments
 * and finding the minimum distance from the query point to any segment.
 * This distance is then offset by the tube radius to create a solid shape.
 *
 * For raymarching, the SDF's key property is: at any point, the SDF value
 * is a safe distance to step without overshooting the surface.
 */
float sdTorusKnot(vec3 p, vec3 center) {
  vec3 pos = p - center;

  // Early-out optimization: if outside bounding sphere, return approximate distance
  float d_bound = length(pos) - 0.31;
  if (d_bound > 0.08) {
    return d_bound;
  }

  float minDist = 1.0e6;
  const int segments = 48; // Smooth curve approximation at interactive cost
  const float radius = 0.17; // Major radius of the torus
  const float tube = 0.045; // Tube thickness
  const float p_knot = 2.0; // Winds through hole p times
  const float q_knot = 3.0; // Winds around torus q times

  vec3 prevPt = vec3(0.0);
  for (int i = 0; i <= segments; i++) {
    // Parametric angle along the knot curve
    float theta = float(i) / float(segments) * 6.283185307179586;

    // Torus knot parametric equations (creates the trefoil shape)
    float rad = radius * (2.0 + cos(q_knot * theta)) * 0.5;
    vec3 pt = vec3(
      rad * cos(p_knot * theta),
      -radius * sin(q_knot * theta) * 0.5,
      rad * sin(p_knot * theta)
    );

    if (i > 0) {
      // Point-to-segment distance formula
      vec3 ba = pt - prevPt; // Segment direction
      vec3 pa = pos - prevPt; // Vector to query point
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); // Projection parameter
      float d = length(pa - ba * h); // Distance to closest point on segment
      minDist = min(minDist, d);
    }
    prevPt = pt;
  }
  return minDist - tube; // Offset by tube radius for solid shape
}

/**
 * Traces a ray to intersect the Torus Knot SDF.
 */
float intersectTorusKnot(vec3 origin, vec3 ray, vec3 center) {
  float t_bound = intersectSphereBounds(origin, ray, center, 0.31);
  if (t_bound > 1.0e5) return 1.0e6;

  float t = t_bound;
  for (int i = 0; i < 20; i++) {
    vec3 p = origin + ray * t;
    float d = sdTorusKnot(p, center);
    if (d < 0.001) {
      return t;
    }
    t += d;
    if (t > t_bound + 0.5) break;
  }
  return 1.0e6;
}

/**
 * Computes surface normal of the Torus Knot using gradient estimation.
 *
 * For an SDF, the gradient ∇d points away from the surface (outward normal).
 * We estimate the gradient using central finite differences:
 *
 *   ∂d/∂x ≈ (d(x+ε) - d(x-ε)) / (2ε)
 *
 * This works because the SDF's gradient direction is the surface normal,
 * and the gradient magnitude is 1 (for a proper distance field).
 *
 * @param p Query point on the surface
 * @param center Torus knot center position
 * @return Normalized outward-facing surface normal
 */
vec3 getTorusKnotNormal(vec3 p, vec3 center) {
  const float eps = 0.001; // Small offset for finite difference

  // Central differences: f'(x) ≈ (f(x+h) - f(x-h)) / 2h
  // Note: The 2h factor cancels out after normalization
  vec3 n = vec3(
    sdTorusKnot(p + vec3(eps, 0.0, 0.0), center) - sdTorusKnot(p - vec3(eps, 0.0, 0.0), center),
    sdTorusKnot(p + vec3(0.0, eps, 0.0), center) - sdTorusKnot(p - vec3(0.0, eps, 0.0), center),
    sdTorusKnot(p + vec3(0.0, 0.0, eps), center) - sdTorusKnot(p - vec3(0.0, 0.0, eps), center)
  );
  return normalize(n);
}

/**
 * Computes shading color for a point on the sphere surface.
 *
 * Uses a combination of:
 * 1. Proximity-based ambient occlusion (darkening near walls/floor)
 * 2. Diffuse lighting from the underwater sun direction
 * 3. Caustic light patterns when underwater
 */
vec3 getSphereColor(vec3 point, vec3 center, float radius) {
  vec3 color = vec3(0.5); // Base gray color

  /**
   * * PROXIMITY AMBIENT OCCLUSION
   *    *
   *    * Darkens the sphere near pool walls and floor to simulate soft shadows
   *    * and reduced ambient light in corners. Uses an inverse power falloff:
   *    *
   *    *   occlusion = 1 - 0.9 / (distance/radius)³
   *    *
   *    * When distance ≈ radius: occlusion ≈ 1 - 0.9 = 0.1 (very dark)
   *    * When distance >> radius: occlusion → 1 (full brightness)
   *    *
   *    * Distances measured from walls (X=±1), back wall (Z=±1), and floor (Y=-poolHeight)
   */
  float floorDist = point.y + (poolHeight > 0.0 ? poolHeight : 1.2) + radius;
  if (floorDist > 0.0) {
    color *= clamp(1.0 - 0.4 / pow(max(0.5, floorDist / radius), 2.0), 0.35, 1.0);
  }

  // Compute sphere surface normal (for a sphere, it's simply the normalized radial direction)
  vec3 sphereNormal = (point - center) / radius;

  // Get underwater light direction (refracted sunlight)
  vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);

  // Lambertian diffuse: intensity = max(0, N · L)
  float diffuse = max(0.0, dot(-refractedLight, sphereNormal)) * 0.5;

  // Apply caustic lighting if the point is underwater
  vec4 info = texture2D(water, point.xz * 0.5 + 0.5);
  if (point.y < info.r) {
    // Below the water surface height
    // Sample caustics at the projected position (accounting for light slant)
    vec4 caustic = texture2D(
      causticTex,
      0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5
    );
    diffuse *= caustic.r * 4.0; // Amplify diffuse by caustic intensity
  }

  color += diffuse;
  return color;
}

/**
 * Computes cube shading.
 */
vec3 getCubeColor(vec3 point, vec3 center, vec3 halfSize) {
  vec3 local = (point - center) / halfSize;
  vec3 axis = abs(local);
  vec3 cubeNormal;
  if (axis.x > axis.y && axis.x > axis.z) {
    cubeNormal = vec3(sign(local.x), 0.0, 0.0);
  } else if (axis.y > axis.z) {
    cubeNormal = vec3(0.0, sign(local.y), 0.0);
  } else {
    cubeNormal = vec3(0.0, 0.0, sign(local.z));
  }

  vec3 color = vec3(0.5);
  vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  float diffuse = max(0.0, dot(-refractedLight, cubeNormal)) * 0.5;
  vec4 info = texture2D(water, point.xz * 0.5 + 0.5);
  if (point.y < info.r) {
    vec4 caustic = texture2D(
      causticTex,
      0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5
    );
    diffuse = (diffuse + 0.06) * caustic.r * 4.0;
  }
  return color + diffuse;
}

/**
 * Computes Torus Knot shading.
 */
vec3 getTorusKnotColor(vec3 point, vec3 center) {
  vec3 color = vec3(0.5);
  vec3 normal = getTorusKnotNormal(point, center);
  vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  float diffuse = max(0.0, dot(-refractedLight, normal)) * 0.5;
  vec4 info = texture2D(water, point.xz * 0.5 + 0.5);
  if (point.y < info.r) {
    vec4 caustic = texture2D(
      causticTex,
      0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5
    );
    diffuse = (diffuse + 0.06) * caustic.r * 4.0;
  }
  return color + diffuse;
}

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

/**
 * Computes seabed sand shading.
 */
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
    for (int i = 0; i < MAX_CUBES; i++) {
      if (i >= cubeCount) break;
      vec3 toFloor = point - cubeCenters[i];
      float distAlongRay = dot(toFloor, refractedLight);
      if (distAlongRay > 0.0) {
        vec3 rayClosest = cubeCenters[i] + refractedLight * distAlongRay;
        float perpDist = length((point - rayClosest) / cubeHalfSizes[i]);
        shadow = min(shadow, mix(0.3, 1.0, smoothstep(0.6, 1.8, perpDist)));
      }
    }
  }

  // 6. Composite seabed lighting
  float lightIntensity = diffuse * (0.65 + causticLight * shadow) + 0.35;
  lightIntensity *= shadow;

  // 7. Deep Ocean Falloff at outer perimeter
  float distFromCenter = length(point.xz);
  float shallowExtent = max(poolWidth, poolLength);
  float abyssFactor = smoothstep(shallowExtent * 0.85, shallowExtent * 1.5 + 40.0, distFromCenter);
  seabedColor = mix(seabedColor, vec3(0.01, 0.08, 0.22), abyssFactor * 0.96);

  return seabedColor * lightIntensity;
}

/**
 * Samples a texture projected from camera matrices.
 */
vec4 sampleProjectedTexture(sampler2D tex, mat4 matrix, vec3 point) {
  vec4 clip = matrix * vec4(point, 1.0);
  vec3 ndc = clip.xyz / max(clip.w, 1.0e-6);
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float inBounds =
    step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0) * step(0.0, clip.w);
  return texture2D(tex, clamp(uv, 0.0, 1.0)) * inBounds;
}

/**
 * Samples refracted objects inside water.
 */
vec4 sampleObjectRefraction(vec3 origin, vec3 ray, vec3 center, float radius) {
  float hit = intersectSphereBounds(origin, ray, center, radius);
  if (hit >= 1.0e6) return vec4(0.0);
  return sampleProjectedTexture(objectRefractionTex, viewProjectionMatrix, origin + ray * hit);
}

/**
 * Samples reflected objects inside water.
 */
vec4 sampleObjectReflection(vec3 origin, vec3 ray, vec3 center, float radius) {
  float hit = intersectSphereBounds(origin, ray, center, radius);
  if (hit >= 1.0e6) return vec4(0.0);
  return sampleProjectedTexture(
    objectReflectionTex,
    reflectionViewProjectionMatrix,
    origin + ray * hit
  );
}

/**
 * Ray-traces a single ray to determine the color seen in that direction.
 *
 * This is a simple ray tracer that handles:
 * 1. Intersection with scene objects (sphere, cube, torus knot)
 * 2. Intersection with pool walls and floor
 * 3. Escape to sky (cubemap environment)
 * 4. Water color absorption (Beer's Law)
 *
 * The ray can be either a reflected ray (bouncing off water surface toward sky)
 * or a refracted ray (entering water toward pool floor).
 *
 * @param origin Starting point of the ray (on water surface)
 * @param ray Normalized direction of the ray
 * @param waterColor Tinting color for underwater light absorption
 * @return Final color for this ray
 */
vec3 getSurfaceRayColor(vec3 origin, vec3 ray, vec3 waterColor) {
  vec3 color;

  // Test intersections with all scene objects and find the nearest hit
  int hitSphereIndex = -1;
  float sphereDistance = 1.0e6;
  if (sphereEnabled) {
    for (int i = 0; i < MAX_SPHERES; i++) {
      if (i >= sphereCount) break;
      float d = intersectSphere(origin, ray, sphereCenters[i], sphereRadii[i]);
      if (d < sphereDistance) {
        sphereDistance = d;
        hitSphereIndex = i;
      }
    }
  }

  int hitCubeIndex = -1;
  float cubeDistance = 1.0e6;
  if (cubeEnabled) {
    for (int i = 0; i < MAX_CUBES; i++) {
      if (i >= cubeCount) break;
      vec2 cubeIntersection = intersectCube(
        origin,
        ray,
        cubeCenters[i] - cubeHalfSizes[i],
        cubeCenters[i] + cubeHalfSizes[i]
      );
      bool cubeHit = cubeIntersection.x <= cubeIntersection.y && cubeIntersection.y > 0.0;
      float d = cubeHit
        ? cubeIntersection.x > 0.0
          ? cubeIntersection.x
          : cubeIntersection.y > 0.0
            ? cubeIntersection.y
            : 1.0e6
        : 1.0e6;
      if (d < cubeDistance) {
        cubeDistance = d;
        hitCubeIndex = i;
      }
    }
  }

  // Trace torus knot for all rays - check all knots without bounding sphere pre-filter
  // to avoid circular artifact at bounding sphere boundary
  float torusKnotDistance = 1.0e6;
  int hitTorusKnotIndex = -1;
  if (torusKnotEnabled) {
    for (int i = 0; i < MAX_TORUS_KNOTS; i++) {
      if (i >= torusKnotCount) break;
      float dist = intersectTorusKnot(origin, ray, torusKnotCenters[i]);
      if (dist < torusKnotDistance) {
        torusKnotDistance = dist;
        hitTorusKnotIndex = i;
      }
    }
  }

  // Find nearest object intersection
  float meshDistance = 1.0e6;
#if USE_MESH_RAY_TRACING
  vec3 meshNormal = vec3(0.0);
  vec2 meshUv = vec2(0.0);
  intersectMeshInstances(origin, ray, meshDistance, meshNormal, meshUv);
#endif
  float objectDistance = min(meshDistance, min(min(sphereDistance, cubeDistance), torusKnotDistance));

  if (objectDistance < 1.0e6) {
    // RAY HIT AN OBJECT - shade the hit point
    vec3 hit = origin + ray * objectDistance;
#if USE_MESH_RAY_TRACING
    if (objectDistance == meshDistance) {
      color = getDuckColor(hit, meshNormal, meshUv);
    } else
#endif
    if (objectDistance == sphereDistance) {
      color = getSphereColor(hit, sphereCenters[hitSphereIndex], sphereRadii[hitSphereIndex]);
    } else if (objectDistance == cubeDistance) {
      color = getCubeColor(hit, cubeCenters[hitCubeIndex], cubeHalfSizes[hitCubeIndex]);
    } else {
      color = getTorusKnotColor(hit, torusKnotCenters[hitTorusKnotIndex]);
    }

  } else if (ray.y < 0.0) {
    // RAY POINTS DOWNWARD - hits undulating 3D seabed floor
    float depth = poolHeight > 0.0 ? poolHeight : 1.2;
    float tFloor = (-depth - origin.y) / ray.y;
    vec3 hit = origin + ray * tFloor;
    // Parallax depth refinement against 3D bathymetry dunes
    float elev = getSeabedElevation(hit.xz);
    tFloor = (-depth + elev - origin.y) / ray.y;
    hit = origin + ray * tFloor;

    vec3 seabed = getWallColor(hit);

    // Beer-Lambert light absorption in tropical sea water:
    // Shallower water over dunes reveals crystal turquoise sand, deep water fades to deep blue
    float distInWater = length(hit - origin);
    float waterDepth = max(0.1, -hit.y);
    vec3 shallowSea = vec3(0.08, 0.85, 0.82);
    vec3 deepSea = vec3(0.01, 0.09, 0.26);
    float depthRatio = clamp(waterDepth * 0.18, 0.0, 1.0);
    vec3 waterColorScatter = mix(shallowSea, deepSea, depthRatio);

    float extinction = 1.0 - exp(-distInWater * 0.28);
    color = mix(seabed, waterColorScatter, extinction);

  } else {
    // RAY POINTS UPWARD - exits water into open tropical sky (no pool rim!)
    color = textureCube(sky, ray).rgb;
    float sunDot = max(0.0, dot(light, ray));
    color += vec3(pow(sunDot, 4000.0)) * vec3(12.0, 9.5, 7.0);
    color += vec3(pow(sunDot, 40.0)) * vec3(0.3, 0.25, 0.2);
  }

  /**
 * * WATER COLOR ABSORPTION (Beer-Lambert Law Approximation)
 *    *
 *    * Light traveling through water is absorbed, with longer wavelengths
 *    * (red) absorbed more than shorter ones (blue). This is why deep
 *    * water appears blue-green.
 *    *
 *    * We simplify this by multiplying by a tint color for downward rays
 *    * (longer path through water = more absorption).
 */
  if (ray.y < 0.0) color *= waterColor;

  return color;
}

// Directional ocean swell analytical slope / gradient (∂h/∂x, ∂h/∂z)
vec2 getOceanSlope(vec2 p, float t) {
  vec2 s1 = vec2(0.24, 0.14) * (cos(dot(p, vec2(0.24, 0.14)) - t * 0.85) * 0.032);
  vec2 s2 = vec2(-0.16, 0.30) * (cos(dot(p, vec2(-0.16, 0.30)) - t * 1.05 + 1.2) * 0.020);
  vec2 s3 = vec2(0.35, -0.22) * (cos(dot(p, vec2(0.35, -0.22)) - t * 1.35 + 2.4) * 0.012);
  vec2 s4 = vec2(0.55, 0.45) * (cos(dot(p, vec2(0.55, 0.45)) - t * 1.8 + 0.5) * 0.006);
  return s1 + s2 + s3 + s4;
}

void main() {
  float pWidth = poolWidth > 0.0 ? poolWidth : 1.0;
  float pLength = poolLength > 0.0 ? poolLength : 1.0;

  // 1. Coordinate mapping within central sea simulation grid
  vec2 coord = (vPosition.xz / vec2(pWidth, pLength)) * 0.5 + 0.5;
  vec2 edgeDist = abs(vPosition.xz / vec2(pWidth, pLength));
  float inInteractive = clamp(1.0 - (max(edgeDist.x, edgeDist.y) - 0.75) / 0.25, 0.0, 1.0);

  vec4 info = texture2D(water, clamp(coord, 0.0, 1.0));

  // 2. Parallax displacement
  for (int i = 0; i < 5; i++) {
    coord = clamp(coord + info.ba * 0.005, 0.0, 1.0);
    info = texture2D(water, coord);
  }

  // 3. Normal reconstruction with combined interactive simulation and directional ocean swell slopes
  vec2 simSlope = clamp(info.ba, vec2(-0.999), vec2(0.999));
  vec2 oceanSlope = getOceanSlope(vPosition.xz, time);
  vec2 totalSlope = clamp(simSlope * inInteractive + oceanSlope, vec2(-0.95), vec2(0.95));
  float slopeLengthSq = min(dot(totalSlope, totalSlope), 0.95);
  vec3 normal = normalize(vec3(totalSlope.x, sqrt(max(0.001, 1.0 - slopeLengthSq)), totalSlope.y));

  // 4. View ray from camera to water surface
  vec3 incomingRay = normalize(vPosition - eye);
  vec3 reflectedRay = reflect(incomingRay, normal);
  vec3 refractedRay = refract(incomingRay, normal, IOR_AIR / IOR_WATER);

  // 5. Fresnel reflectance
  float fresnel = mix(0.18, 1.0, pow(1.0 - dot(normal, -incomingRay), 4.0));

  // 6. Ray trace colors
  vec3 reflectedColor = getSurfaceRayColor(vPosition, reflectedRay, abovewaterColor);
  vec3 refractedColor = getSurfaceRayColor(vPosition, refractedRay, abovewaterColor);

  // 7. Blend pre-rendered reflection/refraction passes for interactive objects
  if (torusKnotEnabled) {
    for (int i = 0; i < MAX_TORUS_KNOTS; i++) {
      if (i >= torusKnotCount) break;
      vec4 knotWaterInfo = texture2D(water, clamp((torusKnotCenters[i].xz / vec2(pWidth, pLength)) * 0.5 + 0.5, 0.0, 1.0));
      if (torusKnotCenters[i].y > knotWaterInfo.r) {
        float hit = intersectSphereBounds(vPosition, refractedRay, torusKnotCenters[i], 0.31);
        if (hit < 1.0e6) {
          vec4 refractedObject = sampleProjectedTexture(
            objectRefractionTex,
            viewProjectionMatrix,
            vPosition + refractedRay * hit
          );
          refractedColor = mix(refractedColor, refractedObject.rgb, refractedObject.a);
        }
        hit = intersectSphereBounds(vPosition, reflectedRay, torusKnotCenters[i], 0.31);
        if (hit < 1.0e6) {
          vec4 reflectedObject = sampleProjectedTexture(
            objectClippedReflectionTex,
            reflectionViewProjectionMatrix,
            vPosition + reflectedRay * hit
          );
          reflectedColor = mix(reflectedColor, reflectedObject.rgb, reflectedObject.a);
        }
      }
    }
  }

  // 8. Composite with Fresnel blending and sun specular glitter on ocean crests
  vec3 halfVec = normalize(-incomingRay + light);
  float sunGlitter = pow(max(0.0, dot(normal, halfVec)), 350.0);
  vec3 finalColor = mix(refractedColor, reflectedColor, fresnel) + sunGlitter * vec3(1.2, 1.1, 0.95) * 0.75;

  // Seamless horizon ocean mist: seamlessly dissolves water surface into the sky cubemap at the horizon
  float distToCam = length(vPosition - eye);
  vec3 skyHorizon = textureCube(sky, incomingRay).rgb;
  float horizonMist = smoothstep(120.0, 280.0, distToCam);
  finalColor = mix(finalColor, skyHorizon, horizonMist);

  gl_FragColor = vec4(finalColor, 1.0);
}
