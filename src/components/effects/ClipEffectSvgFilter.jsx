import { memo, useMemo } from 'react'
import {
  getAnimatedEffectSettings,
  getFilterChainEffects,
} from '../../utils/effects'

/**
 * Renders the SVG filter that implements a clip's enabled chromatic-
 * aberration and film-grain effects, in their stack order. Vignette is not
 * included here – it is drawn as a DOM overlay above the filtered layer.
 *
 * The filter chain reads from `SourceGraphic` (the transformed clip layer)
 * and each effect consumes the result of the previous effect. Unknown effect
 * types are silently skipped so the filter never breaks when new effect
 * types are added.
 */
const ClipEffectSvgFilter = memo(function ClipEffectSvgFilter({ filterId, effects, clipTime }) {
  const nodes = useMemo(() => {
    if (!filterId) return null
    const active = getFilterChainEffects(effects || [], clipTime || 0)
    if (active.length === 0) return null

    let inputName = 'SourceGraphic'
    const children = []

    active.forEach((effect, index) => {
      if (effect.type === 'chromaticAberration') {
        const animated = getAnimatedEffectSettings({ keyframes: null }, effect, clipTime || 0)
        const amount = Number(animated.settings?.amount) || 0
        const angleRad = ((Number(animated.settings?.angle) || 0) * Math.PI) / 180
        const dx = Math.cos(angleRad) * amount
        const dy = Math.sin(angleRad) * amount

        const prefix = `${filterId}-ca-${index}`
        const redMatrixName = `${prefix}-rMat`
        const greenMatrixName = `${prefix}-gMat`
        const blueMatrixName = `${prefix}-bMat`
        const redOffsetName = `${prefix}-rOff`
        const blueOffsetName = `${prefix}-bOff`
        const blendOne = `${prefix}-rg`
        const blendTwo = `${prefix}-rgb`

        children.push(
          <feColorMatrix
            key={redMatrixName}
            in={inputName}
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result={redMatrixName}
          />,
          <feOffset
            key={redOffsetName}
            in={redMatrixName}
            dx={dx}
            dy={dy}
            result={redOffsetName}
          />,
          <feColorMatrix
            key={greenMatrixName}
            in={inputName}
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result={greenMatrixName}
          />,
          <feColorMatrix
            key={blueMatrixName}
            in={inputName}
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result={blueMatrixName}
          />,
          <feOffset
            key={blueOffsetName}
            in={blueMatrixName}
            dx={-dx}
            dy={-dy}
            result={blueOffsetName}
          />,
          <feBlend
            key={blendOne}
            in={redOffsetName}
            in2={greenMatrixName}
            mode="screen"
            result={blendOne}
          />,
          <feBlend
            key={blendTwo}
            in={blendOne}
            in2={blueOffsetName}
            mode="screen"
            result={blendTwo}
          />
        )

        inputName = blendTwo
      } else if (effect.type === 'filmGrain') {
        const animated = getAnimatedEffectSettings({ keyframes: null }, effect, clipTime || 0)
        const amount = Number(animated.settings?.amount) || 0
        const size = Math.max(0.5, Number(animated.settings?.size) || 1)
        const monochrome = Number(animated.settings?.monochrome) >= 0.5
        if (amount <= 0) return

        const prefix = `${filterId}-grain-${index}`
        const noiseName = `${prefix}-noise`
        const matrixName = `${prefix}-mat`
        const maskedName = `${prefix}-masked`
        const blendedName = `${prefix}-blended`

        // Frequency of SVG turbulence is cycles-per-unit. Size is in preview
        // pixels; a size of ~1 gives fine film grain and ~3 gives chunky VHS.
        const baseFrequency = 0.65 / Math.max(0.5, size)

        // Film-grain color matrix: move source alpha -> strength-driven alpha
        // and flatten RGB to grayscale (optionally, for mono toggle). Using
        // fractalNoise the turbulence output is in [0,1] across all channels.
        const strength = Math.max(0, Math.min(1, amount / 100)) * 0.55
        const matrixValues = monochrome
          ? [
              // Luminance weights -> gray
              0.299, 0.587, 0.114, 0, 0,
              0.299, 0.587, 0.114, 0, 0,
              0.299, 0.587, 0.114, 0, 0,
              0, 0, 0, strength, 0,
            ]
          : [
              1, 0, 0, 0, 0,
              0, 1, 0, 0, 0,
              0, 0, 1, 0, 0,
              0, 0, 0, strength, 0,
            ]

        // Use a time-dependent seed so grain crawls during playback. SVG
        // turbulence re-seeds on any attribute change.
        const seed = Math.floor(((clipTime || 0) * 30) % 4096) + index

        children.push(
          <feTurbulence
            key={noiseName}
            type="fractalNoise"
            baseFrequency={baseFrequency}
            numOctaves={1}
            seed={seed}
            stitchTiles="stitch"
            result={noiseName}
          />,
          <feColorMatrix
            key={matrixName}
            in={noiseName}
            type="matrix"
            values={matrixValues.join(' ')}
            result={matrixName}
          />,
          // Mask the grain to the source silhouette so transparency stays
          // intact and grain never spills into margins.
          <feComposite
            key={maskedName}
            in={matrixName}
            in2={inputName}
            operator="in"
            result={maskedName}
          />,
          <feBlend
            key={blendedName}
            in={inputName}
            in2={maskedName}
            mode="overlay"
            result={blendedName}
          />
        )

        inputName = blendedName
      } else if (effect.type === 'glow') {
        const animated = getAnimatedEffectSettings({ keyframes: null }, effect, clipTime || 0)
        const intensity = Number(animated.settings?.intensity) || 0
        const size = Math.max(0.1, Number(animated.settings?.size) || 0)
        const threshold = Math.max(0, Math.min(100, Number(animated.settings?.threshold) || 0))
        if (intensity <= 0 || size <= 0) return

        const prefix = `${filterId}-glow-${index}`
        const thresholdName = `${prefix}-thresh`
        const blurName = `${prefix}-blur`
        const boostName = `${prefix}-boost`
        const blendedName = `${prefix}-blended`

        // Build a piecewise-linear tableValues that maps:
        //   [0, threshold/100] -> 0
        //   [threshold/100, 1] -> ramp to 1 (softened via square)
        // Applied to R, G, B. Alpha preserved.
        const cutoff = threshold / 100
        // 9 sample table for a reasonably smooth threshold curve.
        const table = []
        for (let i = 0; i < 9; i++) {
          const x = i / 8
          let y
          if (x <= cutoff) {
            y = 0
          } else {
            const t = (x - cutoff) / Math.max(1e-4, 1 - cutoff)
            y = t * t
          }
          table.push(y.toFixed(4))
        }
        const tableValuesStr = table.join(' ')

        const intensityScale = Math.max(0, Math.min(2, intensity / 100))

        children.push(
          <feComponentTransfer
            key={thresholdName}
            in={inputName}
            result={thresholdName}
          >
            <feFuncR type="table" tableValues={tableValuesStr} />
            <feFuncG type="table" tableValues={tableValuesStr} />
            <feFuncB type="table" tableValues={tableValuesStr} />
            <feFuncA type="identity" />
          </feComponentTransfer>,
          <feGaussianBlur
            key={blurName}
            in={thresholdName}
            stdDeviation={size}
            result={blurName}
          />,
          <feComponentTransfer
            key={boostName}
            in={blurName}
            result={boostName}
          >
            <feFuncR type="linear" slope={intensityScale} />
            <feFuncG type="linear" slope={intensityScale} />
            <feFuncB type="linear" slope={intensityScale} />
            <feFuncA type="identity" />
          </feComponentTransfer>,
          <feBlend
            key={blendedName}
            in={inputName}
            in2={boostName}
            mode="screen"
            result={blendedName}
          />
        )

        inputName = blendedName
      }
    })

    if (inputName !== 'SourceGraphic' && children.length > 0) {
      // Final merge ensures the filter returns a rendered result.
      children.push(
        <feMerge key={`${filterId}-final-merge`}>
          <feMergeNode in={inputName} />
        </feMerge>
      )
    } else {
      return null
    }

    return children
  }, [filterId, effects, clipTime])

  if (!nodes) return null

  return (
    <svg
      aria-hidden
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      <defs>
        <filter
          id={filterId}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
          colorInterpolationFilters="sRGB"
        >
          {nodes}
        </filter>
      </defs>
    </svg>
  )
})

export default ClipEffectSvgFilter
