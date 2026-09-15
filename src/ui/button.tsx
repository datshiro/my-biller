import type { ComponentProps } from 'react'
import { buttonClassName, type ButtonSize, type ButtonVariant } from './button-class'

type Props = ComponentProps<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: Props) {
  return <button type="button" className={buttonClassName(variant, size, className)} {...rest} />
}
