import { prisma, type Prisma } from '@storage/db'
import { emitEvent } from '@storage/core/events'
import { createTask } from '@/lib/admin/tasks'
import type { Actor } from '@/lib/rbac/actor'

// PRD 01 US-705 "Ask about one charge" (B-421). A tenant who thinks a charge is
// wrong gets one short text field on the line, not a phone queue.
//
// The shape is B-135's (D-83): the tenant's words live in the domain event, the
// task points at the line and carries the event id, and `Task.proof` holds only
// what staff did about it. One open request per line, no thread, no replies
// (D-78): the answer is one note or a waiver, shown on the line and sent once.

export const CHARGE_QUESTION_TASK = 'charge_question'
export const CHARGE_QUESTION_MAX = 500

export type ChargeQuestionState =
  | { status: 'open'; askedAt: Date }
  | { status: 'kept'; askedAt: Date; note: string }
  | { status: 'waived'; askedAt: Date }

export type ChargeQuestion = ChargeQuestionState & {
  lineItemId: string
  description: string
  amountCents: number
}

export type AskResult =
  | { ok: true; taskId: string }
  | { ok: false; reason: 'not_found' | 'empty' | 'too_long' | 'already_open' }

/// The tenant asks about one invoice line on one of their own leases.
export async function askAboutCharge(
  actor: Extract<Actor, { kind: 'tenant' }>,
  lineItemId: string,
  question: string,
): Promise<AskResult> {
  const words = question.trim()
  if (words === '') return { ok: false, reason: 'empty' }
  if (words.length > CHARGE_QUESTION_MAX) return { ok: false, reason: 'too_long' }

  const line = await prisma.invoiceLineItem.findUnique({
    where: { id: lineItemId },
    select: {
      id: true,
      description: true,
      amountCents: true,
      invoice: { select: { id: true, leaseId: true, facilityId: true, lease: { select: { tenantId: true } } } },
    },
  })
  // Not yours reads as not found: the id is a cuid a tenant never sees.
  if (!line || line.invoice.lease.tenantId !== actor.tenantId) return { ok: false, reason: 'not_found' }

  const open = await prisma.task.findFirst({
    where: { type: CHARGE_QUESTION_TASK, entityId: line.id, status: 'open' },
    select: { id: true },
  })
  if (open) return { ok: false, reason: 'already_open' }

  const event = await emitEvent({
    name: 'charge.question_asked',
    entityType: 'InvoiceLineItem',
    entityId: line.id,
    facilityId: line.invoice.facilityId,
    payload: {
      tenantId: actor.tenantId,
      leaseId: line.invoice.leaseId,
      invoiceId: line.invoice.id,
      description: line.description,
      amountCents: line.amountCents,
      question: words,
    },
  })

  const task = await createTask({
    facilityId: line.invoice.facilityId,
    type: CHARGE_QUESTION_TASK,
    entityType: 'InvoiceLineItem',
    entityId: line.id,
    sourceEventId: event.id,
    priority: 'high',
    // Why this task exists, on the card: the charge and the tenant's words.
    detail: `${line.description} (${(line.amountCents / 100).toFixed(2)}): "${words}"`,
  })
  // ponytail: `createTask` dedupes on (type, line, business day), so a second
  // ask on the day the first was answered returns the answered task. The open
  // check above is what the row asked for; same-day re-asks wait until tomorrow.
  return { ok: true, taskId: task.id }
}

/// Every question asked on this lease's lines, newest first, with where it got to.
export async function chargeQuestionsFor(leaseId: string): Promise<ChargeQuestion[]> {
  const tasks = await prisma.task.findMany({
    where: { type: CHARGE_QUESTION_TASK, entityType: 'InvoiceLineItem' },
    // ponytail: filtered by lease in JS through the line; a `Task` has no lease
    // column. Add a join if a lease ever has hundreds of questions.
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, status: true, proof: true, createdAt: true },
  })
  if (tasks.length === 0) return []
  const lines = await prisma.invoiceLineItem.findMany({
    where: { id: { in: tasks.map((task) => task.entityId) }, invoice: { leaseId } },
    select: { id: true, description: true, amountCents: true },
  })
  const byId = new Map(lines.map((line) => [line.id, line]))

  const out: ChargeQuestion[] = []
  for (const task of tasks) {
    const line = byId.get(task.entityId)
    if (!line) continue
    const proof = (task.proof ?? {}) as { note?: unknown; outcome?: unknown }
    const base = { lineItemId: line.id, description: line.description, amountCents: line.amountCents, askedAt: task.createdAt }
    if (task.status === 'open') out.push({ ...base, status: 'open' })
    else if (proof.outcome === 'waived') out.push({ ...base, status: 'waived' })
    else out.push({ ...base, status: 'kept', note: typeof proof.note === 'string' ? proof.note : '' })
  }
  return out
}

/// The one-way answer. Called from the two places a question is settled: a
/// staffer completing the task with a note (kept), or `waiveFeeInvoice`
/// voiding the fee (waived). Emits the event the comms rule sends from.
export async function answerChargeQuestion(
  tx: Prisma.TransactionClient,
  task: { id: string; entityId: string },
  outcome: { kind: 'kept'; note: string } | { kind: 'waived' },
): Promise<void> {
  const line = await tx.invoiceLineItem.findUnique({
    where: { id: task.entityId },
    select: { description: true, amountCents: true, invoice: { select: { leaseId: true, facilityId: true } } },
  })
  if (!line) return
  await emitEvent(
    {
      name: 'charge_question.answered',
      entityType: 'Lease',
      entityId: line.invoice.leaseId,
      facilityId: line.invoice.facilityId,
      payload: {
        taskId: task.id,
        lineItemId: task.entityId,
        description: line.description,
        amountCents: line.amountCents,
        outcome: outcome.kind,
        note: outcome.kind === 'kept' ? outcome.note : null,
      },
    },
    tx,
  )
}
