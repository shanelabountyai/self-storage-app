import { DAYS_OF_WEEK, type WeeklySchedule } from '../facility-settings/weekly-schedule.ts'
import { DEFAULT_MARKETING_LOCALE, type MarketingLocale } from './locale.ts'
import { formatPhone, type NapSource } from './nap.ts'
import type { FaqEntry } from './structured-data.ts'

// PRD 04 US-1 AC2 (B-066): a facility page carries "at least 5
// facility-specific FAQs".
//
// Generated from the facility record, for the same reason the JSON-LD is
// (FR-SEO-4): an answer typed once per site drifts from the hours, the address
// and the amenities it describes, and a page whose FAQ contradicts its own
// hours table is worse than a page with no FAQ.
//
// B-067 makes these editable per facility (US-2 AC1). These are the floor, not
// the ceiling — a marketer's own answer replaces the generated one, and any
// facility with none still ships five true ones.
//
// B-262: generated per language. An `FAQPage` on `/es/storage/...` carrying
// English questions describes a page that does not exist, and it is the rich
// result a Spanish searcher would have clicked — so this is not only a reading
// problem, it is a structured-data one.
//
// What is NOT translated, on purpose: the amenity strings and the facility
// name. Both are operator-typed (D-122's "somebody's own words" rule), so the
// amenity sentence interpolates them exactly as they were entered in either
// language. A machine-translated amenity list would be this product inventing
// claims about a facility on the operator's behalf.

export type FaqSource = NapSource & {
  officeHours: WeeklySchedule | null
  gateHours: WeeklySchedule | null
  amenities: string[]
}

function summariseSchedule(
  schedule: WeeklySchedule | null,
  locale: MarketingLocale,
): string | null {
  if (!schedule) return null
  const open = DAYS_OF_WEEK.filter((day) => !schedule[day].closed)
  if (open.length === 0) return null

  const first = schedule[open[0]]
  if (first.closed) return null
  const uniform = open.every((day) => {
    const entry = schedule[day]
    return !entry.closed && entry.open === first.open && entry.close === first.close
  })

  // The uniform case is the common one and reads far better as a sentence than
  // seven identical lines. Anything else defers to the hours table on the page
  // rather than inventing prose for an irregular week.
  if (locale === 'es') {
    return uniform && open.length === 7
      ? `todos los días, de ${first.open} a ${first.close}`
      : uniform
        ? `${open.length} días a la semana, de ${first.open} a ${first.close}`
        : null
  }

  return uniform && open.length === 7
    ? `every day, ${first.open}–${first.close}`
    : uniform
      ? `${open.length} days a week, ${first.open}–${first.close}`
      : null
}

