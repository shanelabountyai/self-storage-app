import { describe, expect, it } from 'vitest'
import {
  availableFieldsFor,
  BROADCAST_EVENT,
  checkPublishable,
  EVENT_MERGE_FIELDS,
  isBroadcastTemplateKey,
  fieldsUsedIn,
  sampleContextFor,
  STANDARD_MERGE_FIELDS,
} from '../packages/core/comms'
import { COMMS_RULES, COMMS_TEMPLATES } from '../packages/db/comms-catalog'

// PRD 05 CN-16 (B-053). The field schema, the picker, and the publish gate.

describe('the catalog', () => {
  it('describes every field for a person, not a developer', () => {
    const all = [...STANDARD_MERGE_FIELDS, ...Object.values(EVENT_MERGE_FIELDS).flat()]
    for (const spec of all) {
      expect(spec.description.length, spec.field).toBeGreaterThan(5)
      expect(spec.sample.length, `${spec.field} needs a realistic sample`).toBeGreaterThan(0)
    }
  })

  it('offers the standard fields on every event', () => {
    for (const event of Object.keys(EVENT_MERGE_FIELDS)) {
      const fields = availableFieldsFor(event).map((spec) => spec.field)
      expect(fields, event).toContain('tenant.first_name')
      expect(fields, event).toContain('facility.name')
    }
  })

  it('gives a sample value for every field it offers', () => {
    // The preview renders through the real engine, which throws on an empty
    // value — a field offered by the picker with no sample would make the
    // preview fail on a template that is actually fine.
    for (const event of Object.keys(EVENT_MERGE_FIELDS)) {
      const context = sampleContextFor(event)
      for (const spec of availableFieldsFor(event)) {
        expect(context[spec.field], `${event}/${spec.field}`).toBeTruthy()
      }
    }
  })
})

describe('every seeded template is publishable by its own gate', () => {
  // The guard against this catalog drifting from what the service actually
  // supplies: if a shipped template uses a field the schema does not list,
  // either the template is broken or the catalog is incomplete, and both are
  // worth failing the build over.
  it.each(COMMS_TEMPLATES.map((template) => [template.key, template] as const))(
    '%s',
    (_key, template) => {
      // A template with no rule can never be sent — EXCEPT a broadcast, which
      // has no rule by design because nothing emits one, a person sends it
      // (CN-21, B-090 part 4). The assertion stays, narrowed rather than
      // dropped: a new eventless template that is not a broadcast is still the
      // mistake this was written to catch.
      const rule = COMMS_RULES.find((r) => r.templateKey === template.key)
      if (!isBroadcastTemplateKey(template.key)) {
        expect(rule, `${template.key} has no rule, so it can never be sent`).toBeTruthy()
      }

      const check = checkPublishable({
        event: rule?.event ?? BROADCAST_EVENT,
        subject: template.subject,
        bodyText: template.bodyText,
        requiredMergeFields: template.requiredMergeFields,
      })
      expect(check.unknown, `${template.key} uses fields its event cannot supply`).toEqual([])
    },
  )
})

describe('fieldsUsedIn', () => {
  it('finds every placeholder across subject and body', () => {
    expect(fieldsUsedIn('Hi {{tenant.first_name}}', 'Unit {{unit.number}} at {{facility.name}}')).toEqual([
      'facility.name',
      'tenant.first_name',
      'unit.number',
    ])
  })

  it('tolerates whitespace inside the braces', () => {
    expect(fieldsUsedIn('{{ tenant.first_name }}')).toEqual(['tenant.first_name'])
  })

  it('returns nothing for a template with no fields', () => {
    expect(fieldsUsedIn('Plain text', null, undefined)).toEqual([])
  })
})

describe('checkPublishable — CN-16’s gate', () => {
  const base = {
    event: 'invoice.due_soon',
    subject: 'Rent is due',
    requiredMergeFields: [] as string[],
  }

  it('passes a template using only available fields', () => {
    expect(
      checkPublishable({ ...base, bodyText: 'Hi {{tenant.first_name}}, {{invoice.amount}} is due.' }),
    ).toMatchObject({ ok: true, unknown: [] })
  })

  it('blocks a field the event cannot supply', () => {
    // The failure this prevents: it renders fine in a developer's head and
    // fails at send time, in a job, with the tenant simply not hearing from us.
    const check = checkPublishable({ ...base, bodyText: 'Hi {{tenant.middle_name}}' })
    expect(check.ok).toBe(false)
    expect(check.unknown).toEqual(['tenant.middle_name'])
  })

  it('blocks a field borrowed from a different event', () => {
    // `card.expires` is real — just not for this message.
    const check = checkPublishable({ ...base, bodyText: 'Card expires {{card.expires}}' })
    expect(check.ok).toBe(false)
    expect(check.unknown).toEqual(['card.expires'])
  })

  it('blocks a REQUIRED field the event cannot supply, even if unused in the body', () => {
    // Worse than an unknown placeholder: a required field missing from the
    // context fails every send, not only the ones that reference it.
    const check = checkPublishable({
      ...base,
      bodyText: 'Hi {{tenant.first_name}}',
      requiredMergeFields: ['nonsense.field'],
    })
    expect(check.ok).toBe(false)
    expect(check.unknown).toContain('nonsense.field')
  })

  it('reports a known-but-undeclared field without blocking', () => {
    // A line that is fine to render empty is a legitimate choice, and the send
    // guard already refuses to mail a surviving placeholder.
    const check = checkPublishable({ ...base, bodyText: 'Due {{invoice.due_date}}' })
    expect(check.ok).toBe(true)
    expect(check.undeclared).toContain('invoice.due_date')
  })

  it('treats an unknown event as supplying only the standard fields', () => {
    expect(checkPublishable({ ...base, event: 'nope.nothing', bodyText: 'Hi {{tenant.first_name}}' }).ok).toBe(true)
    expect(checkPublishable({ ...base, event: 'nope.nothing', bodyText: '{{invoice.amount}}' }).ok).toBe(false)
  })
})
