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
  // Deliberately says one thing more than the English (D-122): the legal
  // pages, the contract and every notice are English-only, and the Spanish
  // reader is the only one for whom that is news. Translating a lien notice
  // is a liability, not a feature — so the honest move is to say where the
  // Spanish stops, on the page where they can still read it.
  'chrome.disclaimer':
    '{name} es un proyecto de aprendizaje. Nada en este sitio es una oferta real de almacenamiento, y las páginas legales son borradores sin revisión legal. Las páginas legales, el contrato y los avisos están únicamente en inglés.',

  // --- Language toggle ---------------------------------------------------
  'lang.label': 'Idioma',
  'lang.switchTo': 'Cambiar a {language}',

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
  'search.labelWhere': '¿Dónde necesita una bodega?',
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
  'checkout.storageUnit': 'Unidad de bodega',
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
  'act.codeDidNotWork': 'Ese código no funcionó.',
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
}
