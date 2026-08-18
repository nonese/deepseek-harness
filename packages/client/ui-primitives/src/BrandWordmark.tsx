/** Text-only Harness wordmark used by the server product surface. */

import type { IconProps } from './icons/props.ts'

/**
 * Render the text-only Harness brand.
 * @param props.size - text size in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the decorative product wordmark.
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        fontFamily: 'var(--ds-font-family-code)',
        fontSize: size,
        fontWeight: 650,
        letterSpacing: '0.16em',
        lineHeight: 1,
      }}
    >
      HARNESS
    </span>
  )
}
