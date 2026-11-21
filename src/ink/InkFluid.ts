import * as S from './shaders'

/**
 * Ink-in-water hero animation.
 *
 * Timeline (seconds):
 *   0.00  white page
 *   DROP  an ink blob lands in the middle and churns
 *   PULL  the blob draws in on itself (anticipation)
 *   BURST the blob bursts and ink is flung across nearly the whole screen
 *   GATHER the ink is drawn back in and condenses into the name
 *   FORM  letters start to sharpen out of the cloud
 *   SET   the ink settles into crisp letters and holds
 *   FREE  the letters are released and dissolve like ink in water;
 *         only from here on does the pointer stir the water.
 */

export interface InkFluidOptions {
  text: string
  fontFamily?: string
  fontWeight?: string | number
  /** Advance the simulation by a fixed step each frame (for recordings / screenshots). */
  fixedStep?: number
  /** Do not advance on animation frames; drive the clock with `advance()` (for capturing stills). */
  manual?: boolean
  /** Called once the name has been released into the water. */
  onReleased?: () => void
}

const T = {
  DROP: 0.35,
  PULL: 1.45,
  BURST: 1.85,
  GATHER: 2.65,
  FORM: 3.2,
  SET: 3.85,
  FREE: 5.4,
}

const CONFIG = {
  simRes: 160,
  dyeRes: 1080,
  pressureIterations: 22,
  curl: 3,
  velocityDissipation: 0.6,
  dyeDissipation: 0.1,
  textDensity: 4.2,
  stirForce: 3600,
  stirRadius: 0.0022,
}

type Program = {
  program: WebGLProgram
  u: Record<string, WebGLUniformLocation>
}

type FBO = {
  tex: WebGLTexture
  fbo: WebGLFramebuffer
  w: number
  h: number
  tx: number
  ty: number
  attach: (id: number) => number
}

type DoubleFBO = {
  w: number
  h: number
  tx: number
  ty: number
  read: FBO
  write: FBO
  swap: () => void
}

type Particle = {
  sx: number
  sy: number
  ex: number
  ey: number
  /** far point the ink is flung to before it is drawn back */
  mx: number
  my: number
  delay: number
  /** duration of the outward fling */
  out: number
  /** duration of the gather into the letter */
  back: number
  bulge: number
  px: number
  py: number
}

const SUBSTEPS = 3

export class InkFluid {
  private canvas: HTMLCanvasElement
  readonly gl: WebGL2RenderingContext
  private opts: InkFluidOptions
  private programs!: Record<string, Program>
  private quadVao!: WebGLVertexArrayObject
  private particleVao!: WebGLVertexArrayObject
  private particleBuf!: WebGLBuffer
  private particleData = new Float32Array(0)
  private maskTex!: WebGLTexture

  private velocity!: DoubleFBO
  private dye!: DoubleFBO
  private pressure!: DoubleFBO
  private divergence!: FBO
  private curlFbo!: FBO

  private particles: Particle[] = []
  private raf = 0
  private lastNow = 0
  private time = 0
  private fired = new Set<string>()
  private releasedNotified = false
  private seed = Math.random() * 100
  private pointer = { x: 0, y: 0, dx: 0, dy: 0, moved: false, inside: false }
  private resizeObs: ResizeObserver
  private destroyed = false

  static isSupported(canvas: HTMLCanvasElement): boolean {
    const gl = canvas.getContext('webgl2')
    return !!gl && !!gl.getExtension('EXT_color_buffer_float')
  }

