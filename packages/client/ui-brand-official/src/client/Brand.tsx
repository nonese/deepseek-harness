import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { BRAND_MONOGRAM, BRAND_NAME } from './locales.ts'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the Harness monogram without upstream product artwork.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <span
    className={className}
    style={{
      alignItems: 'center',
      background: 'currentColor',
      borderRadius: Math.max(6, Math.round(size * 0.28)),
      color: 'var(--dsw-alias-bg-base, white)',
      display: 'inline-flex',
      fontSize: Math.max(11, Math.round(size * 0.52)),
      fontWeight: 750,
      height: size,
      justifyContent: 'center',
      lineHeight: 1,
      width: size,
    }}
  >{BRAND_MONOGRAM}</span>
}

/**
 * Render the Harness name independently from its slotted monogram.
 * @returns the Harness name.
 */
export function OfficialBrandName() {
  return <span style={{ fontSize: 17, fontWeight: 720, letterSpacing: '-0.02em' }}>{BRAND_NAME}</span>
}
