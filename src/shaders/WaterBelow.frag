precision highp float;

const float IOR_AIR = 1.0;
const float IOR_WATER = 1.333;
const vec3 abovewaterColor = vec3(0.08, 0.85, 0.88);
const vec3 underwaterColor = vec3(0.04, 0.75, 0.82);
uniform float poolHeight;
const float torusKnotShadowRadius = 0.13;

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
 * Computes intersection of a ray with the pool bounding box.
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
 * Computes ray-sphere intersection.
 */
float intersectSphere(vec3 origin, vec3 ray, vec3 center, float radius) {
  vec3 toSphere = origin - center;
  float a = dot(ray, ray);
  float b = 2.0 * dot(toSphere, ray);
  float c = dot(toSphere, toSphere) - radius * radius;
  float discriminant = b * b - 4.0 * a * c;
  if (discriminant > 0.0) {
    float t = (-b - sqrt(discriminant)) / (2.0 * a);
    if (t > 0.0) return t;
  }
  return 1.0e6;
}

/**
 * Checks entry/exit bounds on a sphere obstacle.
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
 * Torus Knot signed distance function (SDF).
 */
float sdTorusKnot(vec3 p, vec3 center) {
  vec3 pos = p - center;
  float d_bound = length(pos) - 0.31;
  if (d_bound > 0.08) {
    return d_bound;
  }
  float minDist = 1.0e6;
  const int segments = 32;
  const float radius = 0.17;
  const float tube = 0.045;
  const float p_knot = 2.0;
  const float q_knot = 3.0;

  vec3 prevPt = vec3(0.0);
  for (int i = 0; i <= segments; i++) {
    float theta = float(i) / float(segments) * 6.283185307179586;
    float rad = radius * (2.0 + cos(q_knot * theta)) * 0.5;
    vec3 pt = vec3(
      rad * cos(p_knot * theta),
      -radius * sin(q_knot * theta) * 0.5,
      rad * sin(p_knot * theta)
    );
    if (i > 0) {
      vec3 ba = pt - prevPt;
      vec3 pa = pos - prevPt;
      float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
      float d = length(pa - ba * h);
      minDist = min(minDist, d);
    }
    prevPt = pt;
  }
  return minDist - tube;
}

/**
 * Traces a ray to intersect the Torus Knot SDF.
 */