  constructor(canvas: HTMLCanvasElement, opts: InkFluidOptions) {
    this.canvas = canvas
    this.opts = opts
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      preserveDrawingBuffer: false,
    })
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('WebGL2 with float render targets is not available')
    }
    this.gl = gl
    gl.getExtension('OES_texture_float_linear')
    this.initGeometry()
    this.initPrograms()
    this.resizeCanvas()
    this.initFramebuffers()
    this.buildMask()

    this.resizeObs = new ResizeObserver(() => this.handleResize())
    this.resizeObs.observe(canvas)
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    window.addEventListener('pointerdown', this.onPointerMove, { passive: true })
    document.addEventListener('pointerleave', this.onPointerLeave)

    this.lastNow = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  /** Start the whole sequence again from a white page. */
  replay() {
    this.time = 0
    this.fired.clear()
    this.releasedNotified = false
    this.particles = []
    this.seed = Math.random() * 100
    this.clearAll()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerdown', this.onPointerMove)
    document.removeEventListener('pointerleave', this.onPointerLeave)
    const gl = this.gl
    for (const f of [this.velocity, this.dye, this.pressure]) {
      this.deleteFbo(f.read)
      this.deleteFbo(f.write)
    }
    this.deleteFbo(this.divergence)
    this.deleteFbo(this.curlFbo)
    gl.deleteTexture(this.maskTex)
    gl.deleteBuffer(this.particleBuf)
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.program)
  }

  /** Rebuild the text mask, e.g. after a web font finished loading. */
  refreshText() {
    this.buildMask()
    if (this.time < T.BURST) this.particles = []
  }

  // ---------------------------------------------------------------- setup

  private initGeometry() {
    const gl = this.gl
    this.quadVao = gl.createVertexArray()!
    gl.bindVertexArray(this.quadVao)
    const vb = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, vb)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW)
    const ib = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.enableVertexAttribArray(0)

    this.particleVao = gl.createVertexArray()!
    gl.bindVertexArray(this.particleVao)
    this.particleBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 8)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16)
    gl.enableVertexAttribArray(2)
    gl.bindVertexArray(null)
  }

  private initPrograms() {
    const quad = (frag: string) => this.makeProgram(S.baseVert, frag, { aPosition: 0 })
    this.programs = {
      copy: quad(S.copyFrag),
      multiply: quad(S.multiplyFrag),
      splat: quad(S.splatFrag),
      radial: quad(S.radialFrag),
      blob: quad(S.blobFrag),
      imprint: quad(S.imprintFrag),
      ambient: quad(S.ambientFrag),
      viscosity: quad(S.viscosityFrag),
      advection: quad(S.advectionFrag),
      divergence: quad(S.divergenceFrag),
      curl: quad(S.curlFrag),
      vorticity: quad(S.vorticityFrag),
      pressure: quad(S.pressureFrag),
      gradientSubtract: quad(S.gradientSubtractFrag),
      display: quad(S.displayFrag),
      particle: this.makeProgram(S.particleVert, S.particleFrag, { aPos: 0, aVel: 1, aInk: 2 }),
    }
  }

  private makeProgram(vsSrc: string, fsSrc: string, attribs: Record<string, number>): Program {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed')
      }
      return sh
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSrc))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSrc))
    for (const [name, loc] of Object.entries(attribs)) gl.bindAttribLocation(program, loc, name)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed')
    }
    const u: Record<string, WebGLUniformLocation> = {}
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(program, i)!.name
      u[name] = gl.getUniformLocation(program, name)!
    }
    return { program, u }
  }

  private resolution(res: number) {
    const w = this.gl.drawingBufferWidth
    const h = this.gl.drawingBufferHeight
    const aspect = w / h
    const short = Math.round(Math.min(res, Math.min(w, h)))
    return aspect >= 1
      ? { w: Math.round(short * aspect), h: short }
      : { w: short, h: Math.round(short / aspect) }
  }

  private createFbo(w: number, h: number): FBO {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0)
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return {
      tex,
      fbo,
      w,
      h,
      tx: 1 / w,
      ty: 1 / h,
      attach: (id: number) => {
        gl.activeTexture(gl.TEXTURE0 + id)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        return id
      },
    }
  }

  private createDouble(w: number, h: number): DoubleFBO {
    const d: DoubleFBO = {
      w,
      h,
      tx: 1 / w,
      ty: 1 / h,
      read: this.createFbo(w, h),
      write: this.createFbo(w, h),
      swap: () => {
        const t = d.read
        d.read = d.write
        d.write = t
      },
    }
    return d
  }

  private deleteFbo(f: FBO) {
    this.gl.deleteTexture(f.tex)
    this.gl.deleteFramebuffer(f.fbo)
  }

  /** Create (or recreate at a new size, carrying the old content over) all render targets. */
  private initFramebuffers() {
    const sim = this.resolution(CONFIG.simRes)
    const dye = this.resolution(CONFIG.dyeRes)
    const resize = (old: DoubleFBO | undefined, w: number, h: number) => {
      const next = this.createDouble(w, h)
      if (old) {
        const p = this.programs.copy
        this.gl.useProgram(p.program)
        this.gl.uniform1i(p.u.uTexture, old.read.attach(0))
        this.gl.uniform2f(p.u.texelSize, next.tx, next.ty)
        this.blit(next.read)
        this.deleteFbo(old.read)
        this.deleteFbo(old.write)
      }
      return next
    }
    this.velocity = resize(this.velocity, sim.w, sim.h)
    this.dye = resize(this.dye, dye.w, dye.h)
    if (this.pressure) {
      this.deleteFbo(this.pressure.read)
      this.deleteFbo(this.pressure.write)
      this.deleteFbo(this.divergence)
      this.deleteFbo(this.curlFbo)
    }
    this.pressure = this.createDouble(sim.w, sim.h)
    this.divergence = this.createFbo(sim.w, sim.h)
    this.curlFbo = this.createFbo(sim.w, sim.h)
  }

  private clearAll() {
    const gl = this.gl
    gl.clearColor(0, 0, 0, 1)
    for (const d of [this.velocity, this.dye, this.pressure]) {
      for (const f of [d.read, d.write]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
    }
  }

  private resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      return true
    }
    return false
  }

  private handleResize() {
    if (this.destroyed) return
    if (this.resizeCanvas()) {
      this.initFramebuffers()
      this.buildMask()
      if (this.time < T.BURST) this.particles = []
    }
  }

  /** Draw the name into an offscreen canvas the size of the dye grid. */
  private buildMask() {
    const gl = this.gl
    const { w, h } = this.dye
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    const family = this.opts.fontFamily ?? '"Helvetica Neue", Arial, sans-serif'
    const weight = this.opts.fontWeight ?? 800
    ctx.font = `${weight} 100px ${family}`
    const m = ctx.measureText(this.opts.text)
    const textH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
    const size = Math.min((w * 0.8) / m.width, (h * 0.26) / textH) * 100
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    ctx.font = `${weight} ${size}px ${family}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const m2 = ctx.measureText(this.opts.text)
    const baseline = h / 2 + (m2.actualBoundingBoxAscent - m2.actualBoundingBoxDescent) / 2
    ctx.fillStyle = '#fff'
    ctx.fillText(this.opts.text, w / 2, baseline)

    if (!this.maskTex) this.maskTex = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    // collect points inside the letters for the particle targets
    const img = ctx.getImageData(0, 0, w, h).data
    const step = Math.max(1, Math.round(Math.sqrt((w * h) / 260000)))
    const pts: number[] = []
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (img[(y * w + x) * 4] > 160) pts.push(x / w, 1 - y / h)
      }
    }
    this.targets = pts
  }

  private targets: number[] = []

  // ---------------------------------------------------------------- pointer

  private onPointerMove = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = 1 - (e.clientY - r.top) / r.height
    const inside = x >= 0 && x <= 1 && y >= 0 && y <= 1
    if (this.pointer.inside && inside && e.type === 'pointermove') {
      this.pointer.dx += x - this.pointer.x
      this.pointer.dy += y - this.pointer.y
      this.pointer.moved = true
    }
    this.pointer.x = x
    this.pointer.y = y
    this.pointer.inside = inside
  }

  private onPointerLeave = () => {
    this.pointer.inside = false
  }

  // ---------------------------------------------------------------- frame

  private frame = (now: number) => {
    if (this.destroyed) return
    const dt = this.opts.fixedStep ?? Math.min((now - this.lastNow) / 1000, 1 / 30)
    this.lastNow = now
    if (!this.opts.manual) this.step(dt)
    this.render()
    this.raf = requestAnimationFrame(this.frame)
  }

  private once(key: string, at: number, fn: () => void) {
    if (this.time >= at && !this.fired.has(key)) {
      this.fired.add(key)
      fn()
    }
  }

  /** Run the simulation forward by `seconds` in 1/60 s steps. */
  advance(seconds: number) {
    const n = Math.round(seconds * 60)
    for (let i = 0; i < n; i++) this.step(1 / 60)
    this.render()
  }

  /** Seconds of animation played so far. */
  get elapsed() {
    return this.time
  }

  private get aspect() {
    return this.canvas.width / this.canvas.height
  }

  private step(dt: number) {
    const gl = this.gl
    const t0 = this.time
    this.time += dt
    const t = this.time
    gl.disable(gl.BLEND)

    // ---- choreography
    this.once('drop', T.DROP, () => {
      this.blob(0.5, 0.5, 0.075, 4.5)
      const a = this.aspect
      for (let i = 0; i < 7; i++) {
        const ang = Math.random() * Math.PI * 2
        const r = 0.06 + Math.random() * 0.05
        this.blob(0.5 + (Math.cos(ang) * r) / a, 0.5 + Math.sin(ang) * r, 0.012 + Math.random() * 0.02, 2.5)
      }
      this.radial(0.5, 0.5, 0.012, 260, 90)
    })
    if (t > T.DROP && t < T.PULL) {
      // keep the blob churning slowly
      const k = Math.sin(t * 2.3) * 40
      this.radial(0.5, 0.5, 0.006, 0, k * dt * 4)
    }
    this.once('pull', T.PULL, () => this.radial(0.5, 0.5, 0.02, -320, 40))
    this.once('burst', T.BURST, () => {
      // a hard, wide blast: the blob's own ink is blown across the screen
      this.radial(0.5, 0.5, 0.05, 1400, 0)
      this.spawnParticles()
    })
    if (t > T.BURST && t < T.BURST + 0.25) {
      // keep pushing for a moment so the cloud reaches the edges
      this.radial(0.5, 0.5, 0.08, 2600 * dt, 0)
    }

    // ---- solver
    this.solveVelocity(dt, t)

    // ---- particles (after projection so their momentum shows up next frame too)
    if (this.particles.length && t > T.BURST && t0 < T.SET + 0.3) {
      this.updateParticles(t - T.BURST, dt)
    }

    // ---- dye
    // while the blast is flinging ink outward, thin it so the screen fills with
    // layered grey-black clouds instead of one solid slab
    const blast = t > T.BURST && t < T.GATHER + 0.2 ? 1.6 * smoothstep(T.BURST, T.BURST + 0.3, t) : 0
    const dyeDiss = t > T.FREE ? CONFIG.dyeDissipation : blast
    this.advect(this.dye, dt, dyeDiss)

    // ---- hold the letters crisp, then let go
    if (t > T.GATHER && t < T.FREE + 0.6) {
      // the cloud clears while the letters condense out of it, hold, then are let go
      const ramp = smoothstep(T.FORM, T.SET + 0.3, t) * (1 - smoothstep(T.FREE, T.FREE + 0.6, t))
      const clean = t < T.FREE ? smoothstep(T.GATHER - 0.1, T.GATHER + 0.35, t) : 0
      this.imprint(ramp, Math.pow(0.004, dt * clean))
    }
    if (t > T.FREE && !this.releasedNotified) {
      this.releasedNotified = true
      this.opts.onReleased?.()
    }
  }

  private solveVelocity(dt: number, t: number) {
    const gl = this.gl
    const P = this.programs
    const vel = this.velocity

    // pointer stirring
    // the pointer only stirs once the name has formed and begun to dissolve
    if (this.pointer.moved && t > T.FREE) {
      const p = P.splat
      gl.useProgram(p.program)
      gl.uniform2f(p.u.texelSize, vel.tx, vel.ty)
      gl.uniform1i(p.u.uTarget, vel.read.attach(0))
      gl.uniform1f(p.u.aspectRatio, this.aspect)
      gl.uniform2f(p.u.point, this.pointer.x, this.pointer.y)
      gl.uniform3f(p.u.color, this.pointer.dx * this.aspect * CONFIG.stirForce, this.pointer.dy * CONFIG.stirForce, 0)
      gl.uniform1f(p.u.radius, CONFIG.stirRadius * Math.max(1, this.aspect) * 0.6)
      this.blit(vel.write)
      vel.swap()
    }
    this.pointer.dx = this.pointer.dy = 0
    this.pointer.moved = false

    // ambient water currents once the name is released
    const amb = smoothstep(T.FREE - 0.2, T.FREE + 7, t)
    if (amb > 0) {
      const p = P.ambient
      gl.useProgram(p.program)
      gl.uniform2f(p.u.texelSize, vel.tx, vel.ty)
      gl.uniform1i(p.u.uVelocity, vel.read.attach(0))
      gl.uniform1i(p.u.uDye, this.dye.read.attach(1))
      gl.uniform1f(p.u.aspectRatio, this.aspect)
      gl.uniform1f(p.u.time, t + this.seed)
      gl.uniform1f(p.u.amp, 4 * amb)
      gl.uniform1f(p.u.sink, 1.3 * amb)
      gl.uniform1f(p.u.dt, dt)
      this.blit(vel.write)
      vel.swap()
    }

    // gentle viscosity once the water is calm enough to show grid noise
    const visc = smoothstep(T.FORM, T.SET, t) * 0.5
    if (visc > 0) {
      const p = P.viscosity
      gl.useProgram(p.program)
      gl.uniform2f(p.u.texelSize, vel.tx, vel.ty)
      gl.uniform1i(p.u.uVelocity, vel.read.attach(0))
      gl.uniform1f(p.u.amount, visc)
      this.blit(vel.write)
      vel.swap()
    }

    // damp the water while the letters hold
    if (t > T.FORM && t < T.FREE) {
      this.multiply(vel, Math.pow(0.004, dt * smoothstep(T.FORM, T.SET, t)))
    }

    // vorticity confinement
    gl.useProgram(P.curl.program)
    gl.uniform2f(P.curl.u.texelSize, vel.tx, vel.ty)
    gl.uniform1i(P.curl.u.uVelocity, vel.read.attach(0))
    this.blit(this.curlFbo)

    gl.useProgram(P.vorticity.program)
    gl.uniform2f(P.vorticity.u.texelSize, vel.tx, vel.ty)
    gl.uniform1i(P.vorticity.u.uVelocity, vel.read.attach(0))
    gl.uniform1i(P.vorticity.u.uCurl, this.curlFbo.attach(1))
    gl.uniform1f(P.vorticity.u.curl, CONFIG.curl)
    gl.uniform1f(P.vorticity.u.dt, dt)
    this.blit(vel.write)
    vel.swap()

    // projection
    gl.useProgram(P.divergence.program)
    gl.uniform2f(P.divergence.u.texelSize, vel.tx, vel.ty)
    gl.uniform1i(P.divergence.u.uVelocity, vel.read.attach(0))
    this.blit(this.divergence)

    this.multiply(this.pressure, 0.8)

    gl.useProgram(P.pressure.program)
    gl.uniform2f(P.pressure.u.texelSize, vel.tx, vel.ty)
    gl.uniform1i(P.pressure.u.uDivergence, this.divergence.attach(0))
    for (let i = 0; i < CONFIG.pressureIterations; i++) {
      gl.uniform1i(P.pressure.u.uPressure, this.pressure.read.attach(1))
      this.blit(this.pressure.write)
      this.pressure.swap()
    }

    gl.useProgram(P.gradientSubtract.program)
    gl.uniform2f(P.gradientSubtract.u.texelSize, vel.tx, vel.ty)
    gl.uniform1i(P.gradientSubtract.u.uPressure, this.pressure.read.attach(0))
    gl.uniform1i(P.gradientSubtract.u.uVelocity, vel.read.attach(1))
    this.blit(vel.write)
    vel.swap()

    this.advect(vel, dt, CONFIG.velocityDissipation)
  }

  private advect(target: DoubleFBO, dt: number, dissipation: number) {
    const gl = this.gl
    const p = this.programs.advection
    gl.useProgram(p.program)
    gl.uniform2f(p.u.texelSize, this.velocity.tx, this.velocity.ty)
    gl.uniform1i(p.u.uVelocity, this.velocity.read.attach(0))
    gl.uniform1i(p.u.uSource, target.read.attach(target === this.velocity ? 0 : 1))
    gl.uniform1f(p.u.dt, dt)
    gl.uniform1f(p.u.dissipation, dissipation)
    this.blit(target.write)
    target.swap()
  }

  private multiply(target: DoubleFBO, value: number) {
    const gl = this.gl
    const p = this.programs.multiply
    gl.useProgram(p.program)
    gl.uniform2f(p.u.texelSize, target.tx, target.ty)
    gl.uniform1i(p.u.uTexture, target.read.attach(0))
    gl.uniform1f(p.u.value, value)
    this.blit(target.write)
    target.swap()
  }

  private blob(x: number, y: number, radius: number, amount: number) {
    const gl = this.gl
    const p = this.programs.blob
    gl.useProgram(p.program)
    gl.uniform2f(p.u.texelSize, this.dye.tx, this.dye.ty)
    gl.uniform1i(p.u.uTarget, this.dye.read.attach(0))
    gl.uniform1f(p.u.aspectRatio, this.aspect)
    gl.uniform2f(p.u.point, x, y)
    gl.uniform1f(p.u.radius, radius * Math.min(1, this.aspect) ** 0.5)
    gl.uniform1f(p.u.amount, amount)
    gl.uniform1f(p.u.seed, this.seed + x * 13.1 + y * 7.7)
    this.blit(this.dye.write)
    this.dye.swap()
  }

  private radial(x: number, y: number, radius: number, strength: number, swirl: number) {
    const gl = this.gl
    const p = this.programs.radial
    const v = this.velocity
    gl.useProgram(p.program)
    gl.uniform2f(p.u.texelSize, v.tx, v.ty)
    gl.uniform1i(p.u.uTarget, v.read.attach(0))
    gl.uniform1f(p.u.aspectRatio, this.aspect)
    gl.uniform2f(p.u.point, x, y)
    gl.uniform1f(p.u.radius, radius)
    gl.uniform1f(p.u.strength, strength)
    gl.uniform1f(p.u.swirl, swirl)
    gl.uniform1f(p.u.seed, this.seed)
    this.blit(v.write)
    v.swap()
  }

  private imprint(alpha: number, outsideKeep: number) {
    const gl = this.gl
    const p = this.programs.imprint
    gl.useProgram(p.program)
    gl.uniform2f(p.u.texelSize, this.dye.tx, this.dye.ty)
    gl.uniform1i(p.u.uDye, this.dye.read.attach(0))
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex)
    gl.uniform1i(p.u.uMask, 1)
    gl.uniform1f(p.u.target, CONFIG.textDensity)
    gl.uniform1f(p.u.alpha, alpha)
    gl.uniform1f(p.u.outsideKeep, outsideKeep)
    this.blit(this.dye.write)
    this.dye.swap()
  }

  // ---------------------------------------------------------------- particles

  private spawnParticles() {
    const pts = this.targets
    const count = Math.min(pts.length / 2, 14000)
    const a = this.aspect
    const list: Particle[] = []
    for (let i = 0; i < count; i++) {
      const k = Math.floor(Math.random() * (pts.length / 2)) * 2
      const ex = pts[k]
      const ey = pts[k + 1]
      // start somewhere inside the blob (gaussian), in aspect-corrected space
      const r = Math.sqrt(-2 * Math.log(Math.random() + 1e-6)) * 0.035
      const th = Math.random() * Math.PI * 2
      const sx = 0.5 + (Math.cos(th) * r) / a
      const sy = 0.5 + Math.sin(th) * r
      // fling outward, roughly away from the centre, reaching most of the screen
      const ang = Math.atan2(ey - 0.5, (ex - 0.5) * a) * 0.35 + Math.random() * Math.PI * 2
      const dirX = Math.cos(ang)
      const dirY = Math.sin(ang)
      // distance (aspect space) from the centre to the screen edge along this direction
      const edge = Math.min(
        Math.abs(dirX) > 1e-4 ? (0.5 * a) / Math.abs(dirX) : 1e9,
        Math.abs(dirY) > 1e-4 ? 0.5 / Math.abs(dirY) : 1e9,
      )
      const reach = edge * (0.45 + 0.5 * Math.sqrt(Math.random()))
      const mx = 0.5 + (dirX * reach) / a
      const my = 0.5 + dirY * reach
      list.push({
        sx,
        sy,
        ex,
        ey,
        mx,
        my,
        delay: Math.random() * 0.08,
        out: 0.55 + Math.random() * 0.25,
        back: 0.85 + Math.random() * 0.45,
        bulge: (Math.random() - 0.5) * 0.35,
        px: sx,
        py: sy,
      })
    }
    this.particles = list
    this.particleData = new Float32Array(count * SUBSTEPS * 5)
  }

  private updateParticles(t: number, dt: number) {
    const gl = this.gl
    const a = this.aspect
    const data = this.particleData
    const velScaleX = this.velocity.w
    const velScaleY = this.velocity.h
    const gatherAt = T.GATHER - T.BURST
    let n = 0
    for (const p of this.particles) {
      const u = t - p.delay
      let x = -10
      let y = -10
      let vx = 0
      let vy = 0
      let ink = 0
      const vBack = (u - gatherAt) / p.back
      if (u > 0 && vBack < 1.05) {
        let fx: number, fy: number, tx: number, ty: number, e: number, bulge: number
        if (u < gatherAt) {
          // outward: explosive start, coasting to a stop near the edges
          const v = Math.min(u / p.out, 1)
          e = 1 - Math.pow(1 - v, 4)
          fx = p.sx
          fy = p.sy
          tx = p.mx
          ty = p.my
          bulge = p.bulge * 0.4
          ink = 0.15 + 0.35 * e
        } else {
          // gather: slow start, accelerating in, easing onto the letter
          const v = Math.min(vBack, 1)
          e = v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2
          fx = p.mx
          fy = p.my
          tx = p.ex
          ty = p.ey
          bulge = p.bulge
          // the gathering ink is drawn fresh each frame while the old cloud clears,
          // so what you see is the cloud itself being pulled into the letters
          ink = 0.9 + 1.6 * Math.pow(e, 4)
        }
        // straight line plus a sideways bow, computed in aspect-corrected space
        const dx = (tx - fx) * a
        const dy = ty - fy
        const len = Math.hypot(dx, dy) + 1e-6
        const bow = Math.sin(Math.PI * e) * bulge * len
        x = fx + (dx * e + (-dy / len) * bow) / a
        y = fy + dy * e + (dx / len) * bow
        vx = ((x - p.px) / dt) * velScaleX
        vy = ((y - p.py) / dt) * velScaleY
      }
      const fromX = x === -10 ? x : p.px
      const fromY = y === -10 ? y : p.py
      for (let s = 0; s < SUBSTEPS; s++) {
        const f = (s + 1) / SUBSTEPS
        data[n++] = fromX + (x - fromX) * f
        data[n++] = fromY + (y - fromY) * f
        data[n++] = vx
        data[n++] = vy
        data[n++] = ink
      }
      p.px = x === -10 ? p.px : x
      p.py = y === -10 ? p.py : y
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW)
    const prog = this.programs.particle
    gl.useProgram(prog.program)
    gl.bindVertexArray(this.particleVao)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    const count = data.length / 5

    // momentum into the water
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.velocity.read.fbo)
    gl.viewport(0, 0, this.velocity.w, this.velocity.h)
    gl.uniform1i(prog.u.mode, 1)
    gl.uniform1f(prog.u.pointSize, 3)
    gl.uniform1f(prog.u.amount, 0)
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE)
    gl.blendColor(0, 0, 0, 0.009 / SUBSTEPS)
    gl.drawArrays(gl.POINTS, 0, count)

    // ink trails
    gl.blendFunc(gl.ONE, gl.ONE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dye.read.fbo)
    gl.viewport(0, 0, this.dye.w, this.dye.h)
    gl.uniform1i(prog.u.mode, 0)
    // fine spray on the way out, soft fat droplets while gathering
    const gathering = smoothstep(T.GATHER - T.BURST - 0.2, T.GATHER - T.BURST + 0.3, t)
    gl.uniform1f(prog.u.pointSize, Math.max(2, this.dye.h * (0.0065 + 0.006 * gathering)))
    gl.uniform1f(prog.u.amount, 0.07 / SUBSTEPS)
    gl.drawArrays(gl.POINTS, 0, count)

    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
  }

  // ---------------------------------------------------------------- output

  private blit(target: FBO | null) {
    const gl = this.gl
    gl.bindVertexArray(this.quadVao)
    if (target) {
      gl.viewport(0, 0, target.w, target.h)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo)
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
  }

  private render() {
    const gl = this.gl
    const p = this.programs.display
    gl.useProgram(p.program)
    gl.uniform2f(p.u.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight)
    gl.uniform1i(p.u.uDye, this.dye.read.attach(0))
    gl.uniform3f(p.u.paper, 0.985, 0.98, 0.968)
    gl.uniform3f(p.u.absorb, 1.12, 1.0, 0.86)
    this.blit(null)
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
