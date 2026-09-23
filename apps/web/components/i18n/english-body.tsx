import type { ReactNode } from 'react'
import { getLocale } from '@/lib/i18n/server'

// B-379. D-123 keeps the SEO prose English. Under `<html lang="es">` that is a
// 3.1.2 failure unless the English says so, and translating it is not the fix:
// D-129's pattern is to identify the language of the part. English stays
// unmarked, so an English page carries no redundant attribute.
export async function EnglishBody({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const lang = (await getLocale()) === 'es' ? 'en' : undefined
  return (
    <div lang={lang} className={className}>
      {children}
    </div>
  )
}
