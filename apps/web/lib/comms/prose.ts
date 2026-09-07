import type { ReferralRefusal } from '@storage/core/referrals'
import type { Locale } from '@/lib/i18n'

// B-261 (D-122). Every sentence the SEND PATH builds rather than the template,
// in both languages.
//
// ── Why this file exists at all ─────────────────────────────────────────────
//
// Translating `COMMS_TEMPLATES` is only half of a Spanish email, and on the
// message that matters most it is the smaller half. The dunning email's body
// is four merge fields and a link: `{{dunning.tone_line}}`,
// `{{dunning.consequence_line}}` and the subject itself are chosen in code
// from the step's position on the ladder (`delinquency.day_reached`), because
// the template language has no conditional. Seed a Spanish `dunning_step` and
// leave those three behind and the tenant gets a Spanish greeting wrapped
// around three English sentences about losing their gate code — which is worse
// than the English original, because it reads as though we tried.
//
// So the rule this file enforces is: a template is translated ONLY when every
// sentence its `requiredMergeFields` resolve to is translated too. There is no
// halfway.
//
// ── The shape, and what it guarantees ───────────────────────────────────────
//
// `Record<Locale, CommsProse>` is the same device `lib/consent/disclosures.ts`
// uses and for the same reason: there is no way to add a language without
// filling in every sentence, and no way to add a sentence without noticing the
// other language exists. `LOCALES` gaining a third entry fails typecheck here
// rather than shipping English inside a third-language email.
//
// Interpolated sentences are FUNCTIONS of their arguments rather than strings
// with `{placeholders}`. Spanish moves the pieces — "day 12 of each month"
// becomes "el día 12 de cada mes", and the plural of `days` is not the plural
// of `días` — so the argument list is what has to be shared, not the word
// order.
//
// ── What is deliberately NOT here ───────────────────────────────────────────
//
// Operator-typed data (D-122): a payment plan's cancellation reason, a promo's
// terms, a facility's name. Those are quoted as the operator wrote them in
// whichever language they wrote them, exactly as the admin surface shows them.
// Translating an operator's own words would put sentences in their mouth.

export type CommsProse = {
  // ── lease.moved_in ────────────────────────────────────────────────────────
  gateCodeIssued: (code: string) => string
  gateCodePending: string
  firstCharge: (today: string, monthly: string, billingDay: number) => string

  // ── referral (PRD 10 §6.3) ────────────────────────────────────────────────
  referralRewardReferee: (amount: string) => string
  referralRewardReferrer: (amount: string) => string
  /// Never "not eligible" — the row that owns this vocabulary forbids it in as
  /// many words, in both languages.
  referralRefusalUnknown: string
  referralRefusals: Record<ReferralRefusal, string>

  // ── lease.moved_out ───────────────────────────────────────────────────────
  settlementRefund: (amount: string) => string
  settlementOutstanding: (amount: string) => string
  settlementSettled: string

  // ── lease.transferred (PRD 02 US-14) ──────────────────────────────────────
  transferChargedToday: (amount: string) => string
  transferCreditedToday: (amount: string) => string
  transferNothingToPay: string

  // ── move-out / transfer requests ──────────────────────────────────────────
  /// Stand-ins for a payload that arrived without the fact. They read as a
  /// sentence rather than a blank, which is what keeps `renderString`'s
  /// unresolved-placeholder guard from refusing the send over a missing date.
  theDateYouRequested: string
  theUnitYouChose: string

  // ── delinquency.day_reached: CN-3's ladder ────────────────────────────────
  //
  // Four rungs each, index-aligned with the English. The Spanish is firm in
  // the same places and no firmer: this reaches people who are behind, not
  // people who are dishonest, and a translation that hardens the tone is a
  // different message, not the same one in another language.
  dunningSubjectFirst: string
  dunningSubjectMiddle: string
  dunningSubjectLast: string
  dunningTone: readonly [string, string, string, string]
  dunningConsequence: readonly [string, string, string, string]

  // ── payment.failed / retry ────────────────────────────────────────────────
  paymentFailedExpiredCard: string
  paymentFailedDeclined: string
  retryLastReminder: string
  retryWillTryAgain: string
  /// The `PaymentMethod` enum, in words. Keys are the enum's own values.
  paymentMethods: Record<'card' | 'ach' | 'cash' | 'check' | 'money_order', string>

  // ── payment_method.expiring ───────────────────────────────────────────────
  cardExpiresSoon: string
  cardUrgencyThisWeek: string
  cardUrgencyRelaxed: string

  // ── protection ────────────────────────────────────────────────────────────
  protectionExpiresSoon: string
  protectionStandardPlan: string

  // ── lead drip ─────────────────────────────────────────────────────────────
  callForPricing: string

  // ── payment plans (CN-24) ─────────────────────────────────────────────────
  planScheduleCaption: string
  planScheduleColumns: readonly [string, string, string]
  planCollectionAutomatic: (subject: 'each' | 'this') => string
  planCollectionManual: (subject: 'each' | 'this') => string
  planGraceAgreed: (graceDays: number) => string
  planGraceDueSoon: (graceDays: number) => string

  // ── appended by the pipeline, never by a template ─────────────────────────
  unsubscribe: string
  /// FR-11's opt-out line. STOP and HELP stay English in both languages: they
  /// are not words, they are the literal strings `classifyInboundSms` matches
  /// (`packages/core/comms/sms-keywords.ts`), and a carrier's own keyword
  /// handling is English by construction. Translating them would print an
  /// instruction that does not work — the same call `lib/consent/disclosures.ts`
  /// made for the SMS consent disclosure, and the Spanish says so out loud for
  /// the same reason.
  smsOptOut: string
}