float intersectTorusKnot(vec3 origin, vec3 ray, vec3 center) {
  float t_bound = intersectSphereBounds(origin, ray, center, 0.31);
  if (t_bound > 1.0e5) return 1.0e6;

  float t = t_bound;
  for (int i = 0; i < 18; i++) {
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
 * Computes normal on Torus Knot surface.
 */
vec3 getTorusKnotNormal(vec3 p, vec3 center) {
  const float eps = 0.001;
  vec3 n = vec3(
    sdTorusKnot(p + vec3(eps, 0.0, 0.0), center) - sdTorusKnot(p - vec3(eps, 0.0, 0.0), center),
    sdTorusKnot(p + vec3(0.0, eps, 0.0), center) - sdTorusKnot(p - vec3(0.0, eps, 0.0), center),
    sdTorusKnot(p + vec3(0.0, 0.0, eps), center) - sdTorusKnot(p - vec3(0.0, 0.0, eps), center)
  );
  return normalize(n);
}

/**
 * Calculates shading color on the sphere.
 */
vec3 getSphereColor(vec3 point, vec3 center, float radius) {
  vec3 color = vec3(0.5);
  color *= 1.0 - 0.6 / pow((1.0 + radius - abs(point.x)) / radius, 3.0);
  color *= 1.0 - 0.6 / pow((1.0 + radius - abs(point.z)) / radius, 3.0);
  color *= 1.0 - 0.6 / pow((point.y + poolHeight + radius) / radius, 3.0);

  vec3 sphereNormal = (point - center) / radius;
  vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  float diffuse = max(0.0, dot(-refractedLight, sphereNormal)) * 0.5;
  vec4 info = texture2D(water, point.xz * 0.5 + 0.5);
  if (point.y < info.r) {
    vec4 caustic = texture2D(
      causticTex,
      0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5
    );
    diffuse *= caustic.r * 4.0;
  }
  color += diffuse;
  return color;
}

/**
 * Calculates shading color on the cube.
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
 * Calculates shading color on the Torus Knot.
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
 * Calculates wall/floor tiles color.
 */
vec3 getWallColor(vec3 point) {
  float scale = 0.65;
  float rippleAngle = point.x * 10.0 + sin(point.z * 5.0) * 1.8;
  float sandRipple = sin(rippleAngle) * 0.5 + 0.5;
  vec3 normal = normalize(vec3(
    cos(rippleAngle) * 0.08,
    1.0,
    cos(point.z * 5.0) * 0.05
  ));

  vec2 uv1 = point.xz * 0.45 + vec2(0.5, 0.5);
  vec2 uv2 = point.xz * 1.8 + vec2(0.2, 0.7);
  vec3 sandTex1 = texture2D(tiles, uv1).rgb;
  vec3 sandTex2 = texture2D(tiles, uv2).rgb;
  vec3 wallColor = mix(sandTex1, sandTex2, 0.35) * (0.85 + 0.3 * sandRipple) * vec3(1.04, 0.98, 0.88);

  scale /= length(point);
  if (sphereEnabled) {
    for (int i = 0; i < MAX_SPHERES; i++) {
      if (i >= sphereCount) break;
      scale *= 1.0 - 0.6 / pow(max(length(point - sphereCenters[i]) / sphereRadii[i], 1.0), 4.0);
    }
  } else if (cubeEnabled) {
    for (int i = 0; i < MAX_CUBES; i++) {
      if (i >= cubeCount) break;
      float cubeDistance = length((point - cubeCenters[i]) / cubeHalfSizes[i]);
      scale *= 1.0 - 0.6 / pow(max(cubeDistance, 1.0), 4.0);
    }
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

  vec3 refractedLight = -refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);
  float diffuse = max(0.0, dot(refractedLight, normal));
  vec2 causticCoord = 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5;
  vec4 caustic = texture2D(causticTex, causticCoord);
  float causticMask = clamp(1.0 - (length(point.xz) - 0.8) / 0.4, 0.0, 1.0);
  scale += diffuse * (caustic.r * 3.2 * caustic.g) * causticMask;
  scale += diffuse * 0.4;

  float distFromCenter = length(point.xz);
  float abyssFactor = clamp((distFromCenter - 1.2) / 4.5, 0.0, 1.0);
  wallColor = mix(wallColor, vec3(0.01, 0.08, 0.22), abyssFactor * 0.95);

  return wallColor * scale;
}

/**
 * Samples a texture projected from the camera's view-projection matrix coordinates.
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
 * Samples refraction texture mapped to a sphere boundary approximation.
 */
vec4 sampleObjectRefraction(vec3 origin, vec3 ray, vec3 center, float radius) {
  float hit = intersectSphereBounds(origin, ray, center, radius);
  if (hit >= 1.0e6) return vec4(0.0);
  return sampleProjectedTexture(objectRefractionTex, viewProjectionMatrix, origin + ray * hit);
}

/**
 * Samples reflection texture mapped to a sphere boundary approximation.
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
 * Ray-traces primary refraction/reflection rays to find colors of background wall tiles,
 * objects, or sky dome exits.
 */
vec3 getSurfaceRayColor(vec3 origin, vec3 ray, vec3 waterColor) {
  vec3 color;
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
  float torusKnotDistance = 1.0e6;
  int hitTorusKnotIndex = -1;
  if (torusKnotEnabled && ray.y > 0.0) {
    float nearestBoundDist = 1.0e6;
    int nearestBoundIndex = -1;
    for (int i = 0; i < MAX_TORUS_KNOTS; i++) {
      if (i >= torusKnotCount) break;
      float t_bound = intersectSphereBounds(origin, ray, torusKnotCenters[i], 0.31);
      if (t_bound < nearestBoundDist) {
        nearestBoundDist = t_bound;
        nearestBoundIndex = i;
      }
    }
    if (nearestBoundIndex != -1) {
      torusKnotDistance = intersectTorusKnot(origin, ray, torusKnotCenters[nearestBoundIndex]);
      hitTorusKnotIndex = nearestBoundIndex;
    }
  }

  float meshDistance = 1.0e6;
#if USE_MESH_RAY_TRACING
  vec3 meshNormal = vec3(0.0);
  vec2 meshUv = vec2(0.0);
  intersectMeshInstances(origin, ray, meshDistance, meshNormal, meshUv);
#endif
  float objectDistance = min(meshDistance, min(min(sphereDistance, cubeDistance), torusKnotDistance));
  if (objectDistance < 1.0e6) {
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
    // Hits seabed floor
    float depth = poolHeight > 0.0 ? poolHeight : 1.0;
    float tFloor = (-depth - origin.y) / ray.y;
    vec3 hit = origin + ray * tFloor;
    color = getWallColor(hit);
    float distInWater = length(hit - origin);
    color = mix(color, vec3(0.01, 0.09, 0.26), 1.0 - exp(-distInWater * 0.3));
  } else {
    // Exits water into open sky
    color = textureCube(sky, ray).rgb;
    color += vec3(pow(max(0.0, dot(light, ray)), 4000.0)) * vec3(12.0, 9.5, 7.0);
  }

  // Modulate light color by water tinting if traveling inside water (ray.y < 0)
  if (ray.y < 0.0) color *= waterColor;
  return color;
}

void main() {
  float pWidth = poolWidth > 0.0 ? poolWidth : 1.0;
  float pLength = poolLength > 0.0 ? poolLength : 1.0;

  // 1. Convert vPosition to UV coordinates
  vec2 coord = (vPosition.xz / vec2(pWidth, pLength)) * 0.5 + 0.5;
  vec2 edgeDist = abs(vPosition.xz / vec2(pWidth, pLength));
  float inInteractive = clamp(1.0 - (max(edgeDist.x, edgeDist.y) - 0.75) / 0.25, 0.0, 1.0);

  vec4 info = texture2D(water, clamp(coord, 0.0, 1.0));

  // 2. Perform iterative offset lookup along normal derivatives
  for (int i = 0; i < 5; i++) {
    coord = clamp(coord + info.ba * 0.005, 0.0, 1.0);
    info = texture2D(water, coord);
  }

  // 3. Reconstruct surface normal vector with ocean swell
  vec2 simSlope = clamp(info.ba, vec2(-0.999), vec2(0.999));
  vec2 oceanSlope = vec2(
    cos(vPosition.x * 1.5 + time * 1.7) * 0.025 + cos((vPosition.x + vPosition.z) * 2.8 - time * 1.4) * 0.02,
    cos(vPosition.z * 1.8 + time * 2.1 + 1.2) * 0.024 + cos((vPosition.x + vPosition.z) * 2.8 - time * 1.4) * 0.02
  );
  vec2 totalSlope = clamp(simSlope * inInteractive + oceanSlope, vec2(-0.95), vec2(0.95));
  float slopeLengthSq = min(dot(totalSlope, totalSlope), 0.95);
  vec3 normal = normalize(vec3(totalSlope.x, sqrt(max(0.001, 1.0 - slopeLengthSq)), totalSlope.y));
  normal = -normal;

  // 4. Calculate incoming eye view vector
  vec3 incomingRay = normalize(vPosition - eye);

  // 5. Reflect and Refract vectors
  vec3 reflectedRay = reflect(incomingRay, normal);
  vec3 refractedRay = refract(incomingRay, normal, IOR_WATER / IOR_AIR);

  // 6. Fresnel reflection coefficient mixing
  float fresnel = mix(0.4, 1.0, pow(1.0 - dot(normal, -incomingRay), 3.0));

  // 7. Raytrace reflected and refracted directions
  vec3 reflectedColor = getSurfaceRayColor(vPosition, reflectedRay, underwaterColor);
  vec3 refractedColor =
    getSurfaceRayColor(vPosition, refractedRay, vec3(1.0)) * vec3(0.85, 1.0, 1.08);

  // 8. Overlay pre-rendered reflection/refraction textures for interactive objects
  if (torusKnotEnabled) {
    vec4 reflectedObject = sampleProjectedTexture(
      objectReflectionTex,
      reflectionViewProjectionMatrix,
      vPosition
    );
    vec4 refractedObject = sampleProjectedTexture(
      objectRefractionTex,
      viewProjectionMatrix,
      vPosition
    );

    float nearestHit = 1.0e6;
    int nearestIndex = -1;
    for (int i = 0; i < MAX_TORUS_KNOTS; i++) {
      if (i >= torusKnotCount) break;
      float hit = intersectSphereBounds(vPosition, refractedRay, torusKnotCenters[i], 0.31);
      if (hit < nearestHit) {
        nearestHit = hit;
        nearestIndex = i;
      }
    }
    if (nearestIndex != -1) {
      refractedObject = max(
        refractedObject,
        sampleProjectedTexture(
          objectRefractionTex,
          viewProjectionMatrix,
          vPosition + refractedRay * nearestHit
        )
      );
    }
    reflectedColor = mix(reflectedColor, reflectedObject.rgb, reflectedObject.a);
    refractedColor = mix(refractedColor, refractedObject.rgb, refractedObject.a);
  }

  // 9. Mix reflection and refraction based on fresnel
  gl_FragColor = vec4(
    mix(reflectedColor, refractedColor, (1.0 - fresnel) * length(refractedRay)),
    1.0
  );
}
