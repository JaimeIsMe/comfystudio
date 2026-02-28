import React from 'react'
import {
  AbsoluteFill,
  Composition,
  interpolate,
  registerRoot,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

const TEMPLATE_IDS = Object.freeze([
  'lower-third',
  'cinematic-lower-third',
  'corner-bug',
  'cta-banner',
  'split-title',
  'title-card',
  'end-slate',
  'caption-strip',
])

const DEFAULT_PROPS = Object.freeze({
  width: 1920,
  height: 1080,
  fps: 30,
  durationSec: 4,
  durationInFrames: 120,
  template: 'lower-third',
  title: 'ComfyStudio',
  subtitle: 'Transparent motion overlay',
  accentColor: '#f59e0b',
  textColor: '#ffffff',
  panelOpacity: 0.72,
})

const clampNumber = (value, min, max, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

const sanitizeColor = (value, fallback) => {
  const text = String(value || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text
  return fallback
}

const resolveTemplate = (value, fallback = DEFAULT_PROPS.template) => {
  const template = String(value || '').trim().toLowerCase()
  return TEMPLATE_IDS.includes(template) ? template : fallback
}

const normalizeProps = (input = {}) => {
  const fps = Math.round(clampNumber(input.fps, 12, 60, DEFAULT_PROPS.fps))
  const width = Math.round(clampNumber(input.width, 256, 4096, DEFAULT_PROPS.width))
  const height = Math.round(clampNumber(input.height, 256, 4096, DEFAULT_PROPS.height))
  const durationSec = clampNumber(input.durationSec, 0.5, 20, DEFAULT_PROPS.durationSec)
  const durationInFrames = Math.max(
    2,
    Math.round(clampNumber(input.durationInFrames, 2, fps * 120, durationSec * fps))
  )

  return {
    fps,
    width,
    height,
    durationSec,
    durationInFrames,
    template: resolveTemplate(input.template, DEFAULT_PROPS.template),
    title: String(input.title ?? DEFAULT_PROPS.title).trim().slice(0, 120),
    subtitle: String(input.subtitle ?? DEFAULT_PROPS.subtitle).trim().slice(0, 180),
    accentColor: sanitizeColor(input.accentColor, DEFAULT_PROPS.accentColor),
    textColor: sanitizeColor(input.textColor, DEFAULT_PROPS.textColor),
    panelOpacity: clampNumber(input.panelOpacity, 0.05, 1, DEFAULT_PROPS.panelOpacity),
  }
}

const getTemplateMotion = (frame, props, options = {}) => {
  const inFrames = Math.max(6, Math.round(props.fps * (options.inSec || 0.34)))
  const outFrames = Math.max(6, Math.round(props.fps * (options.outSec || 0.36)))
  const outStartFrame = Math.max(0, props.durationInFrames - outFrames)

  const enter = spring({
    fps: props.fps,
    frame,
    durationInFrames: inFrames,
    config: {
      damping: options.damping || 180,
      stiffness: options.stiffness || 220,
      mass: options.mass || 0.82,
    },
  })

  const exitOpacity = frame < outStartFrame
    ? 1
    : interpolate(frame, [outStartFrame, props.durationInFrames], [1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })

  return { enter, exitOpacity }
}

const LowerThirdTemplate = ({ frame, props }) => {
  const motion = getTemplateMotion(frame, props, { inSec: 0.38, outSec: 0.42, damping: 200, stiffness: 220 })
  const xTranslate = interpolate(motion.enter, [0, 1], [-120, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const titleFade = interpolate(motion.enter, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const subtitleFade = interpolate(motion.enter, [0.18, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const accentGrow = interpolate(motion.enter, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const panelPaddingY = Math.max(14, Math.round(props.height * 0.018))
  const panelPaddingX = Math.max(18, Math.round(props.width * 0.013))
  const baseLeft = Math.max(36, Math.round(props.width * 0.06))
  const baseBottom = Math.max(28, Math.round(props.height * 0.065))
  const maxPanelWidth = Math.min(Math.round(props.width * 0.8), 1320)

  return (
    <div
      style={{
        position: 'absolute',
        left: baseLeft,
        bottom: baseBottom,
        width: maxPanelWidth,
        transform: `translateX(${xTranslate}px)`,
        opacity: motion.exitOpacity,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'stretch',
        fontFamily: 'Inter, Arial, Helvetica, sans-serif',
      }}
    >
      <div
        style={{
          width: Math.max(8, Math.round(props.height * 0.0065)),
          borderRadius: 999,
          backgroundColor: props.accentColor,
          transform: `scaleY(${accentGrow})`,
          transformOrigin: 'bottom center',
          boxShadow: `0 0 18px ${props.accentColor}55`,
        }}
      />
      <div
        style={{
          marginLeft: Math.max(10, Math.round(props.width * 0.006)),
          padding: `${panelPaddingY}px ${panelPaddingX}px`,
          backgroundColor: `rgba(0,0,0,${props.panelOpacity})`,
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: Math.max(12, Math.round(props.height * 0.014)),
          boxShadow: '0 14px 30px rgba(0,0,0,0.35)',
        }}
      >
        <div
          style={{
            color: props.textColor,
            fontWeight: 800,
            letterSpacing: '0.01em',
            lineHeight: 1.05,
            textTransform: 'uppercase',
            fontSize: Math.max(34, Math.round(props.height * 0.048)),
            opacity: titleFade,
          }}
        >
          {props.title || 'Your Title'}
        </div>
        {props.subtitle ? (
          <div
            style={{
              marginTop: Math.max(8, Math.round(props.height * 0.006)),
              color: props.textColor,
              fontSize: Math.max(18, Math.round(props.height * 0.024)),
              fontWeight: 500,
              letterSpacing: '0.005em',
              lineHeight: 1.2,
              opacity: subtitleFade * 0.96,
            }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const CinematicLowerThirdTemplate = ({ frame, props }) => {
  const motion = getTemplateMotion(frame, props, { inSec: 0.42, outSec: 0.45, damping: 190, stiffness: 200 })
  const y = interpolate(motion.enter, [0, 1], [90, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const lineGrow = interpolate(motion.enter, [0, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const titleFade = interpolate(motion.enter, [0.1, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const subtitleFade = interpolate(motion.enter, [0.24, 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const bottom = Math.max(26, Math.round(props.height * 0.06))
  const panelHeight = Math.max(96, Math.round(props.height * 0.16))
  const titleSize = Math.max(32, Math.round(props.height * 0.045))
  const subtitleSize = Math.max(16, Math.round(props.height * 0.021))
  const sidePad = Math.max(22, Math.round(props.width * 0.02))

  return (
    <div
      style={{
        position: 'absolute',
        left: '8%',
        right: '8%',
        bottom,
        height: panelHeight,
        transform: `translateY(${y}px)`,
        opacity: motion.exitOpacity,
        borderRadius: Math.max(10, Math.round(props.height * 0.012)),
        backgroundColor: `rgba(0,0,0,${Math.min(0.95, props.panelOpacity + 0.1)})`,
        border: '1px solid rgba(255,255,255,0.22)',
        boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
        overflow: 'hidden',
        fontFamily: 'Inter, Arial, Helvetica, sans-serif',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: Math.max(4, Math.round(props.height * 0.004)),
          backgroundColor: props.accentColor,
          transform: `scaleX(${lineGrow})`,
          transformOrigin: 'left center',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, padding: `${Math.max(18, Math.round(props.height * 0.022))}px ${sidePad}px` }}>
        <div
          style={{
            color: props.textColor,
            opacity: titleFade,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontSize: titleSize,
            lineHeight: 1.05,
          }}
        >
          {props.title || 'Cinematic Title'}
        </div>
        {props.subtitle ? (
          <div
            style={{
              marginTop: Math.max(8, Math.round(props.height * 0.008)),
              color: props.textColor,
              opacity: subtitleFade * 0.95,
              fontWeight: 500,
              letterSpacing: '0.015em',
              fontSize: subtitleSize,
              lineHeight: 1.2,
            }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const CornerBugTemplate = ({ frame, props }) => {
  const motion = getTemplateMotion(frame, props, { inSec: 0.26, outSec: 0.28, damping: 210, stiffness: 250 })
  const scale = interpolate(motion.enter, [0, 1], [0.82, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const x = interpolate(motion.enter, [0, 1], [56, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const pulse = 0.92 + Math.abs(Math.sin(frame / props.fps * 3.14159 * 1.3)) * 0.08

  const titleSize = Math.max(18, Math.round(props.height * 0.027))
  const subtitleSize = Math.max(12, Math.round(props.height * 0.016))

  return (
    <div
      style={{
        position: 'absolute',
        top: Math.max(20, Math.round(props.height * 0.03)),
        right: Math.max(20, Math.round(props.width * 0.03)),
        minWidth: Math.max(260, Math.round(props.width * 0.22)),
        maxWidth: Math.max(340, Math.round(props.width * 0.28)),
        transform: `translateX(${x}px) scale(${scale})`,
        transformOrigin: 'top right',
        opacity: motion.exitOpacity,
        borderRadius: 999,
        padding: `${Math.max(10, Math.round(props.height * 0.011))}px ${Math.max(16, Math.round(props.width * 0.01))}px`,
        display: 'flex',
        alignItems: 'center',
        gap: Math.max(10, Math.round(props.width * 0.006)),
        backgroundColor: `rgba(0,0,0,${Math.min(0.95, props.panelOpacity + 0.08)})`,
        border: '1px solid rgba(255,255,255,0.24)',
        boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
        fontFamily: 'Inter, Arial, Helvetica, sans-serif',
      }}
    >
      <div
        style={{
          width: Math.max(12, Math.round(props.height * 0.015)),
          height: Math.max(12, Math.round(props.height * 0.015)),
          borderRadius: 999,
          backgroundColor: props.accentColor,
          opacity: pulse,
          boxShadow: `0 0 12px ${props.accentColor}66`,
        }}
      />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: props.textColor,
            fontWeight: 800,
            fontSize: titleSize,
            lineHeight: 1,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {props.title || 'Channel Bug'}
        </div>
        {props.subtitle ? (
          <div
            style={{
              marginTop: 4,
              color: props.textColor,
              opacity: 0.92,
              fontWeight: 500,
              fontSize: subtitleSize,
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>
    </div>
  )
}

const CtaBannerTemplate = ({ frame, props }) => {
  const motion = getTemplateMotion(frame, props, { inSec: 0.34, outSec: 0.34, damping: 170, stiffness: 210 })
  const y = interpolate(motion.enter, [0, 1], [110, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const sidePad = Math.max(18, Math.round(props.width * 0.014))
  const titleSize = Math.max(26, Math.round(props.height * 0.04))
  const subtitleSize = Math.max(14, Math.round(props.height * 0.02))
  const bannerHeight = Math.max(106, Math.round(props.height * 0.14))

  return (
    <div
      style={{
        position: 'absolute',
        left: '7%',
        right: '7%',
        bottom: Math.max(18, Math.round(props.height * 0.05)),
        height: bannerHeight,
        transform: `translateY(${y}px)`,
        opacity: motion.exitOpacity,
        borderRadius: Math.max(10, Math.round(props.height * 0.012)),
        border: '1px solid rgba(255,255,255,0.22)',
        backgroundColor: `rgba(0,0,0,${Math.min(0.96, props.panelOpacity + 0.08)})`,
        boxShadow: '0 14px 30px rgba(0,0,0,0.3)',
        overflow: 'hidden',
        fontFamily: 'Inter, Arial, Helvetica, sans-serif',
        display: 'flex',
        alignItems: 'stretch',
      }}
    >
      <div style={{ width: Math.max(10, Math.round(props.width * 0.008)), backgroundColor: props.accentColor }} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: `${Math.max(12, Math.round(props.height * 0.014))}px ${sidePad}px`,
          gap: Math.max(14, Math.round(props.width * 0.01)),
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: props.textColor,
              fontSize: titleSize,
              fontWeight: 800,
              lineHeight: 1.05,
              textTransform: 'uppercase',
              letterSpacing: '0.03em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {props.title || 'Call To Action'}
          </div>
          {props.subtitle ? (
            <div
              style={{
                marginTop: 6,
                color: props.textColor,
                opacity: 0.9,
                fontSize: subtitleSize,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {props.subtitle}
            </div>
          ) : null}
        </div>
        <div
          style={{
            border: `1px solid ${props.accentColor}`,
            color: props.accentColor,
            borderRadius: 999,
            padding: `${Math.max(8, Math.round(props.height * 0.009))}px ${Math.max(14, Math.round(props.width * 0.008))}px`,
            fontWeight: 700,
            fontSize: subtitleSize,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          {props.subtitle ? 'Learn More' : 'Click Here'}
        </div>
      </div>
    </div>
  )
}

const SplitTitleTemplate = ({ frame, props }) => {
  const motion = getTemplateMotion(frame, props, { inSec: 0.38, outSec: 0.4, damping: 180, stiffness: 215 })
  const leftX = interpolate(motion.enter, [0, 1], [-140, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const rightX = interpolate(motion.enter, [0, 1], [120, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const titleSize = Math.max(54, Math.round(props.height * 0.09))
  const subtitleSize = Math.max(18, Math.round(props.height * 0.026))

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: motion.exitOpacity, fontFamily: 'Inter, Arial, Helvetica, sans-serif' }}>
      <div
        style={{
          position: 'absolute',
          left: '7%',
          top: '38%',
          transform: `translateX(${leftX}px)`,
          color: props.textColor,
          textTransform: 'uppercase',
          fontWeight: 900,
          letterSpacing: '0.06em',
          lineHeight: 0.95,
          fontSize: titleSize,
          textShadow: '0 10px 28px rgba(0,0,0,0.45)',
          maxWidth: '56%',
          whiteSpace: 'pre-wrap',
        }}
      >
        {props.title || 'Split Title'}
      </div>
      <div
        style={{
          position: 'absolute',
          right: '8%',
          bottom: '18%',
          maxWidth: '40%',
          transform: `translateX(${rightX}px)`,
          backgroundColor: `rgba(0,0,0,${Math.min(0.95, props.panelOpacity + 0.08)})`,
          border: '1px solid rgba(255,255,255,0.22)',
          borderLeft: `5px solid ${props.accentColor}`,
          borderRadius: Math.max(8, Math.round(props.height * 0.01)),
          padding: `${Math.max(12, Math.round(props.height * 0.016))}px ${Math.max(14, Math.round(props.width * 0.01))}px`,
          boxShadow: '0 12px 26px rgba(0,0,0,0.3)',
          color: props.textColor,
          fontSize: subtitleSize,
          fontWeight: 500,
          lineHeight: 1.25,
        }}
      >
        {props.subtitle || 'Subtitle details for the split-title treatment.'}
      </div>
    </div>
  )
}

const TitleCardTemplate = ({ frame, props }) => {
  const motion = getTemplateMotion(frame, props, { inSec: 0.32, outSec: 0.34, damping: 170, stiffness: 200 })
  const scale = interpolate(motion.enter, [0, 1], [0.82, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const y = interpolate(motion.enter, [0, 1], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })

  const titleSize = Math.max(52, Math.round(props.height * 0.084))
  const subtitleSize = Math.max(20, Math.round(props.height * 0.028))

  return (
    <div
      style={{
        position: 'absolute',
        left: '14%',
        right: '14%',
        top: '28%',
        bottom: '28%',
        transform: `translateY(${y}px) scale(${scale})`,
        opacity: motion.exitOpacity,
        borderRadius: Math.max(12, Math.round(props.height * 0.016)),
        border: `1px solid ${props.accentColor}77`,
        backgroundColor: `rgba(0,0,0,${Math.min(0.96, props.panelOpacity + 0.1)})`,
        boxShadow: '0 22px 52px rgba(0,0,0,0.4)',
        padding: `${Math.max(18, Math.round(props.height * 0.03))}px ${Math.max(28, Math.round(props.width * 0.02))}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        fontFamily: 'Inter, Arial, Helvetica, sans-serif',
      }}
    >
      <div
        style={{
          color: props.textColor,
          fontSize: titleSize,
          lineHeight: 0.97,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 900,
          textShadow: '0 12px 24px rgba(0,0,0,0.35)',
        }}
      >
        {props.title || 'Title Card'}
      </div>
      <div
        style={{
          marginTop: Math.max(14, Math.round(props.height * 0.014)),
          width: Math.max(160, Math.round(props.width * 0.22)),
          height: Math.max(4, Math.round(props.height * 0.004)),
          borderRadius: 999,
          backgroundColor: props.accentColor,
          boxShadow: `0 0 18px ${props.accentColor}55`,
        }}
      />
      {props.subtitle ? (
        <div
          style={{
            marginTop: Math.max(16, Math.round(props.height * 0.02)),
            color: props.textColor,
            opacity: 0.95,
            fontSize: subtitleSize,
            fontWeight: 500,
            lineHeight: 1.18,
            maxWidth: '80%',
          }}
        >
          {props.subtitle}
        </div>
      ) : null}
    </div>
  )
}

const EndSlateTemplate = ({ frame, props }) => {
  const motion = getTemplateMotion(frame, props, { inSec: 0.36, outSec: 0.4, damping: 180, stiffness: 205 })
  const y = interpolate(motion.enter, [0, 1], [70, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const titleSize = Math.max(40, Math.round(props.height * 0.062))
  const subtitleSize = Math.max(18, Math.round(props.height * 0.024))

  return (
    <div
      style={{
        position: 'absolute',
        left: '12%',
        right: '12%',
        bottom: '12%',
        transform: `translateY(${y}px)`,
        opacity: motion.exitOpacity,
        borderRadius: Math.max(12, Math.round(props.height * 0.015)),
        border: '1px solid rgba(255,255,255,0.24)',
        backgroundColor: `rgba(0,0,0,${Math.min(0.96, props.panelOpacity + 0.12)})`,
        padding: `${Math.max(16, Math.round(props.height * 0.022))}px ${Math.max(18, Math.round(props.width * 0.014))}px`,
        boxShadow: '0 16px 38px rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: Math.max(16, Math.round(props.width * 0.012)),
        fontFamily: 'Inter, Arial, Helvetica, sans-serif',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: props.textColor,
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            lineHeight: 1,
            fontSize: titleSize,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {props.title || 'End Slate'}
        </div>
        {props.subtitle ? (
          <div
            style={{
              marginTop: Math.max(8, Math.round(props.height * 0.01)),
              color: props.textColor,
              opacity: 0.92,
              fontWeight: 500,
              fontSize: subtitleSize,
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>
      <div
        style={{
          border: `1px solid ${props.accentColor}`,
          color: props.textColor,
          backgroundColor: `${props.accentColor}22`,
          borderRadius: Math.max(8, Math.round(props.height * 0.01)),
          padding: `${Math.max(10, Math.round(props.height * 0.012))}px ${Math.max(16, Math.round(props.width * 0.01))}px`,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          fontWeight: 700,
          fontSize: subtitleSize,
          flexShrink: 0,
        }}
      >
        Stay Connected
      </div>
    </div>
  )
}

const CaptionStripTemplate = ({ frame, props }) => {
  const motion = getTemplateMotion(frame, props, { inSec: 0.24, outSec: 0.3, damping: 220, stiffness: 260 })
  const y = interpolate(motion.enter, [0, 1], [34, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const titleSize = Math.max(26, Math.round(props.height * 0.038))
  const subtitleSize = Math.max(14, Math.round(props.height * 0.019))

  return (
    <div
      style={{
        position: 'absolute',
        left: '10%',
        right: '10%',
        bottom: Math.max(18, Math.round(props.height * 0.05)),
        transform: `translateY(${y}px)`,
        opacity: motion.exitOpacity,
        borderRadius: Math.max(10, Math.round(props.height * 0.012)),
        backgroundColor: `rgba(0,0,0,${Math.min(0.97, props.panelOpacity + 0.14)})`,
        border: '1px solid rgba(255,255,255,0.18)',
        boxShadow: '0 10px 22px rgba(0,0,0,0.28)',
        padding: `${Math.max(12, Math.round(props.height * 0.016))}px ${Math.max(16, Math.round(props.width * 0.012))}px`,
        fontFamily: 'Inter, Arial, Helvetica, sans-serif',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          color: props.textColor,
          fontSize: titleSize,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '0.01em',
        }}
      >
        {props.title || 'Caption text appears here'}
      </div>
      {props.subtitle ? (
        <div
          style={{
            marginTop: Math.max(6, Math.round(props.height * 0.007)),
            color: props.accentColor,
            fontSize: subtitleSize,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}
        >
          {props.subtitle}
        </div>
      ) : null}
    </div>
  )
}

const renderTemplate = ({ frame, props }) => {
  switch (props.template) {
    case 'lower-third':
      return <LowerThirdTemplate frame={frame} props={props} />
    case 'cinematic-lower-third':
      return <CinematicLowerThirdTemplate frame={frame} props={props} />
    case 'corner-bug':
      return <CornerBugTemplate frame={frame} props={props} />
    case 'cta-banner':
      return <CtaBannerTemplate frame={frame} props={props} />
    case 'split-title':
      return <SplitTitleTemplate frame={frame} props={props} />
    case 'title-card':
      return <TitleCardTemplate frame={frame} props={props} />
    case 'end-slate':
      return <EndSlateTemplate frame={frame} props={props} />
    case 'caption-strip':
      return <CaptionStripTemplate frame={frame} props={props} />
    default:
      return <LowerThirdTemplate frame={frame} props={props} />
  }
}

const TransparentMotionTemplate = (rawProps) => {
  const frame = useCurrentFrame()
  const video = useVideoConfig()
  const props = normalizeProps({
    ...rawProps,
    width: video.width,
    height: video.height,
    fps: video.fps,
    durationInFrames: video.durationInFrames,
  })

  return (
    <AbsoluteFill style={{ backgroundColor: 'transparent' }}>
      {renderTemplate({ frame, props })}
    </AbsoluteFill>
  )
}

const RemotionRoot = () => (
  <Composition
    id="ComfyTransparentLowerThird"
    component={TransparentMotionTemplate}
    width={DEFAULT_PROPS.width}
    height={DEFAULT_PROPS.height}
    fps={DEFAULT_PROPS.fps}
    durationInFrames={DEFAULT_PROPS.durationInFrames}
    defaultProps={DEFAULT_PROPS}
    calculateMetadata={({ props }) => {
      const normalized = normalizeProps(props)
      return {
        width: normalized.width,
        height: normalized.height,
        fps: normalized.fps,
        durationInFrames: normalized.durationInFrames,
      }
    }}
  />
)

registerRoot(RemotionRoot)
