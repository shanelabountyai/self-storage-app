import type { Dictionary } from './index'

// B-090 part 6 (D-122). Spanish for the move-in path.
//
// Typed as `Dictionary`, so a key added to `en.ts` and not translated here is
// a typecheck failure — `npm run typecheck` covers this file, which is the
// only mechanism that keeps a half-translated page from shipping quietly.
//
// Register: usted, not tú. This is a contract for a storage unit signed by an
// adult who may be handing us several hundred dollars a year; the familiar
// register reads as a marketing app talking down to them. Neutral Latin
// American Spanish, the variety a Texas renter is most likely to read.
//
// D-15's lexicon in Spanish, one word per concept and no synonyms:
//   size → tamaño · unit → unidad · online price → precio en línea ·
//   in-store price → precio en tienda · gate hours → horario de la puerta ·
//   office hours → horario de oficina.
// "Lease" stays out of the customer's Spanish the way D-15 keeps it out of
// their English: the agreement is a `contrato`.

export const es: Dictionary = {
  // --- Site chrome -------------------------------------------------------
  'chrome.skipToMain': 'Saltar al contenido principal',
  'chrome.mainNav': 'Principal',
  'chrome.footerNav': 'Pie de página',
  'chrome.findStorage': 'Buscar bodegas',
  'chrome.guides': 'Guías',
  'chrome.callUsAt': 'Llámenos al ',
  'chrome.payBill': 'Pagar',
  'chrome.payBillSr': ' o entrar a mi cuenta',
  'chrome.questionsCall': '¿Preguntas? Llame al',
  'chrome.orEmail': 'o escriba a',
  // Deliberately says one thing more than the English (D-122): the contract,
  // the notices and the pages a lawyer wrote are English-only, and the Spanish
  // reader is the only one for whom that is news. Translating a lien notice
  // is a liability, not a feature — so the honest move is to say where the
  // Spanish stops, on the page where they can still read it.
  //
  // B-259 NAMES the pages instead of saying "las páginas legales". It used to
  // say every legal page was English, and `/messaging-policy` is Spanish now —
  // a sentence whose whole job is to mark the boundary honestly cannot be left
  // one merge behind the boundary. What is listed is what is actually English:
  // `/terms`, `/privacy`, the lease and every notice.
  'chrome.disclaimer':
    '{name} es un proyecto de aprendizaje. Nada en este sitio es una oferta real de almacenamiento, y las páginas legales son borradores sin revisión legal. Los términos, la política de privacidad, el contrato y los avisos están únicamente en inglés.',

  // --- Language toggle ---------------------------------------------------
  'lang.label': 'Idioma',
  'lang.switchTo': 'Cambiar a {language}',
  'lang.offer': '¿Prefiere ver este sitio en español?',
  'lang.offerAccept': 'Ver en español',
  'lang.offerDismiss': 'No, gracias',

  // --- Homepage ----------------------------------------------------------
  'home.h1': 'Bodegas que puede rentar hoy, sin hacer una llamada.',
  'home.howHeading': 'Cómo funciona',
  'home.step': 'Paso',
  'home.step1.title': 'Encuentre una sucursal',
  'home.step1.body':
    'Busque por código postal o ciudad y compare precios y disponibilidad reales.',
  'home.step2.title': 'Reserve gratis',
  'home.step2.body':
    'Aparte una unidad sin tarjeta y sin cuenta — solo su nombre y una fecha de entrada.',
  'home.step3.title': 'Múdese en línea',
  'home.step3.body':
    'Firme el contrato, pague y reciba su código de la puerta sin ir a una oficina.',
  'home.helpHeading': '¿No sabe qué tamaño necesita?',
  'home.helpBodyBefore': 'La mayoría necesita menos espacio del que cree. Llame al',
  'home.helpBodyMiddle': 'y lo vemos juntos, o consulte',
  'home.helpSizeGuideLink': 'qué cabe en cada tamaño',

  // --- Brand + legal-page labels ----------------------------------------
  'site.tagline': 'Bodegas sencillas, rentadas en línea en minutos.',
  'nav.faq': 'Preguntas frecuentes',
  'nav.about': 'Quiénes somos',
  'nav.contact': 'Contacto',
  'nav.terms': 'Términos',
  'nav.privacy': 'Privacidad',
  'nav.accessibility': 'Accesibilidad',
  'nav.messagingPolicy': 'Mensajes de texto',

  // --- Search form + geolocation ----------------------------------------
  'search.labelWhere': '¿Dónde necesita una unidad?',
  'search.labelZipOrCity': 'Código postal o ciudad',
  'search.placeholder': 'Código postal o ciudad',
  'search.hint': 'Por ejemplo: 78704, o Austin, TX',
  'search.submit': 'Buscar',
  'location.use': 'Usar mi ubicación',
  'location.finding': 'Buscándolo…',
  'location.findingStatus': 'Buscando su ubicación…',
  'location.unavailable':
    'Este navegador no puede compartir su ubicación. Escriba un código postal o una ciudad.',
  'location.denied':
    'No pudimos obtener su ubicación. Escriba un código postal o una ciudad.',

  // --- Filter + sort labels (US-201) ------------------------------------
  'filter.size.small': 'Pequeño (hasta 5×5)',
  'filter.size.medium': 'Mediano (5×10 a 10×10)',
  'filter.size.large': 'Grande (10×15 en adelante)',
  'filter.feature.climate': 'Clima controlado',
  'filter.feature.driveUp': 'Acceso para vehículo',
  'filter.feature.power': 'Toma de corriente',
  'filter.feature.groundFloor': 'Planta baja',
  'sort.price': 'Precio: de menor a mayor',
  'sort.size': 'Tamaño: de menor a mayor',
  'common.and': 'y',

  // --- Search results (US-101/US-103) -----------------------------------
  'search.title': 'Buscar bodegas',
  'search.headingNear': 'Bodegas cerca de {label}',
  'search.empty': 'Escriba arriba un código postal o una ciudad para ver sucursales cerca de usted.',
  'search.notFoundHeading': 'No encontramos «{query}»',
  'search.notFoundBody':
    'Eso no parece un código postal ni una ciudad de Estados Unidos que reconozcamos, así que no podemos saber qué hay cerca. Pruebe con un código postal de 5 dígitos, o una ciudad y estado como «Austin, TX».',
  'search.noneListedHeading': 'Todavía no tenemos sucursales publicadas',
  'search.noneListedBody':
    'No hay nada que mostrarle aquí; es una carencia nuestra y no de su búsqueda.',
  'search.noneNearbyHeading': 'Nada a menos de {miles} millas de {label}',
  'search.noneNearbyBody':
    'Estas son las sucursales más cercanas que tenemos. Están más lejos de lo que la mayoría quiere manejar, así que revise la distancia antes de reservar.',
  'search.callCloser': 'si necesita algo más cerca — puede que tengamos espacio próximamente.',
  'search.resultsHeading': 'Resultados de la búsqueda',
  'search.countOne': '{count} sucursal a menos de {miles} millas, la más cercana primero',
  'search.countOther': '{count} sucursales a menos de {miles} millas, la más cercana primero',
  'search.carryingBefore': 'Conservamos su filtro de',
  'search.carryingAfter': '— elija una sucursal y lo aplicaremos allí.',
  'search.sizeGuideBefore': '¿No sabe qué tamaño necesita? Lea la',
  'search.sizeGuideLink': 'guía de tamaños',
  'dead.call': 'Llame al {phone}',
  'dead.callSuffix': 'y le buscamos una unidad.',
  'card.noUnits': 'No hay unidades disponibles en este momento —',
  'card.call': 'llame al {phone}',
  'card.from': 'desde',
  'card.perMonth': '/mes',
  'card.priceSr': '{width} pies por {length} pies desde {price} al mes',
  'card.onlyLeftOne': 'Queda solo {count} unidad',
  'card.onlyLeftOther': 'Quedan solo {count} unidades',
  'card.sizesAvailableOne': '{count} tamaño disponible',
  'card.sizesAvailableOther': '{count} tamaños disponibles',
  'map.full': 'Lleno',

  // --- Facility page (US-2, US-201, US-301, §6.3/§6.6) -------------------
  'facility.notFound': 'Sucursal no encontrada',
  'facility.hoursUnpublished': 'Todavía no publicado —',
  'facility.hoursUnpublishedAfter': 'para confirmar antes de manejar hasta allá.',
  'facility.closed': 'Cerrado',
  'facility.to': ' a ',
  'facility.officeHours': 'Horario de oficina',
  'facility.gateHours': 'Horario de la puerta',
  'facility.hoursHeading': 'Horarios',
  'facility.hoursIntro':
    'En la oficina hay personal. El horario de la puerta es cuando su código la abre — normalmente más amplio.',
  'facility.sizeHint.closet': 'Cabe más o menos un clóset grande: cajas, una bicicleta, cosas de temporada.',
  'facility.sizeHint.studio': 'Cabe más o menos un estudio: una cama, cajas, muebles pequeños.',
  'facility.sizeHint.oneBed': 'Cabe más o menos un departamento de una recámara, con sofá incluido.',
  'facility.sizeHint.twoBed': 'Cabe más o menos una casa de dos o tres recámaras.',
  'facility.sizeHint.house': 'Cabe una casa de tres recámaras, o un carro con espacio de sobra.',
  'facility.whatYoudPay': 'Lo que pagaría hoy',
  'facility.chosenAtCheckout': 'se elige al pagar',
  'facility.totalDueToday': 'Total a pagar hoy',
  'facility.thenEachMonth': 'Después, cada mes',
  'facility.feature.climate': 'Clima controlado',
  'facility.feature.driveUp': 'Acceso para vehículo — llegue en carro hasta la puerta',
  'facility.feature.power': 'Toma de corriente',
  'facility.feature.floor': 'Piso {floor}',
  'facility.footBy': '{width} pies por {length} pies',
  'facility.perMonthOnline': '/mes en línea',
  'facility.promoFromCode':
    'Se aplica a su primera factura. Su código continúa hasta el pago.',
  'facility.promoAutomatic':
    'Se aplica a su primera factura. No hay nada que escribir — ya está incluido en el total de abajo.',
  'facility.inStoreStruck': '{price}/mes en tienda',
  'facility.savingOnline': '— {amount} menos por rentar en línea',
  'facility.sqFt': '{sqFt} pies cuadrados',
  'facility.ceiling': ' · {height} pies de altura',
  'facility.rentNow': 'Rentar ahora',
  'facility.reserveForFree': 'Reservar gratis',
  'facility.reserveFree': 'Reservar gratis',
  'facility.trustLine':
    'Mes a mes, sin compromiso a largo plazo · Reservar es gratis y no pide tarjeta',
  'facility.allRented': 'Todo rentado en este momento — ',
  'facility.allRentedAfter': ' sobre este tamaño; casi todas las semanas se desocupa algo.',
  // Spanish agrees the verb with the count where English does not, so these
  // need the singular/plural split English can skip. Found by rendering the
  // page rather than by reading it: "Quedan solo 1" is what a single unit read
  // before the split.
  'facility.onlyLeftOne': 'Queda solo {count}',
  'facility.onlyLeftOther': 'Quedan solo {count}',
  'facility.availableOne': '{count} disponible',
  'facility.availableOther': '{count} disponibles',
  'facility.narrowThese': 'Reduzca la lista',
  'facility.size': 'Tamaño',
  'facility.anySize': 'Cualquier tamaño',
  'facility.sortBy': 'Ordenar por',
  'facility.features': 'Características',
  'facility.apply': 'Aplicar',
  'facility.clearFilters': 'Quitar filtros',
  'facility.matchesOne': '{count} tamaño coincide',
  'facility.matchesOther': '{count} tamaños coinciden',
  'facility.noLiveAvailability': 'No podemos mostrar la disponibilidad en vivo en este momento.',
  'facility.noLiveAvailabilityAfter':
    'para confirmar qué hay libre y se lo apartamos.',
  'facility.noFilterMatch': 'Nada coincide con esos filtros.',
  'facility.clearThem': 'Quítelos',
  'facility.clearThemAfter': 'para ver todos los tamaños de esta sucursal.',
  'facility.noSizesPublished': 'Todavía no publicamos los tamaños de esta sucursal.',
  'facility.noSizesPublishedAfter': 'y le decimos qué hay aquí.',
  'facility.everythingRented': 'Todo aquí está rentado en este momento.',
  'facility.availableSmallestOne': '{count} tamaño disponible, del más pequeño al más grande',
  'facility.availableSmallestOther': '{count} tamaños disponibles, del más pequeño al más grande',
  'facility.alsoHereFull': 'También hay aquí, ahora lleno',
  'facility.callMainLine': 'Llame a nuestra línea principal, {phone}',
  'facility.callPhone': 'Llame al {phone}',
  'facility.getDirections': 'Cómo llegar',
  'facility.getDirectionsSr': ' a {name}, abre su aplicación de mapas',
  'facility.backToSearch': '← Volver a bodegas cerca de {query}',
  'facility.soldOutNotice':
    'Alguien tomó la última de ese tamaño justo antes que usted. No se ha cobrado nada — esto es lo que todavía tenemos.',
  'facility.unavailableNotice':
    'Ese tamaño ya no está disponible aquí. Esto es todo lo que sí tenemos.',
  'facility.monthToMonth': 'Mes a mes · sin compromiso a largo plazo',
  'facility.availableUnits': 'Unidades disponibles',
  'facility.from': 'Desde {price}',
  'facility.atThisFacility': 'En esta sucursal',
  'facility.whereWeAre': 'Dónde estamos',
  'facility.openDirections': 'Abrir cómo llegar en su aplicación de mapas',
  'facility.showMap': 'Ver el mapa',
  'facility.mapTitle': 'Mapa que muestra {name} en {address}',
  'facility.aboutThisLocation': 'Sobre esta sucursal',
  'facility.photos': 'Fotos',
  'facility.askUs': '¿Todavía no se decide? Pregúntenos',
  'facility.askUsBody':
    'Una cotización o una llamada de vuelta, sin crear cuenta. No usaremos esto para inscribirlo en nada.',
  'facility.whatRentersSay': 'Lo que dicen los inquilinos',
  'facility.ratedOne': '{rating} de 5, con {count} reseña',
  'facility.ratedOther': '{rating} de 5, con {count} reseñas',
  'facility.starsLabel': '{rating} de 5 estrellas',
  'facility.questionsPeopleAsk': 'Preguntas frecuentes',
  'facility.otherLocations': 'vea otras sucursales',
  'facility.sizeGuideOr': ', o',

  // --- The reservation form on the facility page (US-401, B-267) ---------
  'reserve.title': 'Reserve una unidad gratis',
  'reserve.back': 'Volver a {facility}',
  'reserve.heading': 'Reserve esta unidad',
  'reserve.holdThroughMoveIn': 'Gratis hasta el final del día de su mudanza',
  'reserve.holdDayAfter': 'Gratis hasta el día siguiente al de su mudanza',
  'reserve.holdDays': 'Gratis por {days} días después del día de su mudanza',
  'reserve.noCard': 'No necesita tarjeta de crédito',
  'reserve.cancelAnyTime': 'Cancele cuando quiera',
  'reserve.formLabel': 'Reservar una unidad',
  'reserve.emailHint': 'Ahí le enviamos su confirmación y su enlace para cancelar.',
  'reserve.moveInDate': 'Fecha de mudanza',
  'reserve.moveInHint': 'Podemos apartar una unidad hasta con {days} días de anticipación.',
  'reserve.noCommitment':
    'Reservar no cuesta nada y no lo compromete a rentar. Apartamos la unidad y este precio hasta que venza la reserva.',
  'reserve.holdUpdated':
    'Usted ya tenía una reserva de este tamaño, así que la actualizamos en lugar de apartar una segunda unidad. Su correo de confirmación original todavía tiene el enlace.',
  // --- La reserva en sí (US-401 / FR-3.2, B-268) -------------------------
  'res.title': 'Su reserva',
  'res.headingNew': 'Su unidad está apartada',
  'res.deadHeading': 'Este enlace ya no sirve',
  'res.deadBody':
    'Los enlaces de reserva dejan de funcionar cuando el apartado termina o se cancela. No le hemos cobrado nada y no estamos apartando nada para usted.',
  'res.deadCall': 'Llame al {phone}',
  'res.deadOffer': 'y le decimos qué hay disponible, o',
  'res.deadSearch': 'busque de nuevo',
  'res.endedCancelled':
    'Esta reserva está cancelada. No estamos apartando nada para usted y no le hemos cobrado nada: la unidad volvió a estar disponible para cualquiera.',
  'res.endedExpired':
    'Esta reserva venció. No estamos apartando nada para usted y no le hemos cobrado nada: la unidad volvió a estar disponible para cualquiera.',
  'res.endedConverted':
    'Ya completó su mudanza, así que el apartado terminó: esta unidad es suya, ya no está reservada para usted.',
  'res.facility': 'Sucursal',
  'res.unit': 'Unidad',
  'res.rateHeld': 'Precio que le apartamos',
  'res.holdUntil': 'Se la apartamos hasta',
  'res.reassureBefore':
    'No le hemos cobrado nada. Puede completar su mudanza en línea antes de que termine el apartado, o simplemente venir — llame al',
  'res.reassureAfter': 'si algo cambia.',
  'res.readyHeading': '¿Listo para mudarse?',
  'res.readyBody':
    'Termine en línea en unos minutos: firme el contrato, pague y reciba hoy mismo su código de la puerta.',
  'res.completeMoveIn': 'Completar la mudanza en línea',
  'res.cancelHeading': '¿Necesita cancelar?',
  'res.cancelBody':
    'Esto libera la unidad de inmediato y otra persona puede tomarla. No se puede deshacer, pero siempre puede reservar de nuevo si todavía está libre.',
  'res.cancelButton': 'Cancelar esta reserva',
  'res.cancelled': 'Cancelada. La unidad volvió a estar disponible y no le hemos cobrado nada.',

  // --- The lead form on the facility page (US-8, B-264) ------------------
  'lead.legend': '¿Qué desea?',
  'lead.quote': 'Una cotización',
  'lead.callback': 'Que le llamemos',
  'lead.name': 'Su nombre',
  'lead.email': 'Correo electrónico',
  'lead.phone': 'Teléfono',
  'lead.phoneHint': 'Obligatorio si desea que le llamemos.',
  'lead.size': 'Tamaño que le interesa',
  'lead.sizeUnsure': 'Todavía no sé',
  'lead.moveInDate': 'Cuándo se mudaría',
  'lead.note': '¿Algo más?',
  'lead.send': 'Enviar',
  'lead.thanks':
    'Listo: alguien de esta sucursal se pondrá en contacto con usted. Si es urgente, es más rápido llamarnos.',

  // --- El formulario de lista de espera de un tamaño agotado (US-30) -----
  'waitlist.summary': 'Avísenme por correo cuando se desocupe una unidad de {size}',
  'waitlist.email': 'Su correo electrónico',
  'waitlist.scope':
    'Un solo correo, sobre este tamaño en esta sucursal únicamente. Lleva un enlace para darse de baja de la lista.',
  'waitlist.add': 'Agrégueme a la lista',
  'waitlist.joined': 'Ya está en la lista. Le escribiremos en cuanto se desocupe una unidad.',

  // --- Move-in cost lines (US-301, shared with checkout) -----------------
  'cost.rent': 'Renta del primer mes',
  'cost.rent.note':
    'Si se muda a mitad de mes, solo le cobramos los días que use y el monto baja.',
  'cost.promo': 'Promoción',
  'cost.promo.note':
    'Se aplica únicamente a su primer mes. Después paga la tarifa normal.',
  'cost.admin': 'Cargo administrativo único',
  'cost.admin.note': 'Se cobra una sola vez, al mudarse.',
  'cost.tax': 'Impuesto',
  'cost.protection': 'Plan de protección',
  'cost.protection.note':
    'Usted elige un plan o muestra comprobante de su propia cobertura — lo escoge al pagar, así que todavía no está en este total.',

  // --- Checkout stepper (§6.4) ------------------------------------------
  'step.details': 'Sus datos',
  'step.unit_assign': 'Su unidad',
  'step.insurance': 'Protección',
  'step.lease': 'Contrato',
  'step.payment': 'Pago',
  'step.provisioned': 'Listo',
  'step.announcement': '{label} — paso {index} de {total}',
  'step.ofTotal': ' — paso {index} de {total}',
  'step.completedGoBack': ' — paso {index} de {total}, completado. Volver a este paso.',
  'step.completed': ', completado',
  'step.current': ', paso actual',
  'step.notStarted': ', sin empezar',
  'step.progressNav': 'Avance del proceso',
  'step.goBackForm': 'Volver a un paso completado',

  // --- Checkout shell (FR-4.1) ------------------------------------------
  'checkout.title': 'Múdese en línea',
  'checkout.notFoundHeading': 'No encontramos ese proceso de renta',
  'checkout.notFoundBody':
    'Puede que el enlace haya vencido. No se ha cobrado nada y no hay nada apartado para usted.',
  'checkout.findAUnit': 'Buscar una unidad',
  'checkout.orCall': 'o llame al',
  'checkout.gateHoursUnknown':
    'Horario de la puerta: llame para confirmar antes de venir.',
  'checkout.gateClosedToday': 'Hoy la puerta está cerrada.',
  'checkout.gateHoursToday': 'Horario de la puerta hoy: {open}–{close}.',
  'checkout.storageUnit': 'Unidad',
  'checkout.unitLabel': '{name} de {width} pies por {length} pies',
  'checkout.lostHeading': 'No pudimos conservar esa unidad',
  'checkout.lostIntro':
    'Apartamos una unidad durante 30 minutos mientras se muda, y ese tiempo se acabó.',
  'checkout.nothingCharged': 'No se ha cobrado nada.',
  'checkout.lostSameSize':
    'Todo lo que escribió sigue aquí — solo tenemos que pasarlo a otra unidad del mismo tamaño.',
  'checkout.lostCanMove':
    'Ese tamaño se acabó mientras lo pensaba. Todo lo que escribió sigue aquí, y podemos pasarlo a cualquiera de los tamaños de abajo.',
  'checkout.lostCannotMove':
    'Ese tamaño se acabó mientras lo pensaba. Desde aquí no podemos pasar esta renta a otro tamaño, así que lo más rápido es una llamada — o elija un tamaño en la página de la sucursal y empiece de nuevo.',
  'checkout.findAnother': 'Búsquenme otra unidad',
  'checkout.findAnotherSameSize': 'Búsquenme otra unidad del mismo tamaño',
  'checkout.callAndWeWillFind': 'y le buscamos algo — o elija una de estas.',
  'checkout.moveToAnotherSize': 'Cambiar a otro tamaño en {facility}',
  'checkout.otherSizesAt': 'Otros tamaños en {facility}',
  'checkout.moveMeToSize': 'Cámbienme a la de {width} pies por {length} pies {name}',
  'checkout.moveMeToThisSize': 'Cámbienme a este tamaño',
  'checkout.readAboutSizes': 'Lea sobre estos tamaños en {facility}',
  'checkout.orWaitFor': 'O espere una de {width} pies por {length} pies',
  'checkout.samePrice': 'el mismo precio que la unidad que tenía',
  'checkout.priceDiff': '{amount} al mes {direction} que la unidad que tenía',
  'checkout.more': 'más',
  'checkout.less': 'menos',
  'checkout.sameArea': 'la misma superficie',
  'checkout.areaDiff': '{amount} pies cuadrados {direction}',
  'checkout.bigger': 'más grande',
  'checkout.smaller': 'más pequeña',
  'checkout.trade': '{area}, {money}',
  'checkout.stepProtect': 'Proteja lo que guarda',
  'checkout.stepLease': 'Su contrato',
  'checkout.stepMovedIn': 'Ya se mudó',
  'checkout.emailedTo':
    'La unidad es suya. Le enviamos por correo su contrato y su recibo a',
  'checkout.didntArrive': '¿No llegó? Revise su carpeta de correo no deseado, o',
  'checkout.didntArriveAfter': 'y se lo mandamos otra vez.',
  'checkout.yourGateCode': 'Su código de la puerta',
  'checkout.unitNumber': 'Unidad {number}',
  'checkout.codeComing':
    'Le enviaremos su código de la puerta por mensaje de texto en 15 minutos. Si no le llega:',
  'checkout.codeComingAfter': 'y se lo leemos — de cualquier forma puede mudarse.',
  'checkout.nextPaymentBefore': 'Su próximo pago es de',
  'checkout.nextPaymentOn': 'el',
  'checkout.autopayOn':
    'El pago automático está activado — le avisaremos por correo dos días antes de cada cargo.',
  'checkout.autopayOff':
    'El pago automático está desactivado, así que usted paga por su cuenta. Le avisaremos por correo cuando se venza.',
  'checkout.goToAccount': 'Ir a mi cuenta',
  'checkout.bringALock': 'Traiga su propio candado, o compre uno en la oficina.',
  'checkout.getDirections': 'Cómo llegar',
  'checkout.facilityHours': 'Horarios y detalles de la sucursal',
  'checkout.continue': 'Continuar',
  'checkout.backTo': 'Volver a {step}',
  'checkout.backNoteNothingCharged':
    'Todavía no se ha cobrado nada. Su unidad sigue apartada mientras regresa.',

  // --- Promo code box in checkout (US-11 AC3) ---------------------------
  'promo.haveACode': '¿Tiene un código de promoción?',
  'promo.currentlyApplied':
    'Aplicado ahora: {terms}. Solo se aplica una promoción a la vez — si el código que escriba vale menos, conservamos esta.',
  'promo.formLabel': 'Agregar un código de promoción',
  'promo.field': 'Código de promoción',
  'promo.placeholder': 'por ejemplo SUMMER25',
  'promo.apply': 'Aplicar código',

  // B-266. Ver los comentarios en `en.ts`.
  'promo.codeApplied': 'Código aplicado: {terms}.',
  'promo.codeSuperseded':
    'Mantuvimos su mejor oferta: {terms}. Solo se aplica una promoción a la vez.',

  // B-269.
  'promo.terms.freeMonthsOne': 'Primer mes gratis',
  'promo.terms.freeMonthsOther': 'Primeros {count} meses gratis',
  'promo.terms.percentOffOne': '{percent}% de descuento el primer mes',
  'promo.terms.percentOffOther': '{percent}% de descuento los primeros {count} meses',
  'promo.terms.amountOffOne': '{amount} de descuento el primer mes',
  'promo.terms.amountOffOther': '{amount} de descuento los primeros {count} meses',
  'promo.terms.minStayOne': 'estancia mínima de {count} mes',
  'promo.terms.minStayOther': 'estancia mínima de {count} meses',

  // --- Protection step (US-501 step 3) ----------------------------------
  'protection.formLabel': 'Proteja lo que guarda',
  'protection.required':
    'Necesita cobertura para lo que guarda — uno de nuestros planes, o su propio seguro de casa.',
  'protection.optional':
    'Puede agregar cobertura para lo que guarda, o usar su propio seguro de casa.',
  'protection.notInsurance':
    'Este es un plan de protección que ofrecemos, no una póliza de seguro.',
  'protection.chooseLegend': 'Elija su cobertura',
  'protection.coversUpTo': 'Cubre hasta {amount} de sus cosas.',
  'protection.ownCover': 'Tengo mi propia cobertura',
  'protection.ownCoverBody':
    'Su seguro de casa o de inquilino ya cubre las cosas guardadas. Necesitamos los datos de abajo.',
  'protection.ownCoverLegend': 'Si va a usar su propia cobertura',
  'protection.insurer': 'Aseguradora',
  'protection.policyNumber': 'Número de póliza',
  'protection.policyExpires': 'La póliza vence',
  'protection.policyExpiresHint': 'Le recordaremos antes de que venza.',
  'protection.attest':
    'Confirmo que mi propio seguro cubre mis pertenencias mientras están guardadas aquí, y les avisaré si eso cambia.',

  // --- Lock warning (2.2.1) ---------------------------------------------
  'lock.announcement':
    'El apartado de su unidad está por vencer. No se ha cobrado nada, y puede conservarlo más tiempo.',
  'lock.stillThere': '¿Sigue ahí?',
  'lock.holdingOne': 'Le apartamos su unidad {count} minuto más.',
  'lock.holdingOther': 'Le apartamos su unidad {count} minutos más.',
  'lock.underAMinute': 'El apartado de su unidad vence en menos de un minuto.',
  'lock.reassurance': 'No se ha cobrado nada, y puede conservarlo más tiempo.',
  'lock.keepFormLabel': 'Seguir apartando mi unidad',
  'lock.keepAnother30': 'Consérvenla 30 minutos más',

  // --- Checkout actions: what the renter is told ------------------------
  'act.lockLapsed':
    'Se acabaron los 30 minutos que le apartamos la unidad. No se ha cobrado nada — abajo está lo que podemos hacer.',
  'act.lockLapsedUnits':
    'Se acabaron los 30 minutos que le apartamos las unidades. No se ha cobrado nada — abajo está lo que podemos hacer.',
  'act.detailsFailed': 'No pudimos guardar esos datos. Recargue la página e inténtelo de nuevo.',
  'act.detailsSaved': 'Datos guardados. Sigue: confirmar su unidad.',
  'act.checkoutNotFound': 'No encontramos ese proceso de renta.',
  'act.protectionAddedNote': 'Plan de protección agregado — {amount} al mes.',
  'act.ownCoverNote': 'Registramos su propia cobertura — no se agregó cargo de protección.',
  'act.protectionChoiceFailed':
    'No pudimos guardar esa selección. Recargue la página e inténtelo de nuevo.',
  'act.protectionAdded': 'Protección agregada — su total mensual subió {amount}.',
  'act.ownCoverRecorded':
    'Registramos su propia cobertura. No se agregó cargo de protección.',
  'act.leaseNotFound':
    'No encontramos su contrato. Recargue la página y lo volvemos a generar.',
  'act.signatureFailed': 'No pudimos registrar su firma. Recargue la página e inténtelo de nuevo.',
  'act.alreadySigned': 'Este contrato ya está firmado.',
  'act.continueFailed': 'No pudimos continuar. Recargue la página e inténtelo de nuevo.',
  'act.leaseSigned': 'Contrato firmado. Sigue: el pago.',
  'act.autopayOn':
    'El pago automático está activado. Le avisaremos por correo antes de cada cargo.',
  'act.autopayOff':
    'El pago automático está desactivado. Le avisaremos por correo cuando se venza cada pago.',
  'act.checkoutFinishedNoCode':
    'Este proceso ya terminó, así que ya no se le puede agregar un código.',
  'act.enterACode': 'Escriba un código primero.',
  'act.codeApplied': 'Código aplicado.',
  'act.stepContinueFailed':
    'No pudimos continuar desde este paso. Recargue la página e inténtelo de nuevo.',
  'act.unitConfirmed': 'Unidad confirmada. Sigue: la protección.',
  'act.sizeJustWent':
    'Ese tamaño se acaba de agotar. Nada cambió en su renta — elija otro tamaño, o siga con lo que tiene.',
  'act.lastUnit':
    'Esta es la única unidad de su renta, así que no hay nada que quitar. Para no rentar, simplemente cierre esta página — no se ha cobrado nada.',
  'act.basketFailed': 'No pudimos cambiar su renta. Recargue la página e inténtelo de nuevo.',
  'act.movedOnTo': 'Pasamos a {step}.',
  'act.alreadyPaid':
    'Su pago ya se procesó y la unidad es suya, así que no hay a dónde regresar. Recargue la página para ver su código de la puerta.',
  'act.notThatFarYet': 'Todavía no ha llegado tan lejos. Siga desde donde está.',
  'act.goBackFailed': 'No pudimos regresar a ese paso. Recargue la página e inténtelo de nuevo.',
  'act.holdAlreadyRanOut': 'Ese apartado ya había vencido. No se ha cobrado nada.',
  'act.extendFailed': 'No pudimos extender el apartado.',
  'act.heldAnother30': 'Apartada 30 minutos más.',
  'act.soldOutWhileDeciding':
    'Ese tamaño se agotó mientras lo pensaba. No se ha cobrado nada — abajo están el teléfono, los otros tamaños de aquí y la lista de espera.',
  'act.foundAnother':
    'Le encontramos otra unidad del mismo tamaño y conservamos todo lo que había escrito.',
  'act.pastPaymentNoSizeChange':
    'Ya llegó al pago en esta renta, así que no podemos cambiarla a otro tamaño — el total ya está cotizado. Llámenos y le preparamos la nueva, o empiece otra vez desde la página de la sucursal.',
  'act.thatSizeGoneToo':
    'Ese tamaño también se acaba de agotar. No se ha cobrado nada — abajo están el teléfono, los tamaños que siguen libres y la lista de espera.',
  'act.sizeMoveFailed':
    'No pudimos cambiar esta renta a ese tamaño. No se ha cobrado nada.',
  'act.sizeMoved': '{note} Conservamos todo lo que había escrito, y el precio de abajo es el del nuevo tamaño.',
  'act.unitAddedNote': 'Unidad {number} agregada — {name} de {width}×{length}.',
  'act.unitRemovedNote': 'Quitamos la unidad {number} de su renta.',
  'act.unitRemovedNoNumber': 'Esa unidad se quitó de su renta.',

  // --- Field errors (B-263, 3.3.3) --------------------------------------
  // Cada mensaje dice qué hacer, no solo qué salió mal. `err.postalCodeUnknown`
  // cita `details.enterMyself` palabra por palabra — si esa etiqueta cambia,
  // este mensaje también.
  'err.someFields': 'Hay problemas con {count} campos.',
  'err.firstName': 'Escriba su nombre.',
  'err.lastName': 'Escriba su apellido.',
  'err.email': 'Escriba un correo electrónico al que podamos enviarle el contrato y el recibo.',
  'err.phone': 'Escriba un número de celular con clave de área, por ejemplo 512-555-0100.',
  'err.addressLine1': 'Escriba su dirección.',
  'err.postalCode': 'Escriba un código postal de 5 dígitos, por ejemplo 78704.',
  'err.postalCodeUnknown':
    'No reconocemos ese código postal. Abra «Escribir mi ciudad y estado yo mismo» abajo y escríbalos.',
  'err.city': 'Escriba su ciudad.',
  'err.state': 'El estado debe ser un código de dos letras, por ejemplo TX.',
  'err.altContactPhone':
    'Escriba un número con clave de área, por ejemplo 512-555-0100, o déjelo en blanco.',
  'err.altContactPhoneMissing':
    'Agregue un número para su contacto alterno, o borre su nombre.',
  'err.typedNameEmpty': 'Escriba su nombre completo — {name} — para firmar.',
  'err.typedNameMismatch':
    'Eso no coincide con el nombre del contrato. Escríbalo así: {name}.',
  'err.consented': 'Marque la casilla para aceptar firmar electrónicamente.',
  'err.protectionChoose': 'Elija un plan de protección, o cuéntenos sobre su propio seguro.',
  'err.protectionPlan': 'Elija uno de los planes de protección de la lista.',
  'err.carrier': 'Escriba el nombre de su aseguradora, por ejemplo State Farm.',
  'err.policyNumber': 'Escriba su número de póliza — viene en su carátula de póliza.',
  'err.expiresAt': 'Escriba la fecha en que vence su póliza, como aaaa-mm-dd.',
  'err.expiresAtPast': 'Esa póliza ya venció. Escriba una cobertura que siga vigente.',
  'err.attested': 'Marque la casilla para confirmar que tiene su propio seguro.',
  'err.startDateFormat': 'Escriba la fecha como año-mes-día, así: {date}.',
  'err.startDateEarly':
    'Una mudanza no puede empezar antes de hoy. La fecha más temprana que puede elegir es {date}.',
  'err.startDateLate':
    'Podemos programar una mudanza hasta con {days} días de anticipación. La fecha más lejana que puede elegir es {date}.',

  // B-267. Los rechazos del formulario de reserva.
  'err.reserveEmail': 'Escriba un correo electrónico al que podamos enviarle su confirmación.',
  'err.reservePhone':
    'Escriba un número de celular para poder enviarle los detalles por mensaje de texto.',
  'err.reserveMoveIn': 'Elija la fecha en que quiere mudarse.',
  'err.reserveMoveInTooFar':
    'Podemos apartar una unidad hasta con {days} días de anticipación. Elija una fecha dentro de ese plazo.',
  'err.reserveUnlisted': 'Esa unidad ya no está publicada.',
  'err.reserveSoldOut':
    'Alguien tomó la última de ese tamaño mientras usted llenaba este formulario. No se le ha cobrado nada: elija otro tamaño, o llámenos y lo resolvemos.',
  // B-268. Los rechazos de `/reservations`. Ver los comentarios en `en.ts`.
  'err.reservationNotHeld':
    'Esa reserva ya estaba cancelada o ya había terminado, así que no había nada que liberar.',
  'err.reservationNotFound': 'No encontramos esa reserva. Puede que el enlace haya vencido.',
  'err.reservationNotLive': 'Esta reserva ya no está activa, así que no hay nada que continuar.',
  'err.reservationUnitGone':
    'Esa unidad ya no está disponible. Llámenos y le buscamos otra.',

  // B-266. Los siete rechazos, uno por regla. Ver los comentarios en `en.ts`.
  'err.promoUnknown': 'Ese código no es uno de los nuestros. Revise si tiene un error de escritura.',
  'err.promoWrongFacility': 'Ese código es para otra sucursal.',
  'err.promoWrongSize': 'Ese código no se aplica a este tamaño.',
  'err.promoNewTenantOnly': 'Ese código es solo para clientes nuevos.',
  'err.promoExpired': 'Ese código ya venció.',
  'err.promoFullyClaimed': 'Ese código ya se agotó.',
  'err.promoNotRunning': 'Ese código no está vigente en este momento.',

  // B-264. Los rechazos del formulario de contacto.
  'err.leadName': 'Díganos cómo dirigirnos a usted.',
  'err.leadContact':
    'Un correo electrónico o un teléfono: necesitamos alguna forma de responderle.',
  'err.leadEmail': 'Revise el correo electrónico: parece estar incompleto.',
  'err.leadPhone': 'Un teléfono con al menos 10 dígitos, para que alguien pueda llamarle.',
  'err.leadRateLimited':
    'Son muchas consultas desde un mismo lugar en poco tiempo. Espere unos minutos, o llámenos.',

  // Los rechazos del formulario de lista de espera.
  'err.waitlistEmail': 'Escriba un correo electrónico donde podamos localizarle.',
  'err.waitlistUnitGone': 'Esa unidad ya no está publicada.',
  'err.waitlistNoFacility': 'Esta consulta no está asociada a ninguna sucursal.',

  // --- Checkout announcer (4.1.3, 2.4.3) --------------------------------
  'announce.movedToSize': 'Lo cambiamos a la {size}. No se perdió nada de lo que escribió.',
  'announce.foundSameSize':
    'Le encontramos otra unidad del mismo tamaño. No se perdió nada de lo que escribió.',
  'announce.heldAnother30': 'Su unidad queda apartada 30 minutos más.',

  // --- Price summary (§6.4 / US-301) ------------------------------------
  'summary.heading': 'Lo que va a pagar',
  'summary.dueToday': 'A pagar hoy',
  'summary.then': 'después',
  'summary.unitsAt': '{units} en {facility}',
  'summary.nUnits': '{count} unidades',
  'summary.chosenAtCheckout': 'se elige al pagar',
  'summary.ownCover': 'su propia cobertura',
  'summary.perUnitTimes': '{each} × {count} unidades',
  'summary.totalDueToday': 'Total a pagar hoy',

  // --- Unit step (US-501 step 2, B-106) ---------------------------------
  'unit.oneAt': 'Su unidad en {facility}.',
  'unit.manyAt': 'Sus {count} unidades en {facility} — {total} en total.',
  'unit.numbered': 'Unidad {number}',
  'unit.unnumbered': '{label} (unidad {index})',
  'unit.remove': 'Quitar {name}',
  'unit.addFormLabel': 'Agregar otra unidad',
  'unit.sizeToAdd': 'Tamaño que quiere agregar',
  'unit.sizeToAddHint': '¿Va a rentar más de una? Agréguela aquí y páguelas juntas.',
  'unit.addToRental': 'Agregar a mi renta',
  'unit.holdingOne':
    'Mes a mes — sin compromiso a largo plazo. Le estamos apartando esta unidad mientras termina.',
  'unit.holdingMany':
    'Mes a mes — sin compromiso a largo plazo. Le estamos apartando estas unidades mientras termina.',
  'unit.confirmFormLabel': 'Confirmar esta unidad',
  'unit.moveInDate': 'Fecha de entrada',
  'unit.moveInDateAll': 'Fecha de entrada para todas sus unidades',
  'unit.startsToday': 'En esta sucursal las entradas empiezan hoy.',
  'unit.dateRange':
    'Cualquier día entre el {earliest} y el {latest}. Déjelo como está para entrar hoy.',
  'unit.confirmOne': 'Está bien — continuar',
  'unit.confirmMany': 'Están bien — continuar',

  // --- Details step (US-501 step 1, B-112) -------------------------------
  'details.formLabel': 'Sus datos',
  'details.firstName': 'Nombre',
  'details.lastName': 'Apellido',
  'details.email': 'Correo electrónico',
  'details.emailHint':
    'Esta es su cuenta. Aquí le enviamos su contrato, su recibo y su código de la puerta — sin contraseña.',
  // D-111 / B-238. La versión del mostrador — nombra lo que se pierde, no dice
  // solo «opcional».
  'details.emailHintOptional':
    'Opcional. Sin él no hay cuenta en línea: ni recibo por correo electrónico, ni enlace de pago, ni aviso cuando un pago se atrasa o una unidad se programa para venta — eso va por correo postal y por teléfono. Déjelo en blanco antes que poner una dirección que no sea suya.',
  // B-271 / D-111. Solo en el mostrador. Nombra la CONSECUENCIA — que ninguna
  // de las dos cuentas podrá entrar al portal — no solo la coincidencia.
  'details.sharedEmail':
    '¿Es {heldBy} quien renta? Si es así, corrija el nombre abajo para usar esa cuenta. Si no, ambas conservan contrato y avisos, pero ninguna podrá entrar en línea.',
  'details.sharedEmailHeldBy': 'Ya lo usa',
  'details.sharedEmailRenting': 'Está rentando ahora',
  'details.sharedEmailConfirm': 'Sí, darle a {renting} su propia cuenta',
  'details.phone': 'Número de celular',
  'details.address1': 'Dirección',
  'details.address2': 'Departamento, suite o unidad (opcional)',
  'details.postalCode': 'Código postal',
  'details.postalCodeHint': 'Su ciudad y estado salen de aquí.',
  'details.cityAndState': 'Ciudad y estado',
  'details.fromYourZip': 'De su código postal',
  'details.enterMyself': 'Escribir mi ciudad y estado yo mismo',
  'details.city': 'Ciudad',
  'details.state': 'Estado',
  'details.stateHint': 'Código de dos letras, por ejemplo TX.',

  // --- Lease step (US-501 step 4) ---------------------------------------
  'lease.multiIntro':
    'Está rentando {count} unidades, así que hay un contrato para cada una. Son los mismos términos — firmar una vez abajo firma los {count}.',
  'lease.agreementFor': 'Contrato de {unit}',
  'lease.plainEnglishFor': 'Lo que esto significa en palabras sencillas — {unit}',
  'lease.fullAgreementFor': 'El contrato completo de {unit}',
  'lease.fullAgreement': 'El contrato completo',
  'lease.continueFormLabel': 'Continuar desde su contrato firmado',
  'lease.signedHeading': 'Firmado',
  'lease.signedOneBody':
    'Firmó este contrato el {date} como {name}. No hace falta firmarlo otra vez y no cambiaría nada — un contrato firmado queda fijo, que es justamente para lo que se firma.',
  'lease.signedManyBody':
    'Firmó los {count} contratos el {date} como {name}. No hace falta firmarlos otra vez y no cambiaría nada — un contrato firmado queda fijo, que es justamente para lo que se firma.',
  'lease.continueToPayment': 'Continuar al pago',
  'lease.signOne': 'Firmar el contrato',
  'lease.signMany': 'Firmar los {count} contratos',
  'lease.altContactLegend': 'Si no podemos localizarlo (opcional)',
  'lease.altContactName': 'Nombre',
  'lease.altContactPhone': 'Teléfono',
  'lease.activeDuty': 'Estoy en servicio activo en las fuerzas armadas de Estados Unidos',
  'lease.activeDutyHint':
    'Declarado por usted. Los militares en servicio activo tienen protecciones bajo la Servicemembers Civil Relief Act — no podemos vender los bienes guardados ni restringir el acceso sin una orden judicial. Si nos lo dice, se las aplicamos.',
  'lease.signHeading': 'Firmar',
  'lease.typeName': 'Escriba su nombre completo para firmar',
  'lease.typeNameHint':
    'Escríbalo tal como aparece en el contrato: {name}. Escribir su nombre aquí es su firma.',
  'lease.submitOne': 'Firmar y continuar',
  'lease.submitMany': 'Firmar los {count} y continuar',

  'lease.altContactBody':
    'Alguien a quien podamos contactar si un aviso sobre su unidad no le llega. Esto no le da acceso a su unidad, y no lo contactaremos para ninguna otra cosa.',
  'lease.copiesOne':
    'Le llegará una copia por correo, y puede descargarla cuando quiera. No se cobra nada hasta el siguiente paso.',
  'lease.copiesMany':
    'Le llegarán copias por correo, y puede descargarlas cuando quiera. No se cobra nada hasta el siguiente paso.',

  // --- Payment step (US-501 step 5, §6.9/D-11a) -------------------------
  'pay.whatYouArePaying': 'Lo que va a pagar hoy',
  'pay.autopayHeading': 'Pagos automáticos',
  'pay.autopayCheckbox': 'Pagar automáticamente cada mes',
  'pay.autopayOnBefore':
    'El pago automático está activado. Cobraremos a esta tarjeta',
  'pay.autopayOnAfter':
    'el día {day} de cada mes, y le avisaremos por correo dos días antes de cada cargo. Puede desactivarlo aquí mismo, o cuando quiera desde su cuenta.',
  'pay.autopayOffBefore':
    'El pago automático está desactivado. No se cobra nada automáticamente —',
  'pay.autopayOffAfter':
    'se vence el día {day} de cada mes y usted lo paga por su cuenta. Le avisaremos por correo cuando se venza cada pago. Puede activarlo aquí, o cuando quiera desde su cuenta.',
  'pay.saveChoice': 'Guardar esta selección',
  'pay.saveWarning':
    'Cambiar la casilla no hace nada hasta que presione Guardar esta selección. Si paga abajo sin guardar, queda como dice arriba.',
  'pay.cardDetails': 'Datos de la tarjeta',
  'pay.cardsUnavailable': 'Ahora mismo no podemos aceptar pagos con tarjeta en línea.',
  'pay.cardsUnavailableAfter':
    'y le tomamos el pago por teléfono y terminamos su mudanza. Mientras tanto, su unidad sigue apartada.',
  'pay.declined': 'Ese pago fue rechazado. Pruebe con otra forma de pago.',
  'pay.takingPaymentStatus': 'Procesando el pago. Puede tardar unos segundos.',
  'pay.takingPayment': 'Procesando el pago…',
  'pay.payAndComplete': 'Pagar y terminar la mudanza',

  // --- Portal chrome (US-701, B-239) ------------------------------------
  'portal.yourAccountFallback': 'su cuenta',
  'portal.signOut': 'Cerrar sesión',
  'portal.nav': 'Su cuenta',
  'portal.pay': 'Pagar {amount}',
  'portal.overview': 'Resumen',
  'portal.paymentMethods': 'Formas de pago',
  'portal.statements': 'Estados de cuenta',
  'portal.documents': 'Documentos',
  'portal.paymentPlan': 'Plan de pagos',
  'portal.manage': 'Administrar',
  'portal.transfer': 'Cambiar de unidad',
  'portal.access': 'Quién puede entrar',
  'portal.protection': 'Protección',
  'portal.contact': 'Datos de contacto',
  'portal.notifications': 'Avisos',
  'portal.refer': 'Recomiende a un amigo',
  'portal.moveOut': 'Desocupar',

  // --- Recurring charge parts (B-227, shared by /portal and /portal/methods)
  'charge.rent': 'la renta',
  'charge.tax': 'el impuesto',
  'charge.protection': 'su plan de protección',
  'charge.and': 'y',

  // --- Portal dashboard (US-702, §6.5) ----------------------------------
  'dash.title': 'Mi cuenta',
  'dash.unitHeading': '{facility} — Unidad {unit}',
  'dash.noUnits': 'Todavía no vemos una unidad activa en esta cuenta.',
  'dash.billedToPayer':
    'Esta unidad se factura a {account}. Su saldo forma parte del total de la cuenta que aparece abajo, donde puede pagar todas las unidades de una vez.',
  'dash.billedToOther':
    'Esta unidad se factura a {account}. Usted todavía puede pagarla — confirme primero con ellos para que no se pague dos veces.',
  'dash.pastDueBefore':
    'Su cuenta está vencida. Su código de la puerta no la abrirá hasta que se pague el saldo. Pague',
  'dash.pastDueAfter':
    'y su código de la puerta vuelve a funcionar, normalmente en un par de minutos.',
  'dash.payNow': 'Pagar {amount} ahora',
  'dash.orCallToPayOrSplit': 'para pagar por teléfono, o para preguntar por dividirlo en pagos.',
  'dash.orCallToPay': 'para pagar por teléfono.',
  'dash.orCall': 'O llame al',
  'dash.settlingAfter':
    'viene en camino desde su banco. Los pagos bancarios tardan unos cuatro días hábiles en acreditarse. Su saldo se actualiza cuando llegue, y no le cobraremos cargo por atraso mientras esté en tránsito.',
  'dash.balanceBefore': 'Tiene un saldo de',
  'dash.transferBefore': 'Pidió cambiarse a la',
  'dash.transferOn': 'el',
  'dash.transferHolding': 'Se la apartamos hasta el',
  'dash.manageRequest': 'Administrar esta solicitud',
  'dash.planEndedStrong': 'Su plan de pagos terminó',
  'dash.planEndedBody':
    'porque no se hizo un pago. El saldo completo de arriba se vence ahora, y los cargos por atraso y el acceso a la puerta vuelven a la normalidad.',
  'dash.planSeeWhatHappened': 'Ver el plan y qué pasó',
  'dash.orCallNumber': 'o llame al {phone}.',
  'dash.planLateStrong': 'Un pago de su plan está atrasado.',
  'dash.planLateBody': '{amount} se venció el {date}. Su plan sigue vigente si lo paga antes del',
  'dash.planMissedStrong': 'No se hizo un pago de su plan.',
  'dash.planMissedBody': '{amount} se venció el {date}.',
  'dash.planKeepIt': 'para conservar el plan, o llame al {phone}.',
  'dash.onAPlan': 'Usted tiene un plan de pagos.',
  'dash.planNextBefore': 'Su próximo pago es de',
  'dash.planNextOn': 'el',
  'dash.planNoneLeft': 'No le quedan pagos por hacer en él.',
  'dash.planSeeSchedule': 'Ver el calendario completo',
  'dash.moveOutBefore': 'Pidió desocupar el',
  'dash.currentBalance': 'Saldo actual',
  'dash.inCredit': '{amount} a favor',
  'dash.nextPayment': 'Próximo pago',
  'dash.nextPaymentOn': '{amount} el {date}',
  'dash.autopay': 'Pago automático',
  'dash.on': 'Activado',
  'dash.off': 'Desactivado',
  'dash.change': 'Cambiar',
  'dash.autopayNeedsCard': 'No hay tarjeta registrada — no se cobrará nada automáticamente.',
  'dash.gateCode': 'Código de la puerta',
  'dash.accessSuspended': 'El acceso está suspendido hasta que se pague el saldo. Llame al',
  'dash.withQuestions': 'si tiene preguntas.',
  'dash.gateCodeHiddenImpersonation':
    'El código de la puerta se oculta durante una sesión de soporte. El inquilino sí lo ve aquí.',
  'dash.gateCodeNotReady': 'Su código de la puerta todavía no está listo. Llame al',
  'dash.gateCodeNotReadyAfter': 'y lo dejamos entrar.',

  // --- Business account card on the dashboard (B-256, B-258) ------------
  'acct.summaryOne': '{facility} · {count} unidad · {rate}',
  'acct.summaryOther': '{facility} · {count} unidades · {rate}',
  'acct.owesOne': 'Esta cuenta debe {amount} por su unidad.',
  'acct.owesOther': 'Esta cuenta debe {amount} por sus unidades.',
  'acct.nothingOwed': 'Esta cuenta no debe nada en este momento.',
  'acct.memberNote':
    'Usted puede ver esta cuenta. {payer} es quien paga y la liquida, así que aquí no hay nada que usted deba pagar. Para pagarla de otra forma, llame al',
  'acct.payNow': 'Pagar {amount} ahora',
  'acct.allocationNote':
    'Un solo pago cubre toda la cuenta. Se aplica primero a los montos más antiguos, entre todas las unidades de abajo, y no a una unidad en particular.',
  'acct.tableCaption': 'Unidades facturadas a {account}',
  'acct.colUnit': 'Unidad',
  'acct.colRentedBy': 'Rentada por',
  'acct.colBalance': 'Saldo',
  'acct.autopayNote':
    'El pago automático se configura por unidad y cobra a la tarjeta que tiene registrada el inquilino de esa unidad. Pagar por medio de esta cuenta no cambia eso.',
  'acct.statementsLink': 'Estados de cuenta de esta cuenta',
  'dash.unitNumber': 'Unidad {unit}',

  // --- Pay screen (US-703) ----------------------------------------------
  'paypg.title': 'Pague su saldo',
  'paypg.notFoundAccount': 'No encontramos esa cuenta entre las suyas.',
  'paypg.notFoundUnit': 'No encontramos esa unidad en su cuenta.',
  'paypg.backToAccount': 'Volver a mi cuenta',
  'paypg.allPaidAccount': 'Está al corriente en {name} — no hay nada que pagar en este momento.',
  'paypg.allPaidUnit':
    'Está al corriente en la unidad {unit} — no hay nada que pagar en este momento.',
  'paypg.subheadAccount': '{facility} — {account}',
  'paypg.subheadUnit': '{facility} — Unidad {unit}',
  'paypg.captionAccount': 'Lo que debe {account}',
  'paypg.captionUnit': 'Lo que debe de la unidad {unit}',
  'paypg.colUnit': 'Unidad',
  'paypg.colWhat': 'Concepto',
  'paypg.colRentedBy': 'Rentada por',
  'paypg.colWhen': 'Fecha',
  'paypg.colAmount': 'Monto',
  'paypg.queryThis': 'Preguntar por esto — {phone}',
  'paypg.lateFeeAssessed': 'Cargo por atraso, aplicado el {on}',
  'paypg.balance': 'Saldo',
  'paypg.payingToday': 'Paga hoy',
  'paypg.gateOff': 'Su código de la puerta está desactivado.',
  'paypg.gateOnBefore': 'Pagar',
  'paypg.gateOnAfter': 'lo vuelve a activar, normalmente en un par de minutos.',
  'paypg.gateShortBefore': 'lo vuelve a activar — pagar',
  'paypg.gateShortAfter': 'lo deja desactivado.',
  'paypg.balanceRestored': 'Por ahora volvimos a poner su saldo completo.',
  'paypg.payDifferent': 'Pagar otra cantidad',
  'paypg.cardDetails': 'Datos de la tarjeta',
  'paypg.callInstead': 'Ahora mismo no podemos aceptar pagos con tarjeta en línea. Llame al',
  'paypg.callInsteadAfter': 'y le tomamos el pago por teléfono.',
  'amt.notANumber': 'Escriba una cantidad como 75 o 75.50.',
  'amt.belowMinimum': 'El pago más pequeño que podemos aceptar en línea es {min}.',
  'amt.aboveBalance': 'Eso es más de lo que debe. Escriba su saldo o menos.',
  'amt.abovePrepayCeiling':
    'Eso es mucho más de un año de renta. Llame a la oficina y se lo tomamos por teléfono.',
  'amt.nothingOwed': 'No hay nada que pagar en este momento.',

  // --- Gate code panel + pay amount form --------------------------------
  'gate.show': 'Ver el código de la puerta',
  'gate.hide': 'Ocultar el código de la puerta',
  'gate.copy': 'Copiar',
  'gate.copied': 'Copiado',
  'amtform.label': 'Cantidad en dólares',
  'amtform.reopens': '{amount} reabre su puerta, normalmente en un par de minutos.',
  'amtform.willNotReopen': '{amount} no reabrirá su puerta. {needed} sí.',
  'amtform.update': 'Actualizar la cantidad',

  // --- Portal payment element, share invite, unlock ---------------------
  'ppay.payAmount': 'Pagar {amount}',
  'invite.share': 'Compartir la invitación {code}',
  'invite.copied': 'Copiado — péguelo en un mensaje para su amigo.',
  'invite.copyFailed': 'Copie el código de arriba y envíelo como quiera.',
  'unlock.opening': 'Abriendo la puerta…',

  // --- Payment methods (§4.6, B-227) ------------------------------------
  'meth.title': 'Formas de pago',
  'meth.cardsOnFile': 'Tarjetas registradas',
  'meth.cannotShowCards': 'Ahora mismo no podemos mostrar sus tarjetas guardadas. Llame al',
  'meth.cannotShowCardsAfter': 'y le ayudamos.',
  'meth.noCardSaved': 'Todavía no tiene una tarjeta guardada.',
  'meth.cardEnding': '{brand} terminada en {last4}',
  'meth.isDefault': '· se cobra para los pagos automáticos',
  'meth.expires': 'Vence {month}/{year}',
  'meth.useCardLabel': 'Usar la tarjeta terminada en {last4} para los pagos automáticos',
  'meth.useThisCard': 'Usar esta tarjeta',
  'meth.removeCardLabel': 'Quitar la tarjeta terminada en {last4}',
  'meth.remove': 'Quitar',
  'meth.addACard':
    'Para agregar una tarjeta, pague un saldo con ella y elija guardarla, o llame al',
  'meth.autopayHeading': 'Pagos automáticos',
  'meth.noActiveUnit': 'No vemos una unidad activa en esta cuenta.',
  'meth.unitHeading': '{facility} — Unidad {unit}',
  'meth.autopayOnBefore': 'Cobramos',
  'meth.autopayOnAfter':
    '({parts}) el día {day} de cada mes — el próximo el {next}. Le avisamos por correo dos días antes de cada cargo.',
  'meth.autopayOff':
    'Desactivado. {amount} ({parts}) se vence el día {day} de cada mes y usted lo paga por su cuenta.',
  'meth.noCardWarning':
    'No hay tarjeta registrada para cobrarle, así que no se tomará nada automáticamente. Agregue una tarjeta, o desactive esto para recibir un recordatorio.',
  'meth.autopayFormLabel': 'Pagos automáticos de la unidad {unit}',
  'meth.turnOff': 'Desactivar los pagos automáticos',
  'meth.turnOn': 'Activar los pagos automáticos',

  // --- Payment receipt (/portal/pay/done) -------------------------------
  'rcpt.title': 'Comprobante de pago',
  'rcpt.notFound': 'No encontramos ese pago en su cuenta.',
  'rcpt.received': 'Pago recibido',
  'rcpt.failed': 'Ese pago no se procesó',
  'rcpt.processing': 'Pago bancario en camino',
  'rcpt.sent': 'Pago enviado',
  'rcpt.pendingBody':
    'Su banco ya lo tomó. Todavía lo estamos confirmando de nuestro lado — su saldo se actualiza en uno o dos minutos, y usted no tiene que hacer nada más.',
  'rcpt.processingBody':
    'Su pago bancario ya se envió. Los pagos bancarios tardan unos cuatro días hábiles en acreditarse — su saldo se actualiza cuando llegue, y no le cobraremos cargo por atraso mientras va en camino. Usted no tiene que hacer nada más.',
  'rcpt.cardDeclined': 'La tarjeta fue rechazada.',
  'rcpt.failedAfter': 'No se ha cobrado nada. Puede probar con otra tarjeta, o llamar al',
  'rcpt.amount': 'Monto',
  'rcpt.unit': 'Unidad',
  'rcpt.unitValue': '{facility} — {unit}',
  'rcpt.date': 'Fecha',
  'rcpt.balanceNow': 'Saldo actual',
  'rcpt.creditsCaption': 'Aplicado a unidades en {facility}',
  'rcpt.total': 'Total',

  // --- Pay link (B-283): /pay/<token> and its receipt --------------------
  'plink.nothingToPay': 'Nada que pagar',
  'plink.paidUp':
    'La unidad {unit} en {facility} está al corriente — este recordatorio ya se pagó. Gracias.',
  'plink.balanceToday': 'Saldo de hoy',
  'plink.payingNow': 'A pagar ahora',
  'plink.onlyThisScreen':
    'Este enlace solo abre esta pantalla de pago. Para ver su contrato, su código de la puerta o su historial de pagos,',
  'plink.signIn': 'inicie sesión en su cuenta',
  'plink.notFound': 'No encontramos ese pago.',
  'plink.failed': 'Ese pago no se completó',
  'plink.confirming': 'Pago recibido — todavía se está confirmando',
  'plink.unitValue': '{unit} — {facility}',
  'plink.pendingBody':
    'Su banco ya tomó el pago y estamos esperando la confirmación final. No tiene que hacer nada más — le enviaremos un recibo por correo electrónico.',
  'plink.declined':
    'Su banco rechazó el pago. Normalmente es un bloqueo temporal o un límite, no un problema con su cuenta aquí.',
  'plink.notCompleted': 'El pago no se completó.',
  'plink.tryAgain': 'Puede intentarlo de nuevo en esta página o llamar al {phone}.',
  'plink.fullHistory':
    'Para ver su contrato, su código de la puerta o su historial completo de pagos,',

  // --- Statements list --------------------------------------------------
  'stmt.title': 'Estados de cuenta',
  'stmt.settled': 'Liquidado',
  'stmt.none':
    'Todavía no tiene estados de cuenta. El primero aparece al terminar su primer mes completo.',
  'stmt.intro':
    'Un registro mes por mes de cada unidad: lo que debía al principio, todo lo que se cobró y se pagó, y lo que quedó al final.',
  'stmt.receiptsLink': 'Recibos individuales y su contrato',
  'stmt.allUnits': '· todas las unidades',
  'stmt.owedAtEnd': '{amount} pendiente al cierre del mes',
  'stmt.creditAtEnd': '{amount} a favor al cierre del mes',

  // --- Statement document (shared with the admin ledger) ----------------
  'sv.openingBalance': 'Saldo al inicio de {label}',
  'sv.charged': 'Cobrado este mes',
  'sv.paid': 'Pagado este mes',
  'sv.credits': 'Créditos',
  'sv.refunded': 'Reembolsado a usted',
  'sv.writtenOff': 'Cancelado',
  'sv.closingBalance': 'Saldo al final de {label}',
  'sv.everythingHeading': 'Todo lo de este mes',
  'sv.nothingHappened': 'No se cobró ni se pagó nada en esta unidad en {label}.',
  'sv.regionLabel': 'Estado de cuenta',
  'sv.caption': 'Cargos y pagos de la unidad {unit} en {label}',
  'sv.colDate': 'Fecha',
  'sv.colWhat': 'Concepto',
  'sv.colType': 'Tipo',
  'sv.colAmount': 'Monto',
  'sv.type.charge': 'Cargo',
  'sv.type.payment': 'Pago',
  'sv.type.credit': 'Crédito',
  'sv.type.refund': 'Reembolso',
  'sv.type.adjustment': 'Ajuste',
  'sv.type.write_off': 'Cancelado',
  'sv.title': 'Estado de cuenta',
  'sv.pageTitle': 'Estado de cuenta — {label}',
  'sv.allStatements': '← Todos los estados de cuenta',
  'sv.unitFacility': 'Unidad {unit} · {facility}',
  'sv.printNote':
    'Las fechas se muestran en la hora local de {facility}. Use la opción de imprimir de su navegador para guardar o imprimir este estado de cuenta.',
  'doc.title': 'Documento',
  'doc.notFound': 'No encontramos ese documento en su cuenta.',
  'doc.backToDocuments': 'Volver a los documentos',

  // --- Documents and receipts (US-704, B-146, B-179) --------------------
  'docs.title': 'Documentos y recibos',
  'docs.yourDocuments': 'Sus documentos',
  'docs.none':
    'Todavía no tiene documentos archivados. Su contrato firmado aparece aquí en cuanto se muda.',
  'docs.unitSuffix': ' · Unidad {unit}',
  'docs.download': 'Descargar',
  'docs.view': 'Ver',
  'docs.payments': 'Pagos',
  'docs.noPayments': 'Todavía no hay pagos.',
  'docs.paymentsCaption': 'Pagos de su cuenta, del más reciente al más antiguo',
  'docs.colDate': 'Fecha',
  'docs.colUnit': 'Unidad',
  'docs.colAmount': 'Monto',
  'docs.returned': 'El banco lo devolvió sin pagar, así que este monto se debe otra vez',
  'docs.returnedFee': ', junto con un cargo de {fee} por pago devuelto',
  'docs.payReturnedLabel': 'Pagar {amount} ahora de la unidad {unit}',
  'docs.payReturnedLabelNoUnit': 'Pagar {amount} ahora',
  'docs.payReturned': 'Pagar {amount} ahora',
  'docs.or': 'o',
  'docs.aboutThis': 'sobre esto.',
  'docs.returnedShort': 'devuelto',
  'docs.needReceipt':
    '¿Necesita un recibo de alguno de estos, o un estado de cuenta para su contabilidad? Llame al',
  'docs.needReceiptAfter': 'y se lo enviamos.',

  // --- Account statement (B-256) ----------------------------------------
  'astmt.noChange': 'Sin cambios',
  'astmt.added': '{amount} agregado',
  'astmt.cleared': '{amount} liquidado',
  'astmt.heading': '{account} — {label}',
  'astmt.unitsOne': '{count} unidad · {facility}',
  'astmt.unitsOther': '{count} unidades · {facility}',
  'astmt.caption': 'Todas las unidades facturadas a {account} en {label}',
  'astmt.colUnit': 'Unidad',
  'astmt.colOwedStart': 'Debía al inicio',
  'astmt.colChange': 'Cambio',
  'astmt.colOwedEnd': 'Debe al final',
  'astmt.allUnits': 'Todas las unidades',
  'astmt.note':
    'Esto es un resumen. El estado de cuenta de cada unidad lista todos sus cargos y pagos — siga el número de unidad para verlo. Las fechas se muestran en la hora local de {facility}. Use la opción de imprimir de su navegador para guardar o imprimir esta página.',

  // --- Payment plan (B-090c, B-193, D-98) -------------------------------
  'plan.title': 'Plan de pagos',
  'plan.intro':
    'Lo que se acordó y lo que falta. Su plan cubre el monto que ya estaba vencido cuando se estableció — su renta normal sigue venciéndose en su propia fecha cada mes, además de los pagos de abajo. Esta página se actualiza sola conforme llegan sus pagos. Los planes que ya terminó se quedan aquí para que vea lo que pagó.',
  'plan.none': 'En este momento no tiene un plan de pagos.',
  'plan.status.active': 'Activo — cumpla con las fechas de abajo y la cobranza sigue pausada.',
  'plan.status.completed': 'Completado — este plan está pagado. Gracias por cumplirlo.',
  'plan.status.broken':
    'Terminó porque no se hizo un pago. Todo el saldo de esta unidad se vence ahora, y los cargos por atraso y el acceso a la puerta volvieron a la normalidad.',
  'plan.status.cancelled':
    'Cancelado, así que ya no está vigente. El saldo de esta unidad se vence según sus términos normales.',
  'plan.heading': '{facility} — Unidad {unit} · acordado el {agreed}',
  'plan.paidOf': '{paid} pagado de {total}.',
  'plan.autoCollect':
    'Cobraremos a la tarjeta que tiene registrada cada pago en la fecha que se vence — usted no tiene que hacer nada.',
  'plan.selfPay':
    'Usted tendrá que hacer cada pago por su cuenta antes de la fecha de vencimiento. No le cobraremos automáticamente a su tarjeta por estos.',
  'plan.caption': 'Calendario de pagos de la unidad {unit}, acordado el {agreed}',
  'plan.colDue': 'Se vence',
  'plan.colAmount': 'Monto',
  'plan.colLeftAfter': 'Queda después',
  'plan.colStatus': 'Estado',
  'plan.missed': 'No pagado',
  'plan.lateBy': 'Atrasado — pague antes del {date}',
  'plan.status.paid': 'pagado',
  'plan.status.due': 'por pagar',
  'plan.status.upcoming': 'próximo',
  'plan.payDue': 'Pagar {amount} que se vence el {date}',
  'plan.payWholeInstead': 'Mejor pagar todo mi saldo de esta unidad',
  'plan.payBalance': 'Pagar mi saldo de esta unidad',

  // --- Protection and insurance (D-17) ----------------------------------
  'prot.title': 'Protección y seguro',
  'prot.intro':
    'Cada unidad necesita uno de nuestros planes de protección o su propio seguro. Los cambios entran en vigor al comenzar su siguiente mes de facturación — el cargo de este mes nunca cambia, y tampoco la cobertura que tiene hasta entonces.',
  'prot.noUnits': 'En este momento no tiene ninguna unidad.',
  'prot.unitFacility': ' · {facility}',
  'prot.youHaveBefore': 'Tiene',
  'prot.youHaveAfter': 'por {amount} al mes.',
  'prot.ownInsurance': 'Esta unidad está cubierta por su propio seguro.',
  'prot.expired':
    'La póliza que tenemos registrada venció el {date}. Hasta que nos dé una cobertura vigente, tenemos que agregar uno de nuestros planes de protección a esta unidad y cobrarlo. Mándenos su póliza nueva aquí abajo y eso se detiene.',
  'prot.pendingChange': 'Cambiará a {plan} ({amount} al mes) el {date}.',
  'prot.pendingStop':
    'Su plan de protección termina el {date} — a partir de entonces queda cubierto por su propio seguro.',
  'prot.callOffLabel': 'Cancelar este cambio',
  'prot.callOff': 'Cancelar esto',
  'prot.changeFormLabel': 'Cambiar la cobertura de la unidad {unit}',
  'prot.levelOfCover': 'Nivel de cobertura',
  'prot.choose': 'Elija…',
  'prot.planOption': '{name} — {coverage} de cobertura, {premium} al mes',
  'prot.iHaveOwn': 'Tengo mi propio seguro',
  'prot.changeCover': 'Cambiar la cobertura',
  'prot.tellUsSummary': 'Cuéntenos sobre su propio seguro',
  'prot.tellUsBody':
    'Necesitamos su aseguradora, su número de póliza y la fecha en que vence la póliza. Adjunte también la carátula de la póliza si la tiene a la mano — una foto sirve.',
  'prot.proofFormLabel': 'Su propio seguro de la unidad {unit}',
  'prot.insurer': 'Aseguradora',
  'prot.policyNumber': 'Número de póliza',
  'prot.runsOutOn': 'Vence el',
  'prot.declarationPage': 'Carátula de la póliza (opcional)',
  'prot.declarationHint':
    'Un PDF o una foto de la carátula, hasta 10 MB. Puede mandarnos los datos sin ella y traer el documento después.',
  'prot.sendDetails': 'Enviar estos datos',

  // --- Contact details (US-706) -----------------------------------------
  'cont.title': 'Datos de contacto',
  'cont.phoneSection': 'Teléfono y contacto alterno',
  'cont.phone': 'Teléfono',
  'cont.altName': 'Nombre del contacto alterno',
  'cont.altPhone': 'Teléfono del contacto alterno',
  'cont.altEmail': 'Correo del contacto alterno',
  'cont.saveDetails': 'Guardar los datos',
  'cont.addressSection': 'Dirección postal',
  'cont.addressIntro':
    'Aquí le enviamos por correo todo lo que tiene que llegarle en papel, así que vale la pena mantenerla al día.',
  'cont.address1': 'Dirección',
  'cont.address2': 'Departamento o unidad (opcional)',
  'cont.city': 'Ciudad',
  'cont.state': 'Estado',
  'cont.postalCode': 'Código postal',
  'cont.saveAddress': 'Guardar la dirección',
  'cont.previousAddresses': 'Direcciones anteriores',
  'cont.until': 'hasta el {date}',
  'cont.emailSection': 'Correo electrónico',
  'cont.emailIsBefore': 'Su correo es',
  'cont.emailIsAfter': 'También es como inicia sesión.',
  'cont.emailChangeIntro':
    'Para cambiarlo, enviamos un enlace a la dirección nueva para confirmar que le llega — y avisamos a la dirección actual, por si no fue usted quien lo pidió.',
  'cont.changeEmailFormLabel': 'Cambiar el correo electrónico',
  'cont.newEmail': 'Nuevo correo electrónico',
  'cont.sendConfirmation': 'Enviar el enlace de confirmación',

  // --- Notification preferences (CN-13, D-51) ---------------------------
  'notif.title': 'Preferencias de avisos',
  'notif.gridHeading': 'Qué le enviamos, y por dónde',
  'notif.regionLabel': 'Preferencias de avisos',
  'notif.colCategory': 'Categoría',
  'notif.colEmail': 'Correo',
  'notif.colText': 'Texto',
  'notif.byEmail': '{category} por correo',
  'notif.byText': '{category} por mensaje de texto',
  'notif.savePreferences': 'Guardar las preferencias',
  'notif.mandatoryNote':
    'Solo recordatorios de pago, recibos y avisos de la cuenta — no todo lo que enviamos. Los avisos de morosidad, la correspondencia relacionada con el gravamen y los avisos de aumento de renta siempre se envían por correo electrónico; eso es un requisito legal, no una preferencia, y aquí no hay control para ello.',
  'notif.cat.payment_reminders': 'Recordatorios de pago',
  'notif.cat.payment_reminders.desc':
    'Renta por vencer, renta que se vence hoy, una tarjeta que hay que actualizar.',
  'notif.cat.receipts': 'Recibos',
  'notif.cat.receipts.desc': 'Una copia de lo que se cobró, cada vez.',
  'notif.cat.operational_notices': 'Avisos operativos',
  'notif.cat.operational_notices.desc':
    'Acceso a la puerta, candados de las unidades, comprobante de seguro.',
  'notif.smsHeading': 'Consentimiento para mensajes de texto',
  'notif.smsIntroBefore':
    'Lo que enviamos, cuándo lo enviamos y cómo detenerlo está explicado en nuestra',
  'notif.smsPolicyLink': 'política de mensajes de texto',
  'notif.status': 'Estado',
  'notif.granted': 'Otorgado — los mensajes están activados',
  'notif.revoked': 'Revocado — los mensajes están desactivados',
  'notif.asOf': 'Desde',
  'notif.recordedFrom': 'Registrado desde',
  'notif.disclosureVersion': 'Versión del aviso',
  'notif.neverAskedSms':
    'Nunca le hemos preguntado sobre mensajes de texto, así que no le enviamos ninguno.',
  'notif.turnOffTexts': 'Desactivar los mensajes de texto',
  'notif.stopNote':
    'Esto tiene el mismo efecto que responder STOP a un mensaje nuestro: se detiene de inmediato todo mensaje de texto a este número, incluidos los de la cuenta y los de pagos.',
  'notif.languageHeading': 'El idioma en el que le escribimos',
  'notif.languageIntro':
    'Le enviaremos sus recibos, recordatorios de pago y avisos de la cuenta en este idioma. El selector de la parte superior de la página cambia lo que usted ve en este dispositivo; este cambia lo que le enviamos.',
  'notif.languageLabel': 'Idioma para correos y mensajes de texto',
  'notif.languageSave': 'Guardar idioma',
  'notif.languageNeverSet':
    'Usted no ha elegido uno, así que le escribimos en inglés.',
  'notif.languageSaved': 'Guardado. A partir de ahora le escribiremos en español.',
  'notif.languageLegalNote':
    'Su contrato y cualquier aviso formal que estemos obligados a enviarle por correo postal se mantienen en inglés.',
  'notif.marketingHeading': 'Mensajes de texto promocionales',
  'notif.marketingIntro':
    'Aparte de los mensajes de la cuenta de arriba. Desactivarlos nunca afecta los recordatorios de pago ni los códigos de la puerta, y activarlos no es requisito para rentar.',
  'notif.marketingGranted': 'Otorgado — los mensajes promocionales están activados',
  'notif.marketingRevoked': 'Revocado — los mensajes promocionales están desactivados',
  'notif.neverAskedMarketing':
    'Nunca le hemos preguntado sobre mensajes promocionales, así que no le enviamos ninguno.',
  'notif.turnOffMarketing': 'Desactivar los mensajes promocionales',
  'notif.turnOnMarketing': 'Activar los mensajes promocionales',

  // --- Refer a friend (PRD 10 §5.1/§5.6) --------------------------------
  'refer.title': 'Recomiende a un amigo',
  'refer.offer':
    'Cuando un amigo rente en {facility} con su invitación y su primer pago se acredite, él recibe {friendReward} de descuento en su primera factura y usted {yourReward} en la siguiente suya.',
  'refer.notRunning':
    'En este momento el programa de recomendaciones no está activo en {facility}.',
  'refer.noLease':
    'Las recomendaciones son para inquilinos actuales, y ahora mismo no hay un contrato activo en su cuenta.',
  'refer.yourInvites': 'Sus invitaciones',
  'refer.noInvites': 'No tiene invitaciones sin usar. Cree una y compártala con un amigo.',
  'refer.goodUntil': 'Válida hasta el {date}. Una por amigo.',
  'refer.shareMessage':
    'Bodegas en {facility} — use mi invitación y los dos recibimos un crédito: {link}',
  'refer.makeInvite': 'Crear una invitación nueva',
  'refer.yourReferrals': 'Sus recomendaciones',
  'refer.noReferrals':
    'Todavía nada. Cuando un amigo use una de sus invitaciones, aparecerá aquí.',
  'refer.regionLabel': 'Sus recomendaciones',
  'refer.caption':
    'Cada amigo que ha recomendado, en qué estado está su recomendación y cuándo llega el crédito',
  'refer.colFriend': 'Amigo',
  'refer.colState': 'Estado',
  'refer.colCredit': 'Crédito',
  'refer.notUsedYet': 'Todavía sin usar',
  'refer.onInvoiceDated': 'en su factura del {date}',
  'refer.onNextInvoice': 'en su próxima factura',
  'refer.state.shared': 'Invitación compartida — todavía sin usar',
  'refer.state.pending': 'Ya se mudó — esperando que se acredite su primer pago',
  'refer.state.earned': 'Crédito ganado',
  'refer.state.refused': 'Sin crédito',
  'refer.state.expired': 'La invitación venció sin usarse',
  'refer.state.clawed_back': 'Crédito revertido',
  'refer.terms': 'Las condiciones',
  'refer.term1': 'Cada invitación sirve una vez, para un amigo.',
  'refer.term2':
    'Su amigo tiene que ser nuevo con nosotros — alguien que ya rentó aquí antes no califica.',
  'refer.term3Before': 'El crédito se gana cuando se muda',
  'refer.term3And': 'y',
  'refer.term3After': 'se acredita su primer pago, no cuando reserva.',
  'refer.term4':
    'El suyo se descuenta de su próxima factura, que puede tardar hasta un mes. El de su amigo, de la primera suya.',
  'refer.term5':
    'Ninguno de los dos créditos es efectivo ni es reembolsable. Si desocupa con un crédito sin usar, no se conserva.',
  'refer.term6': 'Una invitación sin usar vence a los {days} días.',
  'refer.term7': 'Puede tener {cap} invitaciones sin usar a la vez.',

  // --- Who can get in (US-9, US-8) --------------------------------------
  'acc.title': 'Quién puede entrar',
  'acc.own': 'propio',
  'acc.unlockHeading': 'Abrir la puerta desde su teléfono',
  'acc.keypadStillWorks':
    'Su código de la puerta sigue funcionando en el teclado y siempre funcionará. El desbloqueo por teléfono necesita señal, así que tenga el código a la mano.',
  'acc.impersonatedNoUnlock':
    'La puerta no se puede abrir durante una sesión de soporte. El inquilino sí puede hacerlo desde esta página.',
  'acc.suspendedHere':
    'Su acceso aquí está desactivado mientras el saldo esté sin pagar, así que la puerta no se abrirá — ni desde su teléfono ni en el teclado.',
  'acc.openGateAt': 'Abrir la puerta en {facility}',
  'acc.openGate': 'Abrir la puerta',
  'acc.turnOffAt': 'Desactivar el desbloqueo por teléfono en {facility}',
  'acc.turnOffLostPhone': 'Desactivar el desbloqueo por teléfono — perdí este teléfono',
  'acc.notSwitchedOn':
    'No está activado. Al activarlo, esta cuenta recibe su propia llave, aparte de su código de la puerta — si pierde el teléfono, se desactiva esto, no se cambia su código.',
  'acc.turnOnAt': 'Activar el desbloqueo por teléfono en {facility}',
  'acc.turnOn': 'Activar el desbloqueo por teléfono',
  'acc.troubleAtGate': '¿Problemas en la puerta? Llame al',
  'acc.whoElse': 'Quién más puede entrar',
  'acc.noUnits': 'En este momento no tiene ninguna unidad.',
  'acc.unitFacility': ' · {facility}',
  'acc.unitSuspended':
    'El acceso a esta unidad está desactivado mientras el saldo esté sin pagar. Quien agregue ahora no podrá entrar hasta que se liquide — y tampoco pueden entrar las personas que ya están en esta lista.',
  'acc.nobodyElse': 'En este momento nadie más puede entrar a esta unidad.',
  'acc.untilDay': ' · hasta el {date}',
  'acc.theirCode': 'Su código:',
  'acc.codesHiddenSupport': 'Los códigos se ocultan durante una sesión de soporte.',
  'acc.callForCode': 'Llame a la oficina para pedir su código.',
  'acc.codeSwitchedOff': 'Su código está desactivado.',
  'acc.addedAtOffice': 'Agregado en la oficina.',
  'acc.withdrawFor': 'Retirar el acceso de {name}',
  'acc.withdraw': 'Retirar el acceso',
  'acc.atCap':
    'Ya tiene el máximo de personas que permite esta sucursal ({cap}). Retire a alguien para agregar a otra persona, o llame a la oficina.',
  'acc.addSomeone': 'Agregar a alguien',
  'acc.addSomeoneBody':
    'Recibirá su propio código, que le mostraremos en cuanto lo agregue. Puede tener hasta {cap} personas en esta unidad.',
  'acc.addFormLabel': 'Agregar a alguien a la unidad {unit}',
  'acc.fullName': 'Nombre completo',
  'acc.phone': 'Teléfono',
  'acc.relationship': 'Qué es de usted',
  'acc.relationshipHint': 'Por ejemplo: esposo, empleado, hermano.',
  'acc.whenTheyCanGetIn': 'Cuándo puede entrar',
  'acc.lastDay': 'Último día (opcional)',
  'acc.lastDayHint': 'Déjelo en blanco y su código funciona hasta que usted lo retire.',
  'acc.addThem': 'Agregarlo',
  'acc.hours.anytime': 'Cuando la puerta esté abierta',
  'acc.hours.weekdays': 'Solo entre semana',
  'acc.hours.weekends': 'Solo fines de semana',
  'acc.hours.custom': 'Horario limitado — llame a la oficina',
  'acc.introBefore': 'Abra la puerta desde su teléfono, y dé a las personas de su confianza su',
  'acc.introAfter':
    'código de la puerta en vez de una copia del suyo. El registro de la puerta guarda quién entró de verdad, y usted puede retirarle el acceso a cualquiera en cualquier momento sin cambiar su propio código.',

  // --- Move-out (US-707, B-164/B-173/B-174, D-85) -----------------------
  'mo.title': 'Solicitar desocupar',
  'mo.noUnits': 'No vemos una unidad activa en esta cuenta.',
  'mo.notFound': 'No encontramos esa unidad en su cuenta.',
  'mo.chooseAUnit': 'Elegir una unidad',
  'mo.whichUnit': '¿Cuál unidad?',
  'mo.unitOption': '{facility} — Unidad {unit}',
  'mo.lienRefusal':
    'La unidad {unit} está en proceso de gravamen, así que desocuparla se arregla con la oficina y no en línea. Ahí le explican lo que debe y lo que sigue.',
  'mo.lienListed': '{facility} — {refusal}',
  'mo.scheduledTitle': 'Desocupación programada',
  'mo.scheduledBodyBefore':
    'La unidad {unit} en {facility} está programada para desocuparse el',
  'mo.scheduledBodyAfter':
    'Su código de la puerta sigue funcionando y su cuenta sigue activa hasta entonces. Nuestro equipo revisará la unidad y terminará de cerrar su cuenta después de esa fecha.',
  'mo.cancelFormLabel': 'Cancelar la desocupación',
  'mo.cancelThis': 'Cancelar esta desocupación',
  'mo.chooseDifferent': '← Elegir otra unidad',
  'mo.headingForUnit': 'Solicitar desocupar — Unidad {unit}, {facility}',
  'mo.noticeOne':
    'Esta unidad requiere al menos {days} día de aviso, así que la fecha más próxima que puede elegir es el {date}.',
  'mo.noticeOther':
    'Esta unidad requiere al menos {days} días de aviso, así que la fecha más próxima que puede elegir es el {date}.',
  'mo.formLabel': 'Solicitar desocupar',
  'mo.date': 'Fecha para desocupar',
  'mo.update': 'Actualizar',
  'mo.staleDate': 'Cambió la fecha. Pulse «Actualizar» para ver cómo queda la cuenta si desocupa el {date}.',
  'mo.currentBalance': 'Saldo actual',
  'mo.creditUnusedDays': 'Crédito por los días sin usar',
  'mo.promoRecovered': 'Descuento promocional recuperado',
  'mo.recaptureFullOne':
    'Descuento promocional recuperado en su totalidad: la oferta pedía una estancia mínima de {count} mes y este contrato duró {served}.',
  'mo.recaptureFullOther':
    'Descuento promocional recuperado en su totalidad: la oferta pedía una estancia mínima de {count} meses y este contrato duró {served}.',
  'mo.recaptureProratedOne':
    'Descuento promocional recuperado por {remaining} sin cumplir de la estancia mínima de {count} mes.',
  'mo.recaptureProratedOther':
    'Descuento promocional recuperado por {remaining} sin cumplir de la estancia mínima de {count} meses.',
  'mo.monthsOne': '{count} mes',
  'mo.monthsOther': '{count} meses',
  'mo.refundExpected': 'Reembolso que debe esperar',
  'mo.willStillOwe': 'Todavía deberá',
  'mo.settledInFull': 'Liquidado por completo',
  'mo.activeUntil':
    'Su código de la puerta y su cuenta siguen activos hasta el {date}. Nuestro equipo revisará que la unidad esté vacía antes de cerrar su cuenta definitivamente.',
  'mo.requestOn': 'Solicitar desocupar el {date}',
  'mo.problem.not_found': 'No encontramos esa unidad en su cuenta.',
  'mo.problem.lien_pipeline':
    'Esta unidad está en proceso de gravamen, así que desocuparla se arregla con la oficina y no en línea. Por favor llámelos.',
  'mo.problem.date_too_soon':
    'Esa fecha es antes del aviso que requiere esta unidad. Elija una fecha posterior.',
  'mo.problem.date_too_far_out': 'Elija una fecha dentro de los próximos {days} días.',
  'mo.problem.already_requested': 'Ya hay una desocupación programada para esta unidad.',
  'mo.problem.nothing_to_cancel': 'No hay ninguna desocupación programada que cancelar.',
  'mo.problem.too_late':
    'Esa fecha de desocupación ya llegó — llámenos para cambiar cualquier cosa ahora.',
  'mo.problem.generic':
    'No se pudo completar esa solicitud. Recargue la página e inténtelo de nuevo.',

  // --- Transfer (US-709, B-090b, B-137/B-142/B-173, D-85) ---------------
  'tr.title': 'Cambiar de unidad',
  'tr.noUnits': 'No vemos una unidad activa en esta cuenta.',
  'tr.notFound': 'No encontramos esa unidad en su cuenta.',
  'tr.chooseAUnit': 'Elegir una unidad',
  'tr.whichUnit': '¿De cuál unidad se va a cambiar?',
  'tr.unitOption': '{facility} — Unidad {unit} ({type})',
  'tr.lienRefusal':
    'La unidad {unit} está en proceso de gravamen, así que el cambio se arregla con la oficina y no en línea. Ahí le explican sus opciones.',
  'tr.lienListed': '{facility} — {refusal}',
  'tr.requestedTitle': 'Cambio solicitado',
  'tr.holdingBefore': 'Le estamos apartando la',
  'tr.holdingUnit': 'Unidad {unit}',
  'tr.holdingAtFor': 'en {facility}, para un cambio el',
  'tr.holdingAtRate': 'a',
  'tr.holdingRateNote':
    '— la tarifa que le cotizamos, apartada para esta solicitud. Todavía no ha cambiado nada: sigue teniendo la Unidad {unit}, su código de la puerta sigue funcionando, y su renta no cambia hasta que el equipo complete el cambio con usted.',
  'tr.holdLastsBefore': 'El apartado dura hasta el',
  'tr.holdLastsAfter': 'Si el equipo no lo ha contactado para entonces, llame a la oficina',
  'tr.toKeepIt': 'para conservarlo.',
  'tr.theyWillCall':
    'Le llamarán para acordar una hora. Si lo necesita antes, llame a la oficina',
  'tr.cancelFormLabel': 'Cancelar la solicitud de cambio',
  'tr.cancelThis': 'Cancelar esta solicitud',
  'tr.chooseDifferent': '← Elegir otra unidad',
  'tr.headingForUnit': 'Cambiarse de la Unidad {unit} a otra unidad',
  'tr.payingNow':
    'Está pagando {rate} al mes por la Unidad {unit} ({type}) en {facility}. Pedirlo aquí aparta la unidad que elija — no mueve nada todavía. El equipo le llamará para acordar el día y completar el cambio.',
  'tr.nothingFreeBefore':
    'En este momento no hay nada más libre en {facility}. Llame a la oficina',
  'tr.nothingFreeAfter': 'y le avisan cuando se desocupe algo.',
  'tr.formLabel': 'Solicitar este cambio',
  'tr.whichWouldYouLike': '¿Cuál unidad le gustaría?',
  'tr.optionUnit': 'Unidad {unit}',
  'tr.sameAsNow': 'igual que ahora',
  'tr.moreAMonth': '{amount} más al mes',
  'tr.lessAMonth': '{amount} menos al mes',
  'tr.whenMove': '¿Cuándo le gustaría cambiarse?',
  'tr.showCost': 'Muéstrenme cuánto cuesta',
  'tr.previewFailed': 'No se pudo completar esa cotización.',
  'tr.staleUnit': 'Cambió la unidad que quiere. Pulse «Muéstrenme cuánto cuesta» para cotizar esa.',
  'tr.staleDate': 'Cambió la fecha. Pulse «Muéstrenme cuánto cuesta» para ver cuánto cuesta cambiarse el {date}.',
  'tr.newRentFor': 'Nueva renta mensual de la Unidad {unit}',
  'tr.creditForDays': 'Crédito por los días que quedan de la Unidad {unit}',
  'tr.unitForRange': 'Unidad {unit} por {range}',
  'tr.transferFee': 'Cargo por cambio',
  'tr.toPayOnDay': 'A pagar ese día',
  'tr.creditedToAccount': 'Abonado a su cuenta',
  'tr.nothingToPay': 'Nada que pagar ese día',
  'tr.willHold':
    'Le apartamos la Unidad {unit} y el equipo le llamará para acordar el cambio. Su unidad actual, su código de la puerta y su renta se quedan exactamente igual hasta que usted y el equipo hayan hecho el cambio — puede cancelar en cualquier momento antes de eso.',
  'tr.requestFrom': 'Solicitar la Unidad {unit} a partir del {date}',
  'tr.problem.not_found': 'No encontramos esa unidad en su cuenta.',
  'tr.problem.date_in_past': 'Elija hoy o una fecha posterior.',
  'tr.problem.date_too_far_out': 'Elija una fecha dentro de los próximos {days} días.',
  'tr.problem.already_requested':
    'Ya pidió cambiarse a otra unidad en esta sucursal. Cancele esa primero.',
  'tr.problem.lien_pipeline':
    'Esta unidad está en proceso de gravamen, así que el cambio se arregla con la oficina y no en línea. Por favor llámelos.',
  'tr.problem.lease_not_occupying': 'Ese contrato ya terminó — no hay nada que cambiar.',
  'tr.problem.unit_not_available':
    'Esa unidad no está disponible. Elija una sin contrato, reservación ni apartado.',
  'tr.problem.unit_different_facility':
    'Un cambio lo mueve dentro de una misma sucursal. Esa unidad está en otra sucursal.',
  'tr.problem.same_unit': 'Esa es la unidad en la que ya está.',
  'tr.problem.no_rate_for_unit_type':
    'Esa unidad no tiene tarifa publicada, así que no podemos cotizarla.',

  // --- Páginas informativas: FAQ, Acerca de, Contacto (B-262) ------------
  // Lo que un inquilino LEE, no lo que opera. `/terms` y `/privacy` no están
  // aquí a propósito: D-122 deja en inglés todo lo que escribió un abogado, y
  // el pie de página en español los nombra. `/messaging-policy` tampoco estaba,
  // por lo mismo, hasta que B-259 le dio una versión en español a los avisos
  // que esa página explica; sus claves están al final de este archivo.
  'faq.title': 'Preguntas frecuentes',
  'faq.intro':
    'Respuestas breves a lo que más nos preguntan. Si la suya no está, llámenos.',
  'faq.reserve.q': '¿Tengo que pagar para reservar una unidad?',
  'faq.reserve.a':
    'No. Las reservaciones son gratis, no piden tarjeta y no piden cuenta — solo su nombre, correo, teléfono y la fecha en que quiere entrar. El apartado vence solo si usted no se muda.',
  'faq.online.q': '¿Puedo rentar todo en línea?',
  'faq.online.a':
    'Sí. Usted elige una unidad, firma el contrato electrónicamente, paga el primer monto y recibe su código de la puerta — sin ir a una oficina.',
  'faq.term.q': '¿Hay un contrato a largo plazo?',
  'faq.term.a':
    'No. La renta es mes a mes. Usted avisa según lo que dice su contrato y se muda.',
  'faq.price.q': '¿Cuál es la diferencia entre el precio en línea y el precio en tienda?',
  'faq.price.a':
    'Algunos tamaños cuestan menos si renta en línea que si renta en el mostrador. Los dos precios se muestran antes de que usted se comprometa, así que puede ver cuál le aplica. Reservar no cambia el precio — lo que lo cambia es rentar en línea.',
  'faq.size.q': '¿Qué tamaño necesito?',
  'faq.size.intro': 'Una guía aproximada, y con gusto lo vemos con usted por teléfono:',
  'faq.size.5x5.term': '5 por 5 pies',
  'faq.size.5x5.body':
    'un clóset grande. Cajas, adornos de temporada, una bicicleta, algunos muebles pequeños.',
  'faq.size.10x10.term': '10 por 10 pies',
  'faq.size.10x10.body':
    'como medio garaje, o lo que hay en un departamento de una recámara, incluyendo un sofá y un juego de colchón.',
  'faq.size.10x20.term': '10 por 20 pies',
  'faq.size.10x20.body':
    'un garaje sencillo. Una casa de tres recámaras, o un carro y todavía sobra espacio.',
  'faq.size.tail':
    'Si está entre dos tamaños, tome el más grande. Pagar un poco más es mejor que descubrir el día de la mudanza que lo último ya no cabe.',
  'faq.hours.q': '¿Cuándo puedo llegar a mi unidad?',
  'faq.hours.a':
    'El horario de oficina y el horario de la puerta son distintos, y los dos están en la página de cada sucursal. El horario de la puerta es cuando usted puede llegar a su unidad; el horario de oficina es cuando hay personal.',
  'faq.else.q': '¿Algo más?',
  'faq.else.call': 'Llame al',

  'about.title': 'Acerca de nosotros',
  'about.intro':
    'Un operador pequeño de bodegas de autoalmacenamiento, con software propio.',
  'about.what.heading': 'Quiénes somos',
  'about.what.body':
    'Operamos unas cuantas sucursales de autoalmacenamiento y construimos el software que las opera, en vez de rentarlo por sucursal cada mes. Eso quiere decir que los precios y la disponibilidad que usted ve salen del mismo sistema que usa el mostrador — no de una exportación nocturna.',
  'about.site.heading': 'Una nota sobre este sitio',
  'about.site.body':
    'Este es un proyecto de aprendizaje construido con estándares de producción. Las sucursales, los inquilinos y los precios que se muestran son datos de demostración, y nada de esto es una oferta real de almacenamiento.',

  'contact.title': 'Contacto',
  'contact.intro': 'La forma más rápida de comunicarse con nosotros es por teléfono.',
  'contact.phone': 'Teléfono',
  'contact.email': 'Correo electrónico',
  'contact.facility.heading': 'Una sucursal en particular',
  'contact.facility.body':
    'Cada sucursal publica su propio teléfono, su horario de oficina y su horario de la puerta en su página. Esos números llegan directo a la sucursal.',

  // --- Declaración de accesibilidad (/accessibility, B-262) --------------
  // Cada frase de aquí es una afirmación pública sobre lo que el sistema hace,
  // ahora en un segundo idioma — así que el español se sostiene con la misma
  // vara que el inglés.
  'a11y.title': 'Accesibilidad',
  'a11y.intro':
    'Nuestra meta es cumplir con WCAG 2.1 nivel AA en cada página y en cada proceso. Esta página dice hasta dónde hemos llegado de verdad.',
  'a11y.target.heading': 'Cuál es nuestra meta',
  'a11y.target.body':
    'Las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.1, nivel AA. Eso abarca el manejo con teclado, el uso con lector de pantalla, el contraste de color, el cambio de tamaño del texto y el reajuste en pantallas pequeñas.',
  'a11y.true.heading': 'Qué es cierto hoy',
  'a11y.true.keyboard':
    'Todas las páginas de este sitio público funcionan solo con el teclado, y el indicador de foco cumple el contraste de 3:1 que piden las pautas.',
  'a11y.true.colour':
    'El color nunca es la única forma en que le decimos algo — un estado que se muestra con color también va escrito con palabras.',
  'a11y.true.resize':
    'El texto se puede agrandar al 200% y la página se reajusta a 320px de ancho sin desplazamiento horizontal.',
  'a11y.true.labels':
    'Los campos de los formularios tienen etiquetas de verdad, no solo texto de ejemplo.',
  'a11y.true.errors':
    'Cuando un formulario rechaza algo que usted escribió, el mensaje va unido al campo mismo, así que un lector de pantalla lo lee junto con ese campo en vez de dejarlo buscándolo — y lo que ya había escrito sigue ahí, así que corrige solo lo que le pedimos en vez de llenar el formulario otra vez. Un guardado exitoso también se anuncia.',
  'a11y.true.motion':
    'La animación respeta la preferencia de movimiento reducido de su sistema.',
  'a11y.true.maps':
    'Donde mostramos un mapa, la información va primero como texto y el mapa queda plegado detrás de un botón que usted tiene que presionar. En la página de una sucursal ese texto es la dirección y un enlace para llegar; en los resultados de búsqueda es la lista misma de sucursales, con distancias y precios. Nunca necesita el mapa, y si uno no carga se lo decimos en vez de dejar un recuadro vacío.',
  'a11y.check.heading': 'Cómo lo revisamos',
  'a11y.check.ci':
    'Las pruebas automáticas de accesibilidad corren a lo ancho de un teléfono y de una computadora en cada cambio que sube a nuestra rama principal, y en cada solicitud de cambios que está abierta a revisión. No son una traba para publicar: si una falla nos avisa, no detiene la publicación. Una revisión que la herramienta no puede decidir también reprueba la corrida, en cada página de esa corrida, para que «no revisamos eso» nunca se lea calladamente como «eso pasó».',
  'a11y.check.waivedIntro':
    'Algunas de esas revisiones sin decidir ya las vimos y resultaron ser un límite de la herramienta y no un problema real. Se dejan de lado de tres maneras distintas, y preferimos nombrar cada una en vez de redondearlas:',
  'a11y.check.waived.page':
    'Algunas se dejan de lado solo en la página donde se revisaron — una barra que se encima a la página a propósito para quedar al alcance, un fondo rayado que el revisor no puede atravesar. La misma revisión sigue teniendo que pasar en todo lo demás.',
  'a11y.check.waived.site':
    'Algunas se dejan de lado en todo el sitio, pero solo donde la prueba misma vuelve a revisar lo que confundió a la herramienta. Una celda que se salió de vista en una tabla ancha es una de ellas: se deja de lado solo donde usted tiene una barra de desplazamiento que la trae de vuelta, y algo pintado de verdad fuera del borde de la pantalla sigue reprobando.',
  'a11y.check.waived.thirdParty':
    'El contenido dentro de un marco que sirve otra empresa — el formulario de la tarjeta, el mapa — no lo revisan estas pruebas. Esa es su página, no la nuestra. Un marco que construimos nosotros se revisa como cualquier otra cosa.',
  'a11y.check.routesIntro':
    'Todavía no lo cubren todo. Estas son las páginas que quedan fuera de esa corrida, y la razón de cada una:',
  'a11y.check.routesTail':
    'Preferimos nombrar cada hueco en vez de taparlo con una afirmación general. Esta lista se genera del mismo archivo que leen las pruebas, así que una página que deja de revisarse aparece aquí en vez de desaparecer calladamente de las dos.',
  'a11y.check.statesIntro':
    'Esa lista nombra páginas. Algunas pantallas además tienen estados — un mensaje de error, un apartado que venció, un tamaño que se agotó mientras usted decidía — que solo aparecen una vez que usted hizo algo en ellas. Estos son los que sabemos que no están cubiertos, y por qué:',
  'a11y.check.statesTail':
    'Es probable que existan más estados que todavía no hemos encontrado ni nombrado — a diferencia de la lista de páginas de arriba, esta no puede decir que está completa.',
  'a11y.check.floor':
    'La prueba automática es un piso, no un techo — atrapa más o menos una tercera parte de los problemas reales, y no puede juzgar si un lector de pantalla dice algo que tenga sentido.',
  'a11y.check.noManualPass':
    'Todavía no se ha hecho ni una revisión completa con lector de pantalla ni una revisión registrada con teclado',
  'a11y.check.noManualPassTail': 'así que nada de esta página se apoya en una.',
  'a11y.short.heading': 'En qué nos quedamos cortos hoy',
  'a11y.short.intro':
    'Este sitio está en construcción activa. Estos son los problemas que conocemos, al {date}. Si alguno le impide seguir, díganos y le ayudamos a terminar lo que estaba haciendo por teléfono o por correo mientras tanto.',
  'a11y.short.js.term': 'Rentar en línea sin JavaScript.',
  'a11y.short.js.body':
    'Todo el proceso de renta funciona con JavaScript apagado, pero la cuenta regresiva del apartado de 30 minutos no: muestra el tiempo que quedaba cuando se dibujó la página y no va bajando, así que si usted está leyendo el contrato cuando se acaba, el vencimiento puede ser lo primero que sepa. Con JavaScript encendido le avisamos cinco minutos antes y puede extender el apartado con un solo toque.',
  'a11y.short.staff.term': 'Nuestras pantallas para el personal',
  'a11y.short.staff.body':
    'tienen problemas conocidos. Las listas largas de Tareas, Prospectos, Morosidad y Sesiones de soporte no están paginadas. Ningún cliente las usa, pero no vamos a describirlas como terminadas.',
  'a11y.short.maps.term': 'Los mapas que mostramos no son totalmente accesibles',
  'a11y.short.maps.body':
    'y no está en nuestras manos arreglarlos. La página de una sucursal inserta OpenStreetMap, cuyos controles de acercamiento se llaman «+» y «−» y cuyo marcador no tiene texto alternativo. Los resultados de búsqueda pueden mostrar un segundo mapa de otro proveedor, donde nosotros controlamos los marcadores de precio pero no los mosaicos ni los controles propios del proveedor que están debajo; todavía no hemos evaluado ese contra un mapa en vivo, así que nada de aquí se apoya en eso. Los dos quedan plegados detrás de un botón, y ninguno es nunca la única forma de obtener la información.',
  'a11y.short.statementTable.term': 'El estado de cuenta consolidado de una cuenta de empresa, en las pantallas de teléfono más angostas (corregido el 10 de septiembre de 2026).',
  'a11y.short.statementTable.body':
    'Del 4 al 10 de septiembre de 2026, a 320 píxeles de ancho la tabla de unidades de ese estado de cuenta era más ancha que la pantalla y solo se desplazaba de lado con el ratón o con el dedo, así que con el teclado no se llegaba a sus columnas de la derecha. Ahora la tabla recibe el foco del teclado y se desplaza con las flechas. La anotamos porque estaba en una página de dinero y no la detectamos antes de publicarla.',
  'a11y.short.reviewed': 'Última revisión: {date}.',
  'a11y.tell.heading': 'Díganos cuando nos equivoquemos',
  'a11y.tell.before': 'Si algo aquí le impide seguir, escriba a',
  'a11y.tell.orCall': 'o llame al',
  'a11y.tell.tail':
    'Díganos en qué página fue y qué pasó, y lo arreglamos y le contestamos. Una barrera de accesibilidad es un error, y la tratamos como tal.',

  // --- /messaging-policy (B-259, D-124/D-125) ---------------------------------
  // Se traduce ahora que los avisos de consentimiento tienen su propia versión
  // en español (`lib/consent/disclosures.ts`). `/terms` y `/privacy` siguen
  // solo en inglés (D-122), y esta página lo dice al enlazarlos.
  //
  // Las PALABRAS CLAVE (STOP, HELP, START…) nunca se escriben aquí: se
  // interpolan desde el código que las reconoce. No son palabras, son las
  // cadenas exactas que hay que enviar; traducirlas daría una instrucción que
  // no funciona.
  'msgpol.title': 'Política de mensajes de texto',
  'msgpol.reviewed': '{name} · Última revisión: {date}',
  'msgpol.intro':
    'Esta página explica los mensajes de texto que envía {name}, cómo acepta usted recibirlos y cómo detenerlos en cualquier momento. Aplica a todos los números de celular que tenemos.',

  'msgpol.consent.heading': 'Cómo acepta usted recibir mensajes de texto',
  'msgpol.consent.never':
    'Nunca enviamos mensajes a un número que no haya aceptado recibirlos.',
  'msgpol.consent.optInLead':
    'Envíe {join} al {number} y luego responda {yes} cuando se lo pidamos.',
  'msgpol.consent.optInBody':
    'Enviar la palabra clave no lo suscribe por sí solo: le contestamos pidiéndole que confirme, y solo su {yes} activa los mensajes. Las dos respuestas nuestras le dicen con qué frecuencia enviamos mensajes, que pueden aplicarse tarifas de mensajes y datos, y cómo detenerlos.',
  'msgpol.consent.unknownNumber':
    'Si no reconocemos el número desde el que nos escribe, se lo decimos y no suscribimos nada: llámenos y lo agregamos primero a su cuenta.',
  'msgpol.consent.selfServe':
    'También puede activar los mensajes de texto usted mismo, en la sección Notificaciones de su cuenta en línea, o pidiéndole a nuestro personal que se los active.',
  'msgpol.consent.record':
    'Cuando lo hace, registramos la fecha y la hora, de dónde vino el consentimiento, la versión exacta del texto que usted aceptó y en qué idioma se le mostró ese texto. Todo eso lo puede ver cuando quiera en su propia página de Notificaciones, incluido el hecho de que nunca se lo hemos pedido, si no se lo hemos pedido.',
  'msgpol.consent.notConditionLead': 'El consentimiento no es condición para rentar con nosotros.',
  'msgpol.consent.notConditionBody':
    'Usted puede rentar, pagar y manejar su unidad completamente sin mensajes de texto; en ese caso le escribimos por correo electrónico.',

  'msgpol.what.heading': 'Qué enviamos',
  'msgpol.what.accountTerm': 'Mensajes de su cuenta y sus pagos',
  'msgpol.what.accountBody':
    'su código de la puerta cuando se muda, un recordatorio antes de que venza la renta, un aviso si un pago falla y un mensaje si cambia su acceso a la puerta.',
  'msgpol.what.offersTerm': 'Ofertas ocasionales',
  'msgpol.what.offersBody':
    'solo si aceptó por separado recibir mensajes promocionales. Es un permiso distinto del de los mensajes de cuenta de arriba, y puede tener uno sin el otro.',
  'msgpol.what.frequencyLead': 'La frecuencia de los mensajes varía.',
  'msgpol.what.frequencyBody':
    'La mayoría de los meses recibirá entre uno y cuatro mensajes. Un mes en el que falle un pago, o en el que su cuenta se atrase, tendrá más.',

  'msgpol.stop.heading': 'Cómo detenerlos',
  'msgpol.stop.reply':
    'Responda {stop} a cualquier mensaje nuestro. También aceptamos {others}. Recibirá un mensaje confirmándolo y después nada más a ese número.',
  'msgpol.stop.stopsAll':
    'Detener los mensajes de texto los detiene todos, incluidos los de su cuenta y sus pagos, no solo las ofertas. Le seguiremos escribiendo por correo electrónico sobre su cuenta, porque esos mensajes son parte de su contrato de renta.',
  'msgpol.stop.offersOnlyLead': 'Si lo único que quiere detener son las ofertas:',
  'msgpol.stop.offersOnlyBody':
    'no responda {stop}. En vez de eso, apague los mensajes promocionales en su página de Notificaciones. Así siguen funcionando los mensajes de su cuenta y sus pagos, y puede volver a encender las ofertas ahí cuando quiera.',
  'msgpol.stop.restart':
    'Para volver a empezar, responda {start}, o vuelva a encender los mensajes desde su página de Notificaciones. Para obtener ayuda, responda {help}: recibirá nuestro número de teléfono y un enlace de regreso a esta página.',
  'msgpol.stop.portal':
    'También puede apagarlos usted mismo, sin enviar ningún mensaje, en la sección Notificaciones de su cuenta en línea. Eso tiene exactamente el mismo efecto que responder {stop}.',

  'msgpol.hours.heading': 'Cuándo los enviamos',
  'msgpol.hours.body':
    'Solo enviamos mensajes entre las 8 a. m. y las 9 p. m. en la hora local de la sucursal donde usted renta, y eso aplica a todos los mensajes, incluidos los de cuenta y pagos. Lo que caiga fuera de ese horario espera, o se envía por correo electrónico. Algunas sucursales pueden usar un horario más corto donde su estado lo exige.',

  'msgpol.cost.heading': 'Costo',
  'msgpol.cost.lead': 'Pueden aplicarse tarifas de mensajes y datos.',
  'msgpol.cost.body':
    'Nosotros no le cobramos por los mensajes de texto; su compañía de celular puede cobrarle, según su plan. Las compañías no son responsables de mensajes demorados o no entregados.',

  'msgpol.privacy.heading': 'Su información',
  'msgpol.privacy.body':
    'No vendemos su número de celular y no lo compartimos con nadie para su propia publicidad. Lo compartimos únicamente con el proveedor de mensajería que entrega los mensajes por nosotros.',
  // Dicen una cosa más que el inglés, igual que `chrome.disclaimer`: quien lee
  // en español es el único para quien es noticia que esas dos páginas no están
  // traducidas, y es el momento de decírselo — justo antes de que las abra.
  'msgpol.privacy.privacyLink': 'Nuestra política de privacidad',
  'msgpol.privacy.privacyTail':
    'explica qué más guardamos y por qué. Está únicamente en inglés.',
  'msgpol.privacy.termsLink': 'Nuestros términos',
  'msgpol.privacy.termsTail':
    'cubren su contrato de renta. Están únicamente en inglés.',
}
