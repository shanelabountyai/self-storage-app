import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CounterCharge } from '../apps/web/lib/admin/pos'

// B-344. The counter card screens for a business account's payer: "payer", not
// "tenant"; the done page links the account; the card on file says whose it
// is; and a declined card links back to the same subject and amount (SC 2.4.4).

let charge: CounterCharge
let status: 'succeeded' | 'processing' | 'failed'

vi.mock('@/lib/rbac/session', () => ({ requireStaffActor: async () => ({ kind: 'staff' }) }))
vi.mock('@/app/admin/pos/card/actions', () => ({ chargeCardOnFileAction: async () => ({}) }))
vi.mock('@/components/portal/portal-payment', () => ({ PortalPayment: () => null }))
vi.mock('@/lib/portal/payment-methods', () => ({
  savedMethods: async () => [{ id: 'pm1', brand: 'visa', last4: '4242', expMonth: 3, expYear: 2029, isDefault: true }],
}))
vi.mock('@/lib/portal/payment', () => ({
  paymentReceipt: async () => ({ status, amountCents: 12_500, failureReason: 'Your card was declined.' }),
}))
vi.mock('@/lib/admin/pos', () => ({
  chargeableAccount: async () => charge,
  chargeableLease: async () => charge,
  counterReceipt: async () => null,
  startCounterCardPayment: async () => ({ available: false }),
}))

const { default: CardPage } = await import('../apps/web/app/admin/pos/card/page')
const { default: DonePage } = await import('../apps/web/app/admin/pos/card/done/page')

const ACCOUNT: CounterCharge = {
  leaseId: 'lease1',
  tenantId: 'payer1',
  facilityId: 'f1',
  tenantName: 'Pat Payer',
  unitNumber: 'C-3, C-7',
  balanceCents: 12_500,
  accountId: 'acct1',
  accountName: 'Acme Moving',
  subject: 'Acme Moving (units C-3, C-7)',
}

const card = async (params: Record<string, string>) =>
  renderToStaticMarkup(await CardPage({ searchParams: Promise.resolve(params) }))
const done = async (params: Record<string, string>) =>
  renderToStaticMarkup(await DonePage({ searchParams: Promise.resolve({ payment: 'p1', ...params }) }))

beforeEach(() => {
  charge = ACCOUNT
  status = 'succeeded'
})

describe('the counter card screens for an account', () => {
  it('say "payer", and name whose card is on file', async () => {
    const html = await card({ account: 'acct1' })
    expect(html).not.toMatch(/tenant/i)
    expect(html).toContain('Card the payer is holding')
    expect(html).toContain('The payer has asked us to charge $125.00 to this card')
    expect(html).toMatch(/Pat Payer&#x27;s <span[^>]*>visa<\/span> ending 4242/)
    expect(html).toContain('not to Acme Moving')
  })

  it('the done page labels the payer and links the account, not the tenant profile', async () => {
    status = 'processing'
    const html = await done({ account: 'acct1' })
    expect(html).not.toContain('>Tenant<')
    expect(html).toContain('>Payer<')
    expect(html).toContain('href="/admin/billing/accounts/acct1"')
    expect(html).toContain('Acme Moving account')
    expect(html).not.toContain('/admin/tenants/')
  })

  it('a declined card links back to the same account and amount', async () => {
    status = 'failed'
    const html = await done({ account: 'acct1' })
    expect(html).toContain('href="/admin/pos/card?account=acct1&amp;amount=125.00"')
    expect(html).toContain('Try another card for $125.00')
  })

  it('a declined card on a lease links back to the lease, and a lease still says tenant', async () => {
    charge = { ...ACCOUNT, accountId: null, accountName: null, tenantName: 'Ada Renter', subject: 'unit C-7' }
    status = 'failed'
    const html = await done({ lease: 'lease1' })
    expect(html).toContain('href="/admin/pos/card?lease=lease1&amp;amount=125.00"')
    expect(html).toContain('href="/admin/tenants/payer1"')
    expect(await card({ lease: 'lease1' })).toContain('Card the tenant is holding')
  })
})