/// Five or more true answers, in the order a renter asks them.
export function defaultFacilityFaqs(
  facility: FaqSource,
  locale: MarketingLocale = DEFAULT_MARKETING_LOCALE,
): FaqEntry[] {
  const entries: FaqEntry[] = []
  const gate = summariseSchedule(facility.gateHours, locale)
  const office = summariseSchedule(facility.officeHours, locale)
  const phone = formatPhone(facility.phone)

  if (locale === 'es') {
    entries.push({
      question: `¿A qué hora puedo llegar a mi unidad en ${facility.name}?`,
      answer: gate
        ? `La puerta está abierta ${gate}. El horario de oficina es aparte — vea los horarios en esta página, y tome en cuenta que puede llegar a su unidad dentro del horario de la puerta aunque la oficina esté cerrada.`
        : `El horario de la puerta viene en esta página. Es distinto del horario de oficina: usted puede llegar a su unidad dentro del horario de la puerta aunque no haya nadie en el mostrador.${phone ? ` Llame al ${phone} si quiere confirmar.` : ''}`,
    })

    entries.push({
      question: '¿Tengo que firmar un contrato de largo plazo?',
      answer:
        'No. Aquí la renta es mes con mes. Usted se puede salir avisando con el tiempo que dice su contrato, y nunca queda amarrado por un año.',
    })

    entries.push({
      question: '¿Qué necesito llevar para rentar una unidad?',
      answer:
        'Una identificación oficial con foto y una forma de pago. Puede hacer toda la renta en línea, incluida la firma del contrato, y al final recibe su código de la puerta.',
    })

    entries.push({
      question: '¿Qué tamaño de unidad necesito?',
      answer:
        'Una de 5x5 guarda lo de un clóset; una de 10x10 es como un departamento de una recámara; en una de 10x20 cabe una casa chica o un carro. La guía de tamaños de este sitio las compara una junto a otra.',
    })

    entries.push({
      question: '¿Mis cosas están aseguradas?',
      answer:
        'Puede ser que su propio seguro de inquilino o de casa ya cubra lo que guarda — traiga el comprobante y lo anotamos. Si no lo cubre, hay un plan de protección disponible cuando renta.',
    })

    if (facility.amenities.length > 0) {
      entries.push({
        question: `¿Qué ofrece ${facility.name}?`,
        answer: `Esta sucursal tiene ${listSentence(facility.amenities, locale)}. La lista completa está en esta página.`,
      })
    }

    if (office) {
      entries.push({
        question: '¿A qué hora hay alguien en la oficina?',
        answer: `Hay personal en la oficina ${office}.${phone ? ` Puede comunicarse al ${phone}.` : ''}`,
      })
    }

    return entries
  }

  entries.push({
    question: `When can I get to my unit at ${facility.name}?`,
    answer: gate
      ? `Gate access is open ${gate}. Office hours are separate — see the hours on this page, and note that a unit is reachable during gate hours even when the office is closed.`
      : `Gate access hours are shown on this page. They are separate from office hours: your unit is reachable during gate hours even when nobody is at the desk.${phone ? ` Call ${phone} if you need to check.` : ''}`,
  })

  entries.push({
    question: 'Do I have to sign a long-term contract?',
    answer:
      'No. Storage here is month to month. You can move out with the notice period shown in your lease, and you are never locked into a year.',
  })

  entries.push({
    question: 'What do I need to bring to rent a unit?',
    answer:
      'A government photo ID and a payment method. You can complete the whole rental online, including signing the lease, and get your gate code at the end.',
  })

  entries.push({
    question: 'What size unit do I need?',
    answer:
      'A 5x5 holds a closet’s worth; a 10x10 is about a one-bedroom apartment; a 10x20 fits a small house or a car. The size guide on this site compares them side by side.',
  })

  entries.push({
    question: 'Is my unit insured?',
    answer:
      'Your own renter’s or homeowner’s policy may already cover stored belongings — bring proof and we will note it. If it does not, a protection plan is available when you rent.',
  })

  if (facility.amenities.length > 0) {
    entries.push({
      question: `What does ${facility.name} offer?`,
      answer: `This location has ${listSentence(facility.amenities, locale)}. The full feature list is on this page.`,
    })
  }

  if (office) {
    entries.push({
      question: 'When is somebody in the office?',
      answer: `The office is staffed ${office}.${phone ? ` You can reach us on ${phone}.` : ''}`,
    })
  }

  return entries
}

/// The amenity list as a sentence.
///
/// The ITEMS are operator-typed and pass through untranslated (see the note at
/// the top); only the conjunction is in the reader's language. Lower-cased in
/// both, because the sentence puts them mid-clause — the same reason the
/// original did.
function listSentence(items: readonly string[], locale: MarketingLocale): string {
  const list = items.map((item) => item.toLowerCase())
  const and = locale === 'es' ? 'y' : 'and'
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} ${and} ${list[1]}`
  // No Oxford comma in Spanish: `a, b y c`. Writing `a, b, y c` is an
  // anglicism, and this string is read by people who would notice.
  const head = list.slice(0, -1).join(', ')
  const tail = list[list.length - 1]
  return locale === 'es' ? `${head} ${and} ${tail}` : `${head}, ${and} ${tail}`
}