const en: CommsProse = {
  gateCodeIssued: (code) => `Your gate code is ${code}.`,
  gateCodePending: 'Your gate code will be texted to you within 15 minutes.',
  firstCharge: (today, monthly, billingDay) =>
    `You were charged ${today} today. After that, rent is ${monthly}/mo, billed on day ${billingDay} of each month.`,

  referralRewardReferee: (amount) => `${amount} comes off your first invoice.`,
  referralRewardReferrer: (amount) => `${amount} comes off your next invoice.`,
  referralRefusalUnknown: 'We could not confirm this referral. Call us and we will look at it with you.',
  referralRefusals: {
    self_referral:
      'This referral was to your own account — the same email, phone number or card. A referral has to bring in someone new.',
    existing_tenant:
      'Your friend has rented with us before. The reward is for new customers only, so a returning tenant does not qualify.',
    already_referred:
      'Your friend was already referred by someone else. A person can be referred once, and the first referral is the one that counts.',
    annual_cap_reached:
      'You have reached the most referrals we can reward in a 12-month period. This one does not earn a credit, and the count resets as your earlier referrals pass their anniversary.',
    invite_expired:
      'That invite had expired by the time your friend moved in. Invites last a limited time — share a fresh one and it will count.',
    invite_already_used:
      'That invite had already been used by another friend. Each invite works once; your other invites are unaffected.',
    different_facility:
      'Your friend rented at a different location. The reward applies when you both rent at the same place.',
    program_disabled: 'The referral program is not running at this location right now.',
  },

  settlementRefund: (amount) => `We owe you ${amount} back — we'll be in touch about getting it to you.`,
  settlementOutstanding: (amount) => `There is ${amount} still outstanding on the account.`,
  settlementSettled: 'Your account is settled in full — nothing further is owed.',

  transferChargedToday: (amount) =>
    `You were charged ${amount} today for the rest of this billing period.`,
  transferCreditedToday: (amount) => `${amount} has been credited to your account.`,
  transferNothingToPay: 'There was nothing extra to pay today.',

  theDateYouRequested: 'the date you requested',
  theUnitYouChose: 'the unit you chose',

  dunningSubjectFirst: 'We missed your payment',
  dunningSubjectMiddle: 'Your balance is still outstanding',
  dunningSubjectLast: 'Your account is seriously overdue',
  dunningTone: [
    'It looks like this month’s payment did not go through — it happens, and it is quick to put right.',
    'Your balance is still outstanding, and a late fee may now have been added.',
    'This account is far enough behind that your gate access is at risk.',
    'This account is seriously overdue and we need to hear from you.',
  ],
  dunningConsequence: [
    'Paying today avoids any late fee.',
    'Please settle it when you can, or call us and we will work something out.',
    'If it stays unpaid, your gate code will stop working until the balance is cleared. Your belongings stay where they are.',
    'If we do not hear from you, we would have to begin the formal collection steps our lease and state law allow. We would much rather arrange something with you.',
  ],

  paymentFailedExpiredCard: 'The card we have on file has expired, so we could not take the payment.',
  paymentFailedDeclined:
    'Your bank declined the payment. That is usually a temporary block or a limit, not anything wrong with your account here.',
  retryLastReminder:
    'This is the last reminder we will send about this payment. If it stays unpaid, someone from the office will be in touch.',
  retryWillTryAgain:
    'We will try the card again automatically, so if you update it or add funds there is nothing else to do.',
  paymentMethods: {
    card: 'card',
    ach: 'bank transfer',
    cash: 'cash',
    check: 'check',
    money_order: 'money order',
  },

  cardExpiresSoon: 'soon',
  cardUrgencyThisWeek: 'It expires within the week, so this is worth doing today.',
  cardUrgencyRelaxed: 'There is no rush — any time in the next few weeks is fine.',

  protectionExpiresSoon: 'soon',
  protectionStandardPlan: 'our standard cover',

  callForPricing: 'Call for current pricing',

  planScheduleCaption: 'Your payment plan',
  planScheduleColumns: ['Payment', 'Date', 'Amount'],
  planCollectionAutomatic: (subject) =>
    `We will take ${subject === 'each' ? 'each payment' : 'this payment'} from your card on file on the date shown — you do not need to do anything.`,
  planCollectionManual: (subject) =>
    `${subject === 'each' ? 'These payments are' : 'This payment is'} not taken automatically. Pay online, over the phone, or at the office on or before the date shown.`,
  planGraceAgreed: (graceDays) =>
    graceDays > 0
      ? `If a payment is late you have ${graceDays} ${graceDays === 1 ? 'day' : 'days'} to catch it up. If it is still unpaid after that, or new rent goes unpaid, the plan ends, all three start again, and the full amount becomes due.`
      : 'If a payment is missed, or new rent goes unpaid, the plan ends, all three start again, and the full amount becomes due.',
  planGraceDueSoon: (graceDays) =>
    graceDays > 0
      ? `If it is late you have ${graceDays} ${graceDays === 1 ? 'day' : 'days'} to catch it up. After that the plan ends: the full amount you owe becomes due, late fees start again and your gate access can be turned off.`
      : 'If it is missed, the plan ends: the full amount you owe becomes due, late fees start again and your gate access can be turned off.',

  unsubscribe: 'Unsubscribe',
  smsOptOut: 'Reply STOP to opt out, HELP for help.',
}

