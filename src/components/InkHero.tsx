import { useEffect, useRef, useState } from 'react'
import { InkFluid } from '../ink/InkFluid'
import './InkHero.css'

const FONT_FAMILY = '"Playfair Display", Georgia, "Times New Roman", serif'
const FONT_WEIGHT = 900

type Props = { name?: string }

export function InkHero({ name = 'stupienius' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<InkFluid | null>(null)
  const [released, setReleased] = useState(false)
  // no WebGL2 / float render targets: show the name as plain text instead
  const [fallback] = useState(() => !InkFluid.isSupported(document.createElement('canvas')))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || fallback) return
    let sim: InkFluid
    try {
      sim = new InkFluid(canvas, {
        text: name,
        fontFamily: FONT_FAMILY,
        fontWeight: FONT_WEIGHT,
        onReleased: () => setReleased(true),
        // ?fixed advances a fixed 1/60 s per frame, handy for recording the animation
        fixedStep: new URLSearchParams(location.search).has('fixed') ? 1 / 60 : undefined,
        manual: new URLSearchParams(location.search).has('manual'),
      })
      ;(window as unknown as { __ink?: InkFluid }).__ink = sim
    } catch (err) {
      console.warn('[InkHero] could not start the ink animation:', err)
      return
    }
    simRef.current = sim
    // the name is drawn with a web font: rebuild once it is ready
    document.fonts
      ?.load(`${FONT_WEIGHT} 100px "Playfair Display"`)
      .then(() => sim.refreshText())
      .catch(() => {})
    return () => {
      sim.destroy()
      simRef.current = null
    }
  }, [name, fallback])

  return (
    <section className="ink-hero" aria-label={name}>
      <canvas
        ref={canvasRef}
        className={`ink-hero__canvas ${released ? 'is-interactive' : ''}`}
        aria-hidden="true"
      />
      <h1 className={fallback ? 'ink-hero__fallback' : 'visually-hidden'}>{name}</h1>
    </section>
  )
}
