import { Button } from '@/components/ui/button'
import { FEATURE_FILTERS, SIZE_BANDS, parseFilters } from '@/lib/inventory/unit-filters'
import { translate, type Dictionary } from '@/lib/i18n'

/// B-388. `size` and `features` already ride the URL (B-082); this is the
/// control that sets and clears them. A plain GET form, so it works without JS
/// and every state stays a shareable URL. A disclosure at every width,
/// open while a filter is set.
///
/// ponytail: apply-on-submit, not live. Add a client component if renters
/// find the extra click costly.
export function SearchFilterRail({
  dict,
  query,
}: {
  dict: Dictionary
  query: { q?: string; lat?: string; lng?: string; size?: string; features?: string | string[] }
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(dict, key)
  const { size, features } = parseFilters(query)
  const clearParams = new URLSearchParams()
  for (const key of ['q', 'lat', 'lng'] as const) if (query[key]) clearParams.set(key, query[key])
  const clearHref = `/storage/search${clearParams.size ? `?${clearParams}` : ''}`
  const active = Boolean(size) || features.length > 0

  return (
    <details open={active} className="mt-6 max-w-3xl rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{t('search.filtersHeading')}</summary>
      <form action="/storage/search" method="get" className="mt-4 flex flex-col gap-4">
        {(['q', 'lat', 'lng'] as const).map(
          (key) => query[key] && <input key={key} type="hidden" name={key} value={query[key]} />,
        )}
        <fieldset>
          <legend className="text-sm font-medium">{t('search.filtersSize')}</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="size" value="" defaultChecked={!size} />
              {t('search.filtersAnySize')}
            </label>
            {Object.entries(SIZE_BANDS).map(([band, { labelKey }]) => (
              <label key={band} className="flex items-center gap-2">
                <input type="radio" name="size" value={band} defaultChecked={size === band} />
                {t(labelKey)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-sm font-medium">{t('search.filtersFeatures')}</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {Object.entries(FEATURE_FILTERS).map(([key, { labelKey }]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="features"
                  value={key}
                  defaultChecked={features.includes(key as keyof typeof FEATURE_FILTERS)}
                />
                {t(labelKey)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-4">
          <Button type="submit">{t('search.filtersApply')}</Button>
          <a href={clearHref} className="text-sm underline underline-offset-4">
            {t('search.filtersClear')}
          </a>
        </div>
      </form>
    </details>
  )
}
