import { DAYS_OF_WEEK, type WeeklySchedule } from '../facility-settings/weekly-schedule.ts'
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

export type FaqSource = NapSource & {
  officeHours: WeeklySchedule | null
  gateHours: WeeklySchedule | null
  amenities: string[]
}

function summariseSchedule(schedule: WeeklySchedule | null): string | null {
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
  return uniform && open.length === 7
    ? `every day, ${first.open}–${first.close}`
    : uniform
      ? `${open.length} days a week, ${first.open}–${first.close}`
      : null
}

/// Five or more true answers, in the order a renter asks them.
export function defaultFacilityFaqs(facility: FaqSource): FaqEntry[] {
  const entries: FaqEntry[] = []
  const gate = summariseSchedule(facility.gateHours)
  const office = summariseSchedule(facility.officeHours)
  const phone = formatPhone(facility.phone)

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
      answer: `This location has ${listSentence(facility.amenities)}. The full feature list is on this page.`,
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

function listSentence(items: readonly string[]): string {
  const list = items.map((item) => item.toLowerCase())
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
}
