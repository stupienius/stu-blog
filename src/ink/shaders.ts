// GLSL sources for the ink-in-water fluid simulation (WebGL2).
// The solver follows the classic "stable fluids" scheme:
// advect -> vorticity confinement -> project (divergence, Jacobi pressure, gradient subtract).

const header = `#version 300 es
precision highp float;
precision highp sampler2D;
`

export const baseVert = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`

const noise = `
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}
`

export const copyFrag = `${header}
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 o;
void main () { o = texture(uTexture, vUv); }`

export const multiplyFrag = `${header}
in vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
out vec4 o;
void main () { o = value * texture(uTexture, vUv); }`

// Gaussian splat that adds `color` to the target (used for mouse stirring).
export const splatFrag = `${header}
in vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;
out vec4 o;
void main () {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 s = exp(-dot(p, p) / radius) * color;
  o = vec4(texture(uTarget, vUv).xyz + s, 1.0);
}`

// Radial (outward / inward) push with an optional swirl component.
export const radialFrag = `${header}
in vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec2 point;
uniform float radius;
uniform float strength;
uniform float swirl;
uniform float seed;
${noise}
out vec4 o;
void main () {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  float g = exp(-dot(p, p) / radius);
  vec2 dir = p / (length(p) + 1e-4);
  vec2 tang = vec2(-dir.y, dir.x);
  // jitter the strength by angle so bursts are not perfectly round
  float a = atan(p.y, p.x);
  float j = 0.55 + 0.9 * fbm(vec2(a * 2.0, seed));
  vec2 v = (dir * strength * j + tang * swirl) * g;
  o = vec4(texture(uTarget, vUv).xy + v, 0.0, 1.0);
}`

// Irregular ink blob with a soft, noisy edge.
export const blobFrag = `${header}
in vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec2 point;
uniform float radius;
uniform float amount;
uniform float seed;
${noise}
out vec4 o;
void main () {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  float a = atan(p.y, p.x);
  float n = fbm(vec2(cos(a), sin(a)) * 1.8 + seed) ;
  float r = radius * (0.7 + 0.6 * n);
  float d = length(p) / r;
  float s = smoothstep(1.0, 0.55, d) * amount * (0.85 + 0.3 * fbm(p * 40.0 + seed));
  o = vec4(texture(uTarget, vUv).r + s, 0.0, 0.0, 1.0);
}`

// Pin the dye to the text mask while the name is "holding".
export const imprintFrag = `${header}
in vec2 vUv;
uniform sampler2D uDye;
uniform sampler2D uMask;
uniform float target;
uniform float alpha;
uniform float outsideKeep;
out vec4 o;
void main () {
  float m = texture(uMask, vUv).r;
  float d = texture(uDye, vUv).r;
  d *= mix(outsideKeep, 1.0, m);
  d = max(d, m * target * alpha);
  o = vec4(d, 0.0, 0.0, 1.0);
}`

// Ambient water motion: curl noise + ink slowly sinking under its own weight.
export const ambientFrag = `${header}
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uDye;
uniform vec2 texelSize;
uniform float aspectRatio;
uniform float time;
uniform float amp;
uniform float sink;
uniform float dt;
${noise}
out vec4 o;
float psi (vec2 q) {
  vec2 w = q + vec2(time * 0.05, -time * 0.035);
  return vnoise(w) + 0.35 * vnoise(w * 2.3 + 5.2);
}
void main () {
  vec2 q = vUv * vec2(aspectRatio, 1.0) * 1.6;
  float e = 0.05;
  float dx = (psi(q + vec2(e, 0.0)) - psi(q - vec2(e, 0.0))) / (2.0 * e);
  float dy = (psi(q + vec2(0.0, e)) - psi(q - vec2(0.0, e))) / (2.0 * e);
  vec2 c = vec2(dy, -dx);
  // smoothed ink density at the velocity grid's scale (avoids aliasing into fur-like streaks)
  float d = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      d += texture(uDye, vUv + vec2(float(i), float(j)) * texelSize * 4.0).r;
    }
  }
  d /= 9.0;
  vec2 vel = texture(uVelocity, vUv).xy;
  vel += dt * (amp * c - vec2(0.0, sink * min(d, 3.0)));
  o = vec4(vel, 0.0, 1.0);
}`

// A touch of viscosity: blend each velocity with its neighbours.
// Suppresses grid-scale (odd/even) noise that would otherwise show up as serrated ink edges.
export const viscosityFrag = `${header}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
uniform float amount;
out vec4 o;
void main () {
  vec2 c = texture(uVelocity, vUv).xy;
  vec2 n = 0.25 * (texture(uVelocity, vL).xy + texture(uVelocity, vR).xy + texture(uVelocity, vT).xy + texture(uVelocity, vB).xy);
  o = vec4(mix(c, n, amount), 0.0, 1.0);
}`

export const advectionFrag = `${header}
in vec2 vUv;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;
out vec4 o;
void main () {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;
  vec4 result = texture(uSource, coord);
  o = result / (1.0 + dissipation * dt);
}`

export const divergenceFrag = `${header}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 o;
void main () {
  float L = texture(uVelocity, vL).x;
  float R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y;
  float B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`

export const curlFrag = `${header}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
out vec4 o;
void main () {
  float L = texture(uVelocity, vL).y;
  float R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x;
  float B = texture(uVelocity, vB).x;
  o = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`

export const vorticityFrag = `${header}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;
out vec4 o;
void main () {
  float L = texture(uCurl, vL).x;
  float R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x;
  float B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 vel = texture(uVelocity, vUv).xy + force * dt;
  vel = clamp(vel, -1000.0, 1000.0);
  o = vec4(vel, 0.0, 1.0);
}`

export const pressureFrag = `${header}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
out vec4 o;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  float div = texture(uDivergence, vUv).x;
  o = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}`

export const gradientSubtractFrag = `${header}
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
out vec4 o;
void main () {
  float L = texture(uPressure, vL).x;
  float R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x;
  float B = texture(uPressure, vB).x;
  vec2 vel = texture(uVelocity, vUv).xy - vec2(R - L, T - B);
  o = vec4(vel, 0.0, 1.0);
}`

// Beer–Lambert style shading: dense ink is near-black, thin ink turns a cool grey-blue.
export const displayFrag = `${header}
in vec2 vUv;
uniform sampler2D uDye;
uniform vec3 paper;
uniform vec3 absorb;
out vec4 o;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main () {
  float d = max(texture(uDye, vUv).r, 0.0);
  vec3 col = paper * exp(-d * absorb);
  col += (h(gl_FragCoord.xy) - 0.5) * (2.0 / 255.0);
  o = vec4(col, 1.0);
}`

// Ink particles flying from the blob to the letters.
export const particleVert = `#version 300 es
precision highp float;
in vec2 aPos;
in vec2 aVel;
in float aInk;
uniform float pointSize;
out vec2 vVel;
out float vInk;
void main () {
  vVel = aVel;
  vInk = aInk;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = pointSize;
}`

export const particleFrag = `${header}
in vec2 vVel;
in float vInk;
uniform float amount;
uniform int mode;
out vec4 o;
void main () {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float g = exp(-r2 * 3.0);
  o = mode == 0 ? vec4(amount * vInk * g, 0.0, 0.0, 0.0) : vec4(vVel * g, 0.0, 0.0);
}`
