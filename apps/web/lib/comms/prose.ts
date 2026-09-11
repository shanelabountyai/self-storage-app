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

/// B-265. The nine `sendDirectEmail` sends, minus the three D-122 keeps
/// English. Split into its own type rather than flattened into `CommsProse`
/// because these belong to named MESSAGES rather than to a merge field: the
/// grouping is what makes "is every sentence of the reservation confirmation
/// translated?" a question the reader can answer by looking.
///
/// The subject is here with the body for the same reason `renderEmail` renders
/// one document: a Spanish body under an English subject is the halfway state
/// this file exists to make impossible.
export type DirectProse = {
  /// Shared by the reservation confirmation and the waitlist mail, which are
  /// the two that may or may not know a first name.
  hi: (firstName: string | null) => string

  // ── checkout resume link (PRD 05 CN-22) ───────────────────────────────────
  resumeSubject: string
  resumeHolding: (until: string) => string
  resumeFinish: (link: string) => string

  // ── reservation confirmation (US-401) ─────────────────────────────────────
  reservationSubject: (facility: string) => string
  reservationHolding: (size: string, facility: string, rate: string) => string
  reservationHoldUntil: (until: string) => string
  reservationFinish: (link: string) => string
  /// Null when the facility has no published number — the sentence loses the
  /// clause rather than naming a blank.
  reservationQuestions: (phone: string | null) => string

  // ── magic link / password reset ───────────────────────────────────────────
  //
  // Keyed by `AuthTokenPurpose`'s two link-shaped members. Spelled out rather
  // than imported from `lib/auth/send-auth-email.ts`: the send path must not
  // depend on the auth module to know what words to use.
  authSubject: Record<'magic_link' | 'password_reset', (site: string) => string>
  authIntro: Record<'magic_link' | 'password_reset', string>
  authExpiry: (minutes: number) => string
  /// B-287. Leads the reset email when staff, not the recipient, caused it:
  /// they were just given sight of a business account. Says why the mail came
  /// and that the link is optional for somebody who already has a password.
  authAccountAccess: (account: string, site: string) => string

  // ── email change, to the NEW address (US-706) ─────────────────────────────
  emailChangeConfirmSubject: string
  emailChangeConfirmIntro: (site: string) => string
  /// The plaintext part says the same thing in one sentence, because it
  /// carries the URL inline instead of a link with a label.
  emailChangeConfirmText: (site: string) => string
  emailChangeConfirmCta: string
  emailChangeConfirmIgnore: string

  // ── email change, to the OLD address: the security alert ──────────────────
  emailChangeNoticeSubject: string
  /// `newEmail` arrives already marked up for the part being rendered — bold
  /// in the HTML, plain in the text — which is `MergeValue`'s device: one
  /// sentence, two renderings, no chance of the two saying different things.
  emailChangeNotice: (site: string, newEmail: string) => string
  emailChangeNoticeCall: (phone: string) => string

  // ── waitlist: a unit came free (D-87) ─────────────────────────────────────
  waitlistSubject: (size: string, facility: string) => string
  waitlistAvailable: (size: string, facility: string) => string
  /// D-87 again: no unit is held, and the Spanish says so as plainly as the
  /// English. Softening it in translation would promise a claim that does not
  /// exist to the reader least able to check.
  waitlistRace: string
  waitlistRent: (url: string) => string
  waitlistCall: (phone: string) => string
  waitlistCancel: (url: string) => string
}

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

  // ── direct sends (B-265) ──────────────────────────────────────────────────
  //
  // `sendDirectEmail`'s callers have no `MessageTemplate` row to translate:
  // each carries a secret minted in the moment it is sent — a resume token, a
  // reservation token, a sign-in link — and composes its own subject and body
  // at the call site. So the sentences live here, beside the ones the rule
  // path builds, rather than in the seeded catalog.
  //
  // Only the RENTER-facing sends are here. The staff alert, the report
  // subscription and the broadcast stay English under D-122 and say so at
  // their own call sites.
  direct: DirectProse
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

  direct: {
    hi: (firstName) => (firstName ? `Hi ${firstName},` : 'Hi,'),

    resumeSubject: 'Finish moving in online',
    resumeHolding: (until) =>
      `We're holding this unit for you until ${until}. After that it goes back on sale.`,
    resumeFinish: (link) => `Finish moving in where you left off: ${link}`,

    reservationSubject: (facility) => `Your unit at ${facility} is reserved`,
    reservationHolding: (size, facility, rate) =>
      `We're holding a ${size} unit for you at ${facility}, at ${rate}/mo. Nothing has been charged.`,
    reservationHoldUntil: (until) => `We'll hold it until ${until}.`,
    reservationFinish: (link) => `Complete your move-in online, or cancel the hold, here: ${link}`,
    reservationQuestions: (phone) =>
      `Questions? Reply to this email${phone ? ` or call ${phone}` : ''}.`,

    authSubject: {
      magic_link: (site) => `Sign in to ${site}`,
      password_reset: (site) => `Reset your ${site} password`,
    },
    authIntro: {
      magic_link: 'Use this link to sign in:',
      password_reset: 'Use this link to choose a new password:',
    },
    authExpiry: (minutes) =>
      `This link expires in ${minutes} minutes. If you did not request this, you can ignore this email.`,
    authAccountAccess: (account, site) =>
      `${site} gave you access to see the business account ${account} in your portal. If you already have a password, sign in as usual. If not, use the link below to choose one; if it has expired, ask for a new one from the sign-in page.`,

    emailChangeConfirmSubject: 'Confirm your new email address',
    emailChangeConfirmIntro: (site) =>
      `Use the link below to confirm this address for your ${site} account. It works for 24 hours.`,
    emailChangeConfirmText: (site) =>
      `Confirm this address for your ${site} account (works for 24 hours):`,
    emailChangeConfirmCta: 'Confirm this email address',
    emailChangeConfirmIgnore:
      'If you didn’t ask for this, you can ignore it — nothing changes until the link is opened.',

    emailChangeNoticeSubject: 'Someone asked to change your email address',
    emailChangeNotice: (site, newEmail) =>
      `We were asked to change the email address on your ${site} account to ${newEmail}. Nothing has changed yet — it only takes effect when the link we sent to that address is opened.`,
    emailChangeNoticeCall: (phone) => `If this wasn’t you, call us on ${phone} straight away.`,

    waitlistSubject: (size, facility) => `A ${size} unit is free at ${facility}`,
    waitlistAvailable: (size, facility) => `A ${size} unit has come free at ${facility}.`,
    waitlistRace:
      `You asked us to tell you — it's on sale to everyone else too, so the first person to complete a rental gets it.`,
    waitlistRent: (url) => `Rent it online: ${url}`,
    waitlistCall: (phone) => `Or call us on ${phone}.`,
    waitlistCancel: (url) => `If you no longer need a unit, take yourself off the list: ${url}`,
  },

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

  direct: {
    hi: (firstName) => (firstName ? `Hola ${firstName}:` : 'Hola:'),

    resumeSubject: 'Termine su mudanza en línea',
    resumeHolding: (until) =>
      `Le estamos apartando esta unidad hasta el ${until}. Después de esa hora vuelve a estar a la venta.`,
    resumeFinish: (link) => `Continúe donde se quedó: ${link}`,

    reservationSubject: (facility) => `Su unidad en ${facility} está apartada`,
    reservationHolding: (size, facility, rate) =>
      `Le estamos apartando una unidad de ${size} en ${facility}, por ${rate} al mes. No se le ha cobrado nada.`,
    reservationHoldUntil: (until) => `La apartamos hasta el ${until}.`,
    reservationFinish: (link) =>
      `Complete su mudanza en línea, o cancele el apartado, aquí: ${link}`,
    reservationQuestions: (phone) =>
      `¿Tiene preguntas? Responda a este correo${phone ? ` o llámenos al ${phone}` : ''}.`,

    authSubject: {
      magic_link: (site) => `Inicie sesión en ${site}`,
      password_reset: (site) => `Restablezca su contraseña de ${site}`,
    },
    authIntro: {
      magic_link: 'Use este enlace para iniciar sesión:',
      password_reset: 'Use este enlace para elegir una contraseña nueva:',
    },
    authExpiry: (minutes) =>
      `Este enlace vence en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}. Si usted no lo pidió, puede ignorar este correo.`,
    authAccountAccess: (account, site) =>
      `${site} le dio acceso para ver la cuenta de empresa ${account} en su portal. Si ya tiene contraseña, inicie sesión como siempre. Si no, use el enlace de abajo para elegir una; si ya venció, pida uno nuevo desde la página de inicio de sesión.`,

    emailChangeConfirmSubject: 'Confirme su nueva dirección de correo',
    emailChangeConfirmIntro: (site) =>
      `Use el enlace de abajo para confirmar esta dirección en su cuenta de ${site}. Funciona por 24 horas.`,
    emailChangeConfirmText: (site) =>
      `Confirme esta dirección en su cuenta de ${site} (funciona por 24 horas):`,
    emailChangeConfirmCta: 'Confirmar esta dirección de correo',
    emailChangeConfirmIgnore:
      'Si usted no pidió esto, puede ignorarlo: nada cambia hasta que se abra el enlace.',

    emailChangeNoticeSubject: 'Alguien pidió cambiar su dirección de correo',
    emailChangeNotice: (site, newEmail) =>
      `Nos pidieron cambiar la dirección de correo de su cuenta de ${site} a ${newEmail}. Todavía no ha cambiado nada: el cambio surte efecto solo cuando se abra el enlace que enviamos a esa dirección.`,
    emailChangeNoticeCall: (phone) => `Si no fue usted, llámenos al ${phone} de inmediato.`,

    waitlistSubject: (size, facility) => `Hay una unidad de ${size} libre en ${facility}`,
    waitlistAvailable: (size, facility) => `Se desocupó una unidad de ${size} en ${facility}.`,
    waitlistRace:
      'Usted nos pidió avisarle. También está a la venta para todos los demás, así que se la queda la primera persona que complete la renta.',
    waitlistRent: (url) => `Réntela en línea: ${url}`,
    waitlistCall: (phone) => `O llámenos al ${phone}.`,
    waitlistCancel: (url) =>
      `Si ya no necesita una unidad, quítese de la lista: ${url}`,
  },

  unsubscribe: 'Cancelar la suscripción',
  smsOptOut: 'Responda STOP para darse de baja, o HELP para obtener ayuda; estas dos palabras se escriben en inglés.',
}

export const COMMS_PROSE: Record<Locale, CommsProse> = { en, es }

export function proseFor(locale: Locale): CommsProse {
  return COMMS_PROSE[locale]
}
