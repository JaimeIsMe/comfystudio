export function isBetweenClipTransition(transition) {
  return Boolean(
    transition
    && transition.kind !== 'edge'
    && typeof transition.clipAId === 'string'
    && transition.clipAId
    && typeof transition.clipBId === 'string'
    && transition.clipBId
  )
}
