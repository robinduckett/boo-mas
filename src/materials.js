// Shared shader materials + global uniforms.
import * as THREE from 'three';

/** Uniforms shared by every animated shader in the game. */
export const U = {
  uTime: { value: 0 },
};

/**
 * Unlit HDR material for anything that should glow through the bloom pass:
 * fairy-light bulbs, windows, lantern glass, tree stars.
 * Works on plain meshes and on InstancedMesh (uses instanceColor when present).
 */
export function glowMaterial({ twinkle = 0.3, color = null } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: U.uTime,
      uTwinkle: { value: twinkle },
      uGain: { value: 1 },
      uColor: { value: color ? color.clone() : new THREE.Color(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uTwinkle;
      uniform vec3 uColor;
      varying vec3 vColor;
      varying vec3 vN;
      void main(){
        #ifdef USE_INSTANCING
          mat4 im = instanceMatrix;
        #else
          mat4 im = mat4(1.0);
        #endif
        vec4 wp = modelMatrix * im * vec4(position, 1.0);
        vec3 seed = (modelMatrix * im)[3].xyz;
        float ph = fract(sin(dot(seed, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float tw = 1.0 - uTwinkle * (0.5 + 0.5 * sin(uTime * (1.6 + ph * 4.0) + ph * 6.2831));
        vColor = uColor * tw;
        #ifdef USE_INSTANCING_COLOR
          vColor *= instanceColor;
        #endif
        vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(im) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      varying vec3 vColor;
      varying vec3 vN;
      void main(){
        // cheap "glass bulb" shading: hot core, slightly dimmer rim
        float core = clamp(normalize(vN).z, 0.0, 1.0);
        gl_FragColor = vec4(vColor * uGain * mix(0.55, 1.2, core * core), 1.0);
      }`,
  });
}

/**
 * Additive light pool painted onto the snow under anything that glows.
 * Rendered right after the terrain, with no depth test, so it hugs hills
 * without z-fighting and everything else draws on top of it.
 */
export function poolMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uGain: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      void main(){
        vUv = uv;
        #ifdef USE_INSTANCING
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #else
          vec4 wp = modelMatrix * vec4(position, 1.0);
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
        #else
          vColor = vec3(1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying vec3 vColor;
      void main(){
        float d = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        a = a * a * (0.6 + 0.4 * a);
        gl_FragColor = vec4(vColor * uTint * a * uGain, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: false, // stay in the opaque queue so renderOrder puts us right after the terrain
  });
}

/** Unit disc lying in the local XZ plane (normal +Y), for light pools. */
export function poolGeometry() {
  const g = new THREE.CircleGeometry(1, 28);
  g.rotateX(-Math.PI / 2);
  return g;
}

export const RENDER_ORDER = {
  sky: -100,
  terrain: -20,
  pools: -10,
};
