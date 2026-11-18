// Depth of field as a single gather pass over the scene colour and depth.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export class DofPass extends Pass {
  constructor(camera) {
    super(); this.camera = camera; this.focus = 12; this.aperture = 1;
    this.material = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uFocus: { value: 10 }, uScale: { value: 1 }, uMax: { value: 9 }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform float uNear, uFar, uFocus, uScale, uMax; uniform vec2 uTexel; varying vec2 vUv;
        float viewZ(vec2 uv) { float d = texture2D(tDepth, uv).x; return uNear * uFar / (uFar - d * (uFar - uNear)); }
        float coc(float z) { return clamp((1.0 / uFocus - 1.0 / z) * uScale, -uMax, uMax); }          // thin lens: blur circle in pixels (signed)
        void main() {
          float zc = viewZ(vUv), cc = abs(coc(zc)); vec3 acc = texture2D(tDiffuse, vUv).rgb; float wsum = 1.0, r = 1.0, a = 0.0;
          for (int i = 0; i < 40; i++) { a += 2.39996; r += 0.75 / r * uMax * 0.26; if (r > uMax) break;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uTexel; float z = viewZ(uv), c = abs(coc(z));
            if (z > zc) c = min(c, cc * 2.0);                                                       // background must not smear over a sharper foreground
            float w = smoothstep(r - 0.5, r + 0.5, c); acc += texture2D(tDiffuse, uv).rgb * w; wsum += w; }
          gl_FragColor = vec4(acc / wsum, 1.0); }` });
    this.fsQuad = new FullScreenQuad(this.material);
  }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms, cam = this.camera;
    u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture; u.uNear.value = cam.near; u.uFar.value = cam.far; u.uFocus.value = this.focus;
    // blur-circle scale in pixels for a full-frame-like lens: f^2 / (N * sensor) mapped to the frame height
    const f = 0.5 * 0.024 / Math.tan(cam.fov * Math.PI / 360), N = 2.8 / Math.max(0.05, this.aperture);
    u.uScale.value = f * f / (N * 0.024) * readBuffer.height * 1.0; u.uMax.value = Math.min(22, readBuffer.height * 0.014); u.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    if (this.renderToScreen) renderer.setRenderTarget(null); else renderer.setRenderTarget(writeBuffer);
    this.fsQuad.render(renderer);
  }
}