const es: CommsProse = {
  gateCodeIssued: (code) => `Su código de la puerta es ${code}.`,
  gateCodePending: 'Le enviaremos su código de la puerta por mensaje de texto dentro de 15 minutos.',
  firstCharge: (today, monthly, billingDay) =>
    `Hoy se le cobró ${today}. Después, la renta es de ${monthly} al mes, con cargo el día ${billingDay} de cada mes.`,

  referralRewardReferee: (amount) => `Se le descontarán ${amount} de su primera factura.`,
  referralRewardReferrer: (amount) => `Se le descontarán ${amount} de su próxima factura.`,
  referralRefusalUnknown:
    'No pudimos confirmar esta recomendación. Llámenos y la revisamos con usted.',
  referralRefusals: {
    self_referral:
      'Esta recomendación fue para su propia cuenta: el mismo correo, teléfono o tarjeta. Una recomendación tiene que traer a alguien nuevo.',
    existing_tenant:
      'Su amistad ya ha rentado con nosotros antes. La recompensa es solo para clientes nuevos, así que un cliente que regresa no califica.',
    already_referred:
      'Su amistad ya había sido recomendada por otra persona. A cada persona se le puede recomendar una sola vez, y cuenta la primera recomendación.',
    annual_cap_reached:
      'Ha llegado al máximo de recomendaciones que podemos premiar en un período de 12 meses. Esta no genera crédito, y la cuenta se reinicia conforme sus recomendaciones anteriores cumplan un año.',
    invite_expired:
      'Esa invitación ya había vencido cuando su amistad se mudó. Las invitaciones duran un tiempo limitado: comparta una nueva y sí contará.',
    invite_already_used:
      'Esa invitación ya la había usado otra persona. Cada invitación funciona una sola vez; sus otras invitaciones no se ven afectadas.',
    different_facility:
      'Su amistad rentó en otra ubicación. La recompensa aplica cuando ambos rentan en el mismo lugar.',
    program_disabled: 'El programa de recomendaciones no está activo en esta ubicación por ahora.',
  },

  settlementRefund: (amount) =>
    `Le debemos ${amount} de reembolso — nos comunicaremos con usted para hacérselo llegar.`,
  settlementOutstanding: (amount) => `Quedan ${amount} pendientes en la cuenta.`,
  settlementSettled: 'Su cuenta queda saldada por completo — no debe nada más.',

  transferChargedToday: (amount) =>
    `Hoy se le cobró ${amount} por el resto de este período de facturación.`,
  transferCreditedToday: (amount) => `Se acreditaron ${amount} a su cuenta.`,
  transferNothingToPay: 'Hoy no hubo nada más que pagar.',

  theDateYouRequested: 'la fecha que usted solicitó',
  theUnitYouChose: 'la unidad que usted eligió',

  dunningSubjectFirst: 'No recibimos su pago',
  dunningSubjectMiddle: 'Su saldo sigue pendiente',
  dunningSubjectLast: 'Su cuenta está seriamente vencida',
  dunningTone: [
    'Parece que el pago de este mes no se procesó — pasa seguido, y se resuelve rápido.',
    'Su saldo sigue pendiente, y es posible que ya se haya agregado un cargo por atraso.',
    'Esta cuenta está lo bastante atrasada como para poner en riesgo su acceso a la puerta.',
    'Esta cuenta está seriamente vencida y necesitamos saber de usted.',
  ],
  dunningConsequence: [
    'Si paga hoy, evita cualquier cargo por atraso.',
    'Por favor sáldelo cuando pueda, o llámenos y buscamos una solución juntos.',
    'Si sigue sin pagarse, su código de la puerta dejará de funcionar hasta que se salde el saldo. Sus pertenencias se quedan donde están.',
    'Si no sabemos de usted, tendríamos que iniciar los pasos formales de cobranza que permiten nuestro contrato y la ley estatal. Preferimos mucho más llegar a un acuerdo con usted.',
  ],

  paymentFailedExpiredCard: 'La tarjeta que tenemos registrada venció, así que no pudimos cobrar el pago.',
  paymentFailedDeclined:
    'Su banco rechazó el pago. Por lo general es un bloqueo temporal o un límite, no algo mal con su cuenta aquí.',
  retryLastReminder:
    'Este es el último recordatorio que le enviaremos sobre este pago. Si sigue sin pagarse, alguien de la oficina se comunicará con usted.',
  retryWillTryAgain:
    'Volveremos a intentar el cobro con la tarjeta automáticamente, así que si la actualiza o agrega fondos, no hay nada más que hacer.',
  paymentMethods: {
    card: 'tarjeta',
    ach: 'transferencia bancaria',
    cash: 'efectivo',
    check: 'cheque',
    money_order: 'giro postal',
  },

  cardExpiresSoon: 'pronto',
  cardUrgencyThisWeek: 'Vence dentro de esta semana, así que conviene hacerlo hoy.',
  cardUrgencyRelaxed: 'No hay prisa — cualquier momento en las próximas semanas está bien.',

  protectionExpiresSoon: 'pronto',
  protectionStandardPlan: 'nuestra cobertura estándar',

  callForPricing: 'Llame para conocer los precios actuales',

  planScheduleCaption: 'Su plan de pagos',
  planScheduleColumns: ['Pago', 'Fecha', 'Monto'],
  planCollectionAutomatic: (subject) =>
    subject === 'each'
      ? 'Cobraremos cada pago a la tarjeta que tiene registrada en la fecha indicada — usted no tiene que hacer nada.'
      : 'Cobraremos este pago a la tarjeta que tiene registrada en la fecha indicada — usted no tiene que hacer nada.',
  planCollectionManual: (subject) =>
    subject === 'each'
      ? 'Estos pagos no se cobran automáticamente. Pague en línea, por teléfono o en la oficina, a más tardar en la fecha indicada.'
      : 'Este pago no se cobra automáticamente. Pague en línea, por teléfono o en la oficina, a más tardar en la fecha indicada.',
  planGraceAgreed: (graceDays) =>
    graceDays > 0
      ? `Si un pago se atrasa, tiene ${graceDays} ${graceDays === 1 ? 'día' : 'días'} para ponerse al corriente. Si después de eso sigue sin pagarse, o si no se paga la renta nueva, el plan termina, los tres pagos vuelven a empezar y se vence el monto completo.`
      : 'Si no se hace un pago, o si no se paga la renta nueva, el plan termina, los tres pagos vuelven a empezar y se vence el monto completo.',
  planGraceDueSoon: (graceDays) =>
    graceDays > 0
      ? `Si se atrasa, tiene ${graceDays} ${graceDays === 1 ? 'día' : 'días'} para ponerse al corriente. Después de eso el plan termina: se vence todo el monto que debe, los cargos por atraso vuelven a aplicarse y se le puede cortar el acceso a la puerta.`
      : 'Si no se hace, el plan termina: se vence todo el monto que debe, los cargos por atraso vuelven a aplicarse y se le puede cortar el acceso a la puerta.',

  unsubscribe: 'Cancelar la suscripción',
  smsOptOut: 'Responda STOP para darse de baja, o HELP para obtener ayuda; estas dos palabras se escriben en inglés.',
}

export const COMMS_PROSE: Record<Locale, CommsProse> = { en, es }

export function proseFor(locale: Locale): CommsProse {
  return COMMS_PROSE[locale]
}
