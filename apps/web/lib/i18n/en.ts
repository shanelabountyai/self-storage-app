// B-090 part 6. The English source strings for the move-in path.
//
// Flat dot-separated keys, grouped by the surface that renders them. Flat and
// not nested because the only thing the shape has to do is let `es.ts` be
// typed as `Dictionary` — which is what makes an untranslated key a typecheck
// failure instead of a visitor reading `checkout.pay` off the page.
//
// D-15's lexicon is binding here in BOTH languages (D-122): size / unit /
// online price / in-store price / gate hours / office hours have one
// customer-facing word each, and Spanish gets the same treatment —
// tamaño / unidad / precio en línea / precio en tienda / horario de la puerta
// / horario de oficina. Admin words ("unit type", "street rate", "web rate",
// "lease", "delinquent") do not appear in either dictionary.

export const en = {
  // --- Site chrome -------------------------------------------------------
  'chrome.skipToMain': 'Skip to main content',
  'chrome.mainNav': 'Main',
  'chrome.footerNav': 'Footer',
  'chrome.findStorage': 'Find storage',
  'chrome.guides': 'Guides',
  'chrome.callUsAt': 'Call us at ',
  'chrome.payBill': 'Pay bill',
  'chrome.payBillSr': ' or sign in to my account',
  'chrome.questionsCall': 'Questions? Call',
  'chrome.orEmail': 'or email',
  'chrome.disclaimer':
    '{name} is a learning project. Nothing on this site is a real offer of storage, and the legal pages are unreviewed drafts.',

  // --- Language toggle ---------------------------------------------------
  'lang.label': 'Language',
  'lang.switchTo': 'Switch to {language}',

  // --- Homepage ----------------------------------------------------------
  'home.h1': 'Storage that you can rent today, without a phone call.',
  'home.howHeading': 'How it works',
  'home.step': 'Step',
  'home.step1.title': 'Find a facility',
  'home.step1.body': 'Search by zip or city and compare real prices and real availability.',
  'home.step2.title': 'Reserve free',
  'home.step2.body':
    'Hold a unit with no card and no account — just your name and a move-in date.',
  'home.step3.title': 'Move in online',
  'home.step3.body':
    'Sign the lease, pay, and get your gate code without visiting an office.',
  'home.helpHeading': 'Not sure what size you need?',
  'home.helpBodyBefore': 'Most people need less space than they expect. Call',
  'home.helpBodyMiddle': 'and we will talk it through, or see',
  'home.helpSizeGuideLink': 'what fits in each size',
  // --- Brand + legal-page labels ----------------------------------------
  // `SITE.tagline` and `LEGAL_PAGES[].label` are English literals in
  // `site-config.ts`. They stay there — that file is the org-level defaults
  // B-079 will replace — and the customer-facing rendering reads these keys
  // instead, keyed by the same href list so the two cannot drift.
  'site.tagline': 'Simple self-storage, rented online in minutes.',
  'nav.faq': 'FAQ',
  'nav.about': 'About',
  'nav.contact': 'Contact',
  'nav.terms': 'Terms',
  'nav.privacy': 'Privacy',
  'nav.accessibility': 'Accessibility',
  'nav.messagingPolicy': 'Text messages',

  // --- Search form + geolocation ----------------------------------------
  'search.labelWhere': 'Where do you need storage?',
  'search.labelZipOrCity': 'Zip code or city',
  'search.placeholder': 'Zip code or city',
  'search.hint': 'For example: 78704, or Austin, TX',
  'search.submit': 'Find storage',
  'location.use': 'Use my location',
  'location.finding': 'Finding you…',
  'location.findingStatus': 'Finding your location…',
  'location.unavailable':
    "This browser can't share your location. Enter a zip code or city instead.",
  'location.denied': "We couldn't get your location. Enter a zip code or city instead.",

  // --- Filter + sort labels (US-201) ------------------------------------
  'filter.size.small': 'Small (up to 5×5)',
  'filter.size.medium': 'Medium (5×10 to 10×10)',
  'filter.size.large': 'Large (10×15 and up)',
  'filter.feature.climate': 'Climate controlled',
  'filter.feature.driveUp': 'Drive-up access',
  'filter.feature.power': 'Power outlet',
  'filter.feature.groundFloor': 'Ground floor',
  'sort.price': 'Price: low to high',
  'sort.size': 'Size: small to large',
  'common.and': 'and',

  // --- Search results (US-101/US-103) -----------------------------------
  'search.title': 'Find storage',
  'search.headingNear': 'Storage near {label}',
  'search.empty': 'Enter a zip code or city above to see facilities near you.',
  'search.notFoundHeading': 'We couldn\'t find "{query}"',
  'search.notFoundBody':
    "That doesn't look like a US zip code or city we recognise, so we can't work out what is nearby. Try a 5-digit zip code, or a city and state like “Austin, TX”.",
  'search.noneListedHeading': 'We have no facilities listed yet',
  'search.noneListedBody':
    'There is nothing to show you here, which is our gap and not your search.',
  'search.noneNearbyHeading': 'Nothing within {miles} miles of {label}',
  'search.noneNearbyBody':
    'These are the closest facilities we have. They are further than most people want to drive, so check the distance before you reserve.',
  'search.callCloser': 'if you need something closer — we may have space coming up.',
  'search.resultsHeading': 'Search results',
  'search.countOne': '{count} facility within {miles} miles, nearest first',
  'search.countOther': '{count} facilities within {miles} miles, nearest first',
  'search.carryingBefore': 'Carrying your',
  'search.carryingAfter':
    'filter through — choose a location and we will apply it there.',
  'search.sizeGuideBefore': 'Not sure what size you need? Read the',
  'search.sizeGuideLink': 'size guide',
  'dead.call': 'Call {phone}',
  'dead.callSuffix': 'and we will find you a unit.',
  'card.noUnits': 'No units available right now —',
  'card.call': 'call {phone}',
  'card.from': 'from',
  'card.perMonth': '/mo',
  'card.priceSr': '{width} foot by {length} foot from {price} per month',
  'card.onlyLeftOne': 'Only {count} unit left',
  'card.onlyLeftOther': 'Only {count} units left',
  'card.sizesAvailableOne': '{count} size available',
  'card.sizesAvailableOther': '{count} sizes available',
  'map.full': 'Full',

  // --- Facility page (US-2, US-201, US-301, §6.3/§6.6) -------------------
  'facility.notFound': 'Facility not found',
  'facility.hoursUnpublished': 'Not published yet —',
  'facility.hoursUnpublishedAfter': 'to check before you drive out.',
  'facility.closed': 'Closed',
  'facility.to': ' to ',
  'facility.officeHours': 'Office hours',
  'facility.gateHours': 'Gate access hours',
  'facility.hoursHeading': 'Hours',
  'facility.hoursIntro':
    'The office is where staff are. Gate access is when your code opens the gate — usually longer.',
  'facility.sizeHint.closet': 'Holds about a large closet — boxes, a bike, seasonal things.',
  'facility.sizeHint.studio': 'Holds about a studio flat — a mattress set, boxes, small furniture.',
  'facility.sizeHint.oneBed': 'Holds about a one-bedroom apartment, including a sofa.',
  'facility.sizeHint.twoBed': 'Holds about a two- or three-bedroom house.',
  'facility.sizeHint.house': 'Holds a three-bedroom house, or a car with room to spare.',
  'facility.whatYoudPay': "What you'd pay today",
  'facility.chosenAtCheckout': 'chosen at checkout',
  'facility.totalDueToday': 'Total due today',
  'facility.thenEachMonth': 'Then each month',
  'facility.feature.climate': 'Climate controlled',
  'facility.feature.driveUp': 'Drive-up — pull your car right to the door',
  'facility.feature.power': 'Power outlet',
  'facility.feature.floor': 'Floor {floor}',
  'facility.footBy': '{width} foot by {length} foot',
  'facility.perMonthOnline': '/mo online',
  'facility.promoFromCode': 'Applied to your first invoice. Your code carries through to checkout.',
  'facility.promoAutomatic':
    'Applied to your first invoice. Nothing to enter — it is already in the total below.',
  'facility.inStoreStruck': '{price}/mo in store',
  'facility.savingOnline': '— {amount} off for renting online',
  'facility.sqFt': '{sqFt} sq ft',
  'facility.ceiling': ' · {height} ft ceiling',
  'facility.rentNow': 'Rent now',
  'facility.reserveForFree': 'Reserve for free',
  'facility.reserveFree': 'Reserve free',
  'facility.trustLine':
    'Month-to-month, no long-term commitment · Reserving is free and needs no card',
  'facility.allRented': 'All rented right now — ',
  'facility.allRentedAfter': ' about this size; units open up most weeks.',
  'facility.onlyLeftOne': 'Only {count} left',
  'facility.onlyLeftOther': 'Only {count} left',
  'facility.availableOne': '{count} available',
  'facility.availableOther': '{count} available',
  'facility.narrowThese': 'Narrow these down',
  'facility.size': 'Size',
  'facility.anySize': 'Any size',
  'facility.sortBy': 'Sort by',
  'facility.features': 'Features',
  'facility.apply': 'Apply',
  'facility.clearFilters': 'Clear filters',
  'facility.matchesOne': '{count} size matches',
  'facility.matchesOther': '{count} sizes match',
  'facility.noLiveAvailability': "We can't show live availability right now.",
  'facility.noLiveAvailabilityAfter':
    'to confirm what is open and we will hold it for you.',
  'facility.noFilterMatch': 'Nothing here matches those filters.',
  'facility.clearThem': 'Clear them',
  'facility.clearThemAfter': 'to see every size at this location.',
  'facility.noSizesPublished': "We haven't published sizes for this location yet.",
  'facility.noSizesPublishedAfter': 'and we will tell you what is here.',
  'facility.everythingRented': 'Everything here is rented right now.',
  'facility.availableSmallestOne': '{count} size available, smallest first',
  'facility.availableSmallestOther': '{count} sizes available, smallest first',
  'facility.alsoHereFull': 'Also here, currently full',
  'facility.callMainLine': 'Call our main line, {phone}',
  'facility.callPhone': 'Call {phone}',
  'facility.getDirections': 'Get directions',
  'facility.getDirectionsSr': ' to {name}, opens your map app',
  'facility.backToSearch': '← Back to storage near {query}',
  'facility.soldOutNotice':
    'Someone took the last one of that size just before you. Nothing has been charged — here is what we still have.',
  'facility.unavailableNotice':
    "That size isn't available here any more. Here is everything we do have.",
  'facility.monthToMonth': 'Month-to-month · no long-term commitment',
  'facility.availableUnits': 'Available units',
  'facility.from': 'From {price}',
  'facility.atThisFacility': 'At this facility',
  'facility.whereWeAre': 'Where we are',
  'facility.openDirections': 'Open directions in your map app',
  'facility.showMap': 'Show map',
  'facility.mapTitle': 'Map showing {name} at {address}',
  'facility.aboutThisLocation': 'About this location',
  'facility.photos': 'Photos',
  'facility.askUs': 'Not ready yet? Ask us',
  'facility.askUsBody':
    'A quote or a call back, no account needed. We will not use this to sign you up for anything.',
  'facility.whatRentersSay': 'What renters say',
  'facility.ratedOne': '{rating} out of 5, from {count} review',
  'facility.ratedOther': '{rating} out of 5, from {count} reviews',
  'facility.starsLabel': '{rating} out of 5 stars',
  'facility.questionsPeopleAsk': 'Questions people ask',
  'facility.otherLocations': 'look at other locations',
  'facility.sizeGuideOr': ', or',

  // --- Move-in cost lines (US-301, shared with checkout) -----------------
  'cost.rent': 'First month rent',
  'cost.rent.note':
    'If you move in part-way through a month, we charge only the days you use and the amount drops.',
  'cost.promo': 'Promotion',
  'cost.promo.note': 'Applied to your first month only. After that you pay the standard rate.',
  'cost.admin': 'One-time admin fee',
  'cost.admin.note': 'Charged once, when you move in.',
  'cost.tax': 'Tax',
  'cost.protection': 'Protection plan',
  'cost.protection.note':
    'You either choose a plan or show proof of your own cover — you pick at checkout, so it is not in this total yet.',

  // --- Checkout stepper (§6.4) ------------------------------------------
  'step.details': 'Your details',
  'step.unit_assign': 'Your unit',
  'step.insurance': 'Protection',
  'step.lease': 'Lease',
  'step.payment': 'Payment',
  'step.provisioned': 'Done',
  'step.announcement': '{label} — step {index} of {total}',
  'step.ofTotal': ' — step {index} of {total}',
  'step.completedGoBack': ' — step {index} of {total}, completed. Go back to this step.',
  'step.completed': ', completed',
  'step.current': ', current step',
  'step.notStarted': ', not started',
  'step.progressNav': 'Checkout progress',
  'step.goBackForm': 'Go back to a completed step',

  // --- Checkout shell (FR-4.1) ------------------------------------------
  'checkout.title': 'Move in online',
  'checkout.notFoundHeading': "We couldn't find that checkout",
  'checkout.notFoundBody':
    'The link may have expired. Nothing has been charged, and nothing is being held for you.',
  'checkout.findAUnit': 'Find a unit',
  'checkout.orCall': 'or call',
  'checkout.gateHoursUnknown': 'Gate hours: call to confirm before you head over.',
  'checkout.gateClosedToday': 'The gate is closed today.',
  'checkout.gateHoursToday': 'Gate hours today: {open}–{close}.',
  'checkout.storageUnit': 'Storage unit',
  'checkout.unitLabel': '{width} foot by {length} foot {name}',
  'checkout.lostHeading': "We couldn't keep that unit",
  'checkout.lostIntro': 'We hold a unit for 30 minutes while you move in, and that time ran out.',
  'checkout.nothingCharged': 'Nothing has been charged.',
  'checkout.lostSameSize':
    'Everything you have entered is still here — we just need to put you on another unit the same size.',
  'checkout.lostCanMove':
    'That size has gone while you were deciding. Everything you have entered is still here, and we can move it onto any of the sizes below.',
  'checkout.lostCannotMove':
    'That size has gone while you were deciding. We cannot move this checkout onto another size from here, so the quickest route is a phone call — or pick a size on the facility page and start again.',
  'checkout.findAnother': 'Find me another unit',
  'checkout.findAnotherSameSize': 'Find me another unit the same size',
  'checkout.callAndWeWillFind': 'and we will find you something — or pick one of these.',
  'checkout.moveToAnotherSize': 'Move to another size at {facility}',
  'checkout.otherSizesAt': 'Other sizes at {facility}',
  'checkout.moveMeToSize': 'Move me to the {width} foot by {length} foot {name}',
  'checkout.moveMeToThisSize': 'Move me to this size',
  'checkout.readAboutSizes': 'Read about these sizes at {facility}',
  'checkout.orWaitFor': 'Or wait for a {width} foot by {length} foot',
  'checkout.samePrice': 'the same price as the unit you had',
  'checkout.priceDiff': '{amount} {direction} a month than the unit you had',
  'checkout.more': 'more',
  'checkout.less': 'less',
  'checkout.sameArea': 'the same floor area',
  'checkout.areaDiff': '{amount} sq ft {direction}',
  'checkout.bigger': 'bigger',
  'checkout.smaller': 'smaller',
  'checkout.trade': '{area}, {money}',
  'checkout.stepProtect': 'Protect what you store',
  'checkout.stepLease': 'Your lease',
  'checkout.stepMovedIn': 'You are moved in',
  'checkout.emailedTo': 'Your unit is yours. We have emailed your lease and receipt to',
  'checkout.didntArrive': "Didn't arrive? Check your spam folder, or",
  'checkout.didntArriveAfter': 'and we will send it again.',
  'checkout.yourGateCode': 'Your gate code',
  'checkout.unitNumber': 'Unit {number}',
  'checkout.codeComing': 'Your gate code will be texted to you within 15 minutes. If it has not arrived:',
  'checkout.codeComingAfter': 'and we will read it to you — you can move in either way.',
  'checkout.nextPaymentBefore': 'Your next payment is',
  'checkout.nextPaymentOn': 'on',
  'checkout.autopayOn': 'Autopay is on — we will email you two days before every charge.',
  'checkout.autopayOff': 'Autopay is off, so you pay it yourself. We will email you when it is due.',
  'checkout.goToAccount': 'Go to my account',
  'checkout.bringALock': 'Bring your own lock, or buy one at the office.',
  'checkout.getDirections': 'Get directions',
  'checkout.facilityHours': 'Facility hours & details',
  'checkout.continue': 'Continue',
  'checkout.backTo': 'Back to {step}',
  'checkout.backNoteNothingCharged':
    'Nothing has been charged yet. Your unit stays held while you go back.',

  // --- Promo code box in checkout (US-11 AC3) ---------------------------
  'promo.haveACode': 'Have a promo code?',
  'promo.currentlyApplied':
    'Currently applied: {terms}. Only one promotion applies at a time — if the code you enter is worth less, we will keep this one.',
  'promo.formLabel': 'Add a promo code',
  'promo.field': 'Promo code',
  'promo.placeholder': 'e.g. SUMMER25',
  'promo.apply': 'Apply code',

  // --- Protection step (US-501 step 3) ----------------------------------
  'protection.formLabel': 'Protect what you store',
  'protection.required':
    'You need cover for what you store — either one of our plans, or your own home insurance.',
  'protection.optional': 'You can add cover for what you store, or use your own home insurance.',
  'protection.notInsurance': 'This is a protection plan we offer, not an insurance policy.',
  'protection.chooseLegend': 'Choose your cover',
  'protection.coversUpTo': 'Covers up to {amount} of your things.',
  'protection.ownCover': 'I have my own cover',
  'protection.ownCoverBody':
    "Your home or renter's insurance already covers stored belongings. We need the details below.",
  'protection.ownCoverLegend': 'If you are using your own cover',
  'protection.insurer': 'Insurer',
  'protection.policyNumber': 'Policy number',
  'protection.policyExpires': 'Policy runs out',
  'protection.policyExpiresHint': 'We will remind you before it runs out.',
  'protection.attest':
    'I confirm my own insurance covers my belongings while they are stored here, and I will tell you if that changes.',

  // --- Lock warning (2.2.1) ---------------------------------------------
  'lock.announcement':
    'The hold on your unit runs out soon. Nothing has been charged, and you can keep it for longer.',
  'lock.stillThere': 'Still there?',
  'lock.holdingOne': 'We are holding your unit for another {count} minute.',
  'lock.holdingOther': 'We are holding your unit for another {count} minutes.',
  'lock.underAMinute': 'The hold on your unit runs out in less than a minute.',
  'lock.reassurance': 'Nothing has been charged, and you can keep it for longer.',
  'lock.keepFormLabel': 'Keep holding my unit',
  'lock.keepAnother30': 'Keep it for another 30 minutes',

  // --- Checkout actions: what the renter is told ------------------------
  // These reach a `role="status"` / `role="alert"` region on the money path.
  // §6.7's rule holds in both languages: name the problem, the consequence and
  // the next action, and never leave "nothing has been charged" unsaid.
  'act.lockLapsed':
    'The 30 minutes we were holding your unit ran out. Nothing has been charged — see below for what we can do.',
  'act.lockLapsedUnits':
    'The 30 minutes we were holding your units ran out. Nothing has been charged — see below for what we can do.',
  'act.detailsFailed': 'We could not save those details. Reload the page and try again.',
  'act.detailsSaved': 'Details saved. Next: confirm your unit.',
  'act.checkoutNotFound': 'We could not find that checkout.',
  'act.protectionAddedNote': 'Protection plan added — {amount} a month.',
  'act.ownCoverNote': 'Your own cover recorded — no protection charge added.',
  'act.protectionChoiceFailed': 'We could not save that choice. Reload the page and try again.',
  'act.protectionAdded': 'Protection added — your monthly total went up by {amount}.',
  'act.ownCoverRecorded': 'Your own cover recorded. No protection charge added.',
  'act.leaseNotFound': 'We could not find your lease. Reload the page and it will be rebuilt.',
  'act.signatureFailed': 'We could not record your signature. Reload the page and try again.',
  'act.alreadySigned': 'This lease has already been signed.',
  'act.continueFailed': 'We could not continue. Reload the page and try again.',
  'act.leaseSigned': 'Lease signed. Next: payment.',
  'act.autopayOn': 'Automatic payments are on. We will email you before every charge.',
  'act.autopayOff': 'Automatic payments are off. We will email you when each payment is due.',
  'act.checkoutFinishedNoCode': 'This checkout is finished, so a code can no longer be added to it.',
  'act.enterACode': 'Enter a code first.',
  'act.codeDidNotWork': 'That code did not work.',
  'act.codeApplied': 'Code applied.',
  'act.stepContinueFailed': 'We could not continue from this step. Reload the page and try again.',
  'act.unitConfirmed': 'Unit confirmed. Next: protection.',
  'act.sizeJustWent':
    'That size just went. Nothing has changed in your rental — pick another size, or carry on with what you have.',
  'act.lastUnit':
    'This is the only unit in your rental, so there is nothing to take it out of. To stop renting, just close this page — nothing has been charged.',
  'act.basketFailed': 'We could not change your rental. Reload the page and try again.',
  'act.movedOnTo': 'Moved on to {step}.',
  'act.alreadyPaid':
    'Your payment has gone through and your unit is yours, so there is nothing to go back to. Reload the page to see your gate code.',
  'act.notThatFarYet': 'You have not got that far yet. Carry on from where you are.',
  'act.goBackFailed': 'We could not go back to that step. Reload the page and try again.',
  'act.holdAlreadyRanOut': 'That hold had already run out. Nothing has been charged.',
  'act.extendFailed': 'We could not extend the hold.',
  'act.heldAnother30': 'Held for another 30 minutes.',
  'act.soldOutWhileDeciding':
    'That size has sold out while you were deciding. Nothing has been charged — the phone number, the other sizes here, and the waiting list are below.',
  'act.foundAnother': 'We found you another unit the same size and kept everything you had entered.',
  'act.pastPaymentNoSizeChange':
    'You have already reached payment on this checkout, so we cannot move it to another size — the total has been quoted. Call us and we will set the new one up, or start again from the facility page.',
  'act.thatSizeGoneToo':
    'That size has just gone as well. Nothing has been charged — the phone number, the sizes still free, and the waiting list are below.',
  'act.sizeMoveFailed': 'We could not move this checkout to that size. Nothing has been charged.',
  'act.sizeMoved': "{note} We kept everything you had entered, and the price below is the new size's.",
  'act.unitAddedNote': 'Unit {number} added — {width}×{length} {name}.',
  'act.unitRemovedNote': 'Unit {number} taken out of your rental.',
  'act.unitRemovedNoNumber': 'That unit was taken out of your rental.',

  // --- Checkout announcer (4.1.3, 2.4.3) --------------------------------
  'announce.movedToSize': 'We moved you to the {size}. Nothing you entered was lost.',
  'announce.foundSameSize': 'We found you another unit the same size. Nothing you entered was lost.',
  'announce.heldAnother30': 'Your unit is held for another 30 minutes.',

  // --- Price summary (§6.4 / US-301) ------------------------------------
  'summary.heading': 'What you are paying',
  'summary.dueToday': 'Due today',
  'summary.then': 'then',
  'summary.unitsAt': '{units} at {facility}',
  'summary.nUnits': '{count} units',
  'summary.chosenAtCheckout': 'chosen at checkout',
  'summary.ownCover': 'your own cover',
  'summary.perUnitTimes': '{each} × {count} units',
  'summary.totalDueToday': 'Total due today',

  // --- Unit step (US-501 step 2, B-106) ---------------------------------
  'unit.oneAt': 'Your unit at {facility}.',
  'unit.manyAt': 'Your {count} units at {facility} — {total} in total.',
  'unit.numbered': 'Unit {number}',
  'unit.unnumbered': '{label} (unit {index})',
  'unit.remove': 'Remove {name}',
  'unit.addFormLabel': 'Add another unit',
  'unit.sizeToAdd': 'Size to add',
  'unit.sizeToAddHint': 'Renting more than one? Add it here and pay for them together.',
  'unit.addToRental': 'Add to my rental',
  'unit.holdingOne': 'Month-to-month — no long-term commitment. We are holding this unit for you while you finish.',
  'unit.holdingMany': 'Month-to-month — no long-term commitment. We are holding these units for you while you finish.',
  'unit.confirmFormLabel': 'Confirm this unit',
  'unit.moveInDate': 'Move-in date',
  'unit.moveInDateAll': 'Move-in date for all your units',
  'unit.startsToday': 'Move-ins start today at this location.',
  'unit.dateRange': 'Any day from {earliest} to {latest}. Leave it as it is to move in today.',
  'unit.confirmOne': 'This is right — continue',
  'unit.confirmMany': 'These are right — continue',

  // --- Details step (US-501 step 1, B-112) -------------------------------
  'details.formLabel': 'Your details',
  'details.firstName': 'First name',
  'details.lastName': 'Last name',
  'details.email': 'Email',
  'details.emailHint':
    'This is your account. We send your lease, receipt and gate code here — no password needed.',
  'details.phone': 'Mobile number',
  'details.address1': 'Street address',
  'details.address2': 'Flat, suite or unit (optional)',
  'details.postalCode': 'Zip code',
  'details.postalCodeHint': 'Your city and state come from this.',
  'details.cityAndState': 'City and state',
  'details.fromYourZip': 'From your zip code',
  'details.enterMyself': 'Enter my city and state myself',
  'details.city': 'City',
  'details.state': 'State',
  'details.stateHint': 'Two-letter code, for example TX.',

  // --- Lease step (US-501 step 4) ---------------------------------------
  // The AGREEMENT itself is not translated — it is a contract, rendered from
  // the templates B-023 owns, and a translated contract is a different
  // contract. What is translated here is the interface around it.
  'lease.multiIntro':
    'You are renting {count} units, so there is one agreement for each. They are the same terms — signing once at the bottom signs all {count}.',
  'lease.agreementFor': 'Agreement for {unit}',
  'lease.plainEnglishFor': 'What this means in plain English — {unit}',
  'lease.fullAgreementFor': 'The full agreement for {unit}',
  'lease.fullAgreement': 'The full agreement',
  'lease.continueFormLabel': 'Continue from your signed lease',
  'lease.signedHeading': 'Signed',
  'lease.signedOneBody':
    'You signed this agreement on {date} as {name}. Signing again is not needed and would not change it — a signed lease is fixed, which is the point of signing one.',
  'lease.signedManyBody':
    'You signed all {count} agreements on {date} as {name}. Signing again is not needed and would not change them — a signed lease is fixed, which is the point of signing one.',
  'lease.continueToPayment': 'Continue to payment',
  'lease.signOne': 'Sign the lease',
  'lease.signMany': 'Sign all {count} agreements',
  'lease.altContactLegend': 'If we cannot reach you (optional)',
  'lease.altContactName': 'Name',
  'lease.altContactPhone': 'Phone',
  'lease.activeDuty': 'I am on active duty in the US armed forces',
  'lease.activeDutyHint':
    'Self-declared. Active-duty servicemembers have protections under the Servicemembers Civil Relief Act — we cannot sell stored goods or restrict access without a court order. Telling us means we apply them.',
  'lease.signHeading': 'Sign',
  'lease.typeName': 'Type your full name to sign',
  'lease.typeNameHint':
    'Type it exactly as it appears on the lease: {name}. Typing your name here is your signature.',
  'lease.submitOne': 'Sign and continue',
  'lease.submitMany': 'Sign all {count} and continue',

  'lease.altContactBody':
    'Someone we can contact if a notice about your unit does not reach you. This does not give them access to your unit, and we will not contact them for anything else.',
  'lease.copiesOne':
    'You will get a copy by email, and you can download it any time. Nothing is charged until the next step.',
  'lease.copiesMany':
    'You will get copies by email, and you can download them any time. Nothing is charged until the next step.',

  // --- Payment step (US-501 step 5, §6.9/D-11a) -------------------------
  'pay.whatYouArePaying': 'What you are paying today',
  'pay.autopayHeading': 'Automatic payments',
  'pay.autopayCheckbox': 'Pay automatically each month',
  'pay.autopayOnBefore': 'Autopay is on. We will charge this card',
  'pay.autopayOnAfter':
    'on day {day} of each month, and email you two days before every charge. You can turn it off here now, or any time from your account.',
  'pay.autopayOffBefore': 'Autopay is off. Nothing is charged automatically —',
  'pay.autopayOffAfter':
    'is due on day {day} of each month and you pay it yourself. We will email you when each payment is due. You can turn it back on here, or any time from your account.',
  'pay.saveChoice': 'Save this choice',
  'pay.saveWarning':
    'Changing the tick does nothing until you press Save this choice. Paying below without saving keeps the setting above as it now reads.',
  'pay.cardDetails': 'Card details',
  'pay.cardsUnavailable': "We can't take card payments online just now.",
  'pay.cardsUnavailableAfter':
    'and we will take payment over the phone and finish your move-in. Your unit stays held in the meantime.',
  'pay.declined': 'That payment was declined. Try another payment method.',
  'pay.takingPaymentStatus': 'Taking payment. This can take a few seconds.',
  'pay.takingPayment': 'Taking payment…',
  'pay.payAndComplete': 'Pay and complete move-in',

  // --- Portal chrome (US-701, B-239) ------------------------------------
  'portal.yourAccountFallback': 'your account',
  'portal.signOut': 'Sign out',
  'portal.nav': 'Your account',
  'portal.pay': 'Pay {amount}',
  'portal.overview': 'Overview',
  'portal.paymentMethods': 'Payment methods',
  'portal.statements': 'Statements',
  'portal.documents': 'Documents',
  'portal.paymentPlan': 'Payment plan',
  'portal.manage': 'Manage',
  'portal.transfer': 'Move to another unit',
  'portal.access': 'Who can get in',
  'portal.protection': 'Protection',
  'portal.contact': 'Contact details',
  'portal.notifications': 'Notifications',
  'portal.refer': 'Refer a friend',
  'portal.moveOut': 'Move out',

  // --- Recurring charge parts (B-227, shared by /portal and /portal/methods)
  'charge.rent': 'rent',
  'charge.tax': 'tax',
  'charge.protection': 'your protection plan',
  'charge.and': 'and',

  // --- Portal dashboard (US-702, §6.5) ----------------------------------
  'dash.title': 'My account',
  'dash.unitHeading': '{facility} — Unit {unit}',
  'dash.noUnits': "We don't see an active unit on this account yet.",
  'dash.billedToPayer':
    'This unit is billed to {account}. Its balance is part of the account total below, where you can pay for every unit at once.',
  'dash.billedToOther':
    "This unit is billed to {account}. You can still pay it yourself — check with them first so it isn't paid twice.",
  'dash.pastDueBefore':
    "Your account is past due. Your gate code won't open the gate until the balance is paid. Pay",
  'dash.pastDueAfter': 'and your gate code starts working again, usually within a couple of minutes.',
  'dash.payNow': 'Pay {amount} now',
  'dash.orCallToPayOrSplit': 'to pay by phone, or to ask about splitting it into payments.',
  'dash.orCallToPay': 'to pay by phone.',
  'dash.orCall': 'Or call',
  'dash.settlingAfter':
    "is on its way from your bank. Bank payments take about four business days to clear. Your balance updates when it arrives, and you won't be charged a late fee while it's in transit.",
  'dash.balanceBefore': 'You have a balance of',
  'dash.transferBefore': 'You asked to move to',
  'dash.transferOn': 'on',
  'dash.transferHolding': "We're holding it until",
  'dash.manageRequest': 'Manage this request',
  'dash.planEndedStrong': 'Your payment plan has ended',
  'dash.planEndedBody':
    'because a payment was missed. The full balance above is due now, and late fees and gate access go back to normal.',
  'dash.planSeeWhatHappened': 'See the plan and what happened',
  'dash.orCallNumber': 'or call {phone}.',
  'dash.planLateStrong': 'A payment on your plan is late.',
  'dash.planLateBody': '{amount} was due on {date}. Your plan carries on if you pay it by',
  'dash.planMissedStrong': 'A payment on your plan was missed.',
  'dash.planMissedBody': '{amount} was due on {date}.',
  'dash.planKeepIt': 'to keep the plan, or call {phone}.',
  'dash.onAPlan': "You're on a payment plan.",
  'dash.planNextBefore': 'Your next payment is',
  'dash.planNextOn': 'on',
  'dash.planNoneLeft': 'There are no payments left to make on it.',
  'dash.planSeeSchedule': 'See the full schedule',
  'dash.moveOutBefore': 'You asked to move out on',
  'dash.currentBalance': 'Current balance',
  'dash.inCredit': '{amount} in credit',
  'dash.nextPayment': 'Next payment',
  'dash.nextPaymentOn': '{amount} on {date}',
  'dash.autopay': 'Autopay',
  'dash.on': 'On',
  'dash.off': 'Off',
  'dash.change': 'Change',
  'dash.autopayNeedsCard': 'No card on file — nothing will be charged automatically.',
  'dash.gateCode': 'Gate code',
  'dash.accessSuspended': 'Access is suspended until the balance is paid. Call',
  'dash.withQuestions': 'with questions.',
  'dash.gateCodeHiddenImpersonation':
    'The gate code is hidden during a support session. The tenant sees it here.',
  'dash.gateCodeNotReady': "Your gate code isn't ready yet. Call",
  'dash.gateCodeNotReadyAfter': "and we'll get you in.",

  // --- Business account card on the dashboard (B-256, B-258) ------------
  'acct.summaryOne': '{facility} · {count} unit · {rate}',
  'acct.summaryOther': '{facility} · {count} units · {rate}',
  'acct.owesOne': 'This account owes {amount} across its unit.',
  'acct.owesOther': 'This account owes {amount} across its units.',
  'acct.nothingOwed': 'Nothing is owed on this account right now.',
  'acct.memberNote':
    'You can see this account. {payer} is the payer and settles it, so there is nothing here for you to pay. To pay it another way, call',
  'acct.payNow': 'Pay {amount} now',
  'acct.allocationNote':
    'One payment covers the whole account. It goes to the oldest amounts owed first, across every unit below, rather than to one unit in particular.',
  'acct.tableCaption': 'Units billed to {account}',
  'acct.colUnit': 'Unit',
  'acct.colRentedBy': 'Rented by',
  'acct.colBalance': 'Balance',
  'acct.autopayNote':
    "Autopay is set up per unit and charges the card that unit's own renter has on file. Paying through this account does not change that.",
  'acct.statementsLink': 'Statements for this account',
  'dash.unitNumber': 'Unit {unit}',

  // --- Pay screen (US-703) ----------------------------------------------
  'paypg.title': 'Pay your balance',
  'paypg.notFoundAccount': "We couldn't find that account on your account.",
  'paypg.notFoundUnit': "We couldn't find that unit on your account.",
  'paypg.backToAccount': 'Back to my account',
  'paypg.allPaidAccount': "You're all paid up on {name} — there's nothing to pay right now.",
  'paypg.allPaidUnit': "You're all paid up on unit {unit} — there's nothing to pay right now.",
  'paypg.subheadAccount': '{facility} — {account}',
  'paypg.subheadUnit': '{facility} — Unit {unit}',
  'paypg.captionAccount': 'What {account} owes',
  'paypg.captionUnit': 'What you owe on unit {unit}',
  'paypg.colUnit': 'Unit',
  'paypg.colWhat': 'What',
  'paypg.colRentedBy': 'Rented by',
  'paypg.colWhen': 'When',
  'paypg.colAmount': 'Amount',
  'paypg.queryThis': 'Query this — {phone}',
  'paypg.lateFeeAssessed': 'Late fee, assessed {on}',
  'paypg.balance': 'Balance',
  'paypg.payingToday': 'Paying today',
  'paypg.gateOff': 'Your gate code is switched off.',
  'paypg.gateOnBefore': 'Paying',
  'paypg.gateOnAfter': 'turns it back on, usually within a couple of minutes.',
  'paypg.gateShortBefore': 'turns it back on — paying',
  'paypg.gateShortAfter': 'leaves it switched off.',
  'paypg.balanceRestored': "We've put your full balance back in for now.",
  'paypg.payDifferent': 'Pay a different amount',
  'paypg.cardDetails': 'Card details',
  'paypg.callInstead': "We can't take card payments online just now. Call",
  'paypg.callInsteadAfter': 'and we will take your payment over the phone.',
  'amt.notANumber': 'Enter an amount like 75 or 75.50.',
  'amt.belowMinimum': 'The smallest payment we can take online is {min}.',
  'amt.aboveBalance': 'That is more than you owe. Enter your balance or less.',
  'amt.abovePrepayCeiling':
    'That is much more than a year of rent. Call the office and we will take it over the phone.',
  'amt.nothingOwed': 'There is nothing to pay right now.',

  // --- Gate code panel + pay amount form --------------------------------
  'gate.show': 'Show gate code',
  'gate.hide': 'Hide gate code',
  'gate.copy': 'Copy',
  'gate.copied': 'Copied',
  'amtform.label': 'Amount in dollars',
  'amtform.reopens': '{amount} reopens your gate, usually within a couple of minutes.',
  'amtform.willNotReopen': '{amount} will not reopen your gate. {needed} will.',
  'amtform.update': 'Update amount',

  // --- Portal payment element, share invite, unlock ---------------------
  'ppay.payAmount': 'Pay {amount}',
  'invite.share': 'Share invite {code}',
  'invite.copied': 'Copied — paste it into a message to your friend.',
  'invite.copyFailed': 'Copy the code above and send it however you like.',
  'unlock.opening': 'Opening the gate…',

  // --- Payment methods (§4.6, B-227) ------------------------------------
  'meth.title': 'Payment methods',
  'meth.cardsOnFile': 'Cards on file',
  'meth.cannotShowCards': "We can't show your saved cards just now. Call",
  'meth.cannotShowCardsAfter': 'and we can help.',
  'meth.noCardSaved': "You don't have a card saved yet.",
  'meth.cardEnding': '{brand} ending {last4}',
  'meth.isDefault': '· charged for automatic payments',
  'meth.expires': 'Expires {month}/{year}',
  'meth.useCardLabel': 'Use the card ending {last4} for automatic payments',
  'meth.useThisCard': 'Use this card',
  'meth.removeCardLabel': 'Remove the card ending {last4}',
  'meth.remove': 'Remove',
  'meth.addACard': 'To add a card, pay a balance with it and choose to keep it on file, or call',
  'meth.autopayHeading': 'Automatic payments',
  'meth.noActiveUnit': "We don't see an active unit on this account.",
  'meth.unitHeading': '{facility} — Unit {unit}',
  'meth.autopayOnBefore': 'We charge',
  'meth.autopayOnAfter':
    '({parts}) on day {day} of each month — next on {next}. We email you two days before every charge.',
  'meth.autopayOff':
    'Off. {amount} ({parts}) is due on day {day} of each month and you pay it yourself.',
  'meth.noCardWarning':
    "There's no card on file for this to charge, so nothing will be taken automatically. Add a card, or turn this off so you get a reminder instead.",
  'meth.autopayFormLabel': 'Automatic payments for unit {unit}',
  'meth.turnOff': 'Turn off automatic payments',
  'meth.turnOn': 'Turn on automatic payments',

  // --- Payment receipt (/portal/pay/done) -------------------------------
  'rcpt.title': 'Payment receipt',
  'rcpt.notFound': "We couldn't find that payment on your account.",
  'rcpt.received': 'Payment received',
  'rcpt.failed': "That payment didn't go through",
  'rcpt.processing': 'Bank payment on its way',
  'rcpt.sent': 'Payment sent',
  'rcpt.pendingBody':
    "Your bank has taken it. We're still confirming it on our side — your balance updates within a minute or two, and there's nothing else for you to do.",
  'rcpt.processingBody':
    "Your bank payment has been submitted. Bank payments take about four business days to clear — your balance updates when it arrives, and you won't be charged a late fee while it's on its way. There's nothing else for you to do.",
  'rcpt.cardDeclined': 'The card was declined.',
  'rcpt.failedAfter': 'Nothing has been charged. You can try another card, or call',
  'rcpt.amount': 'Amount',
  'rcpt.unit': 'Unit',
  'rcpt.unitValue': '{facility} — {unit}',
  'rcpt.date': 'Date',
  'rcpt.balanceNow': 'Balance now',

  // --- Statements list --------------------------------------------------
  'stmt.title': 'Statements',
  'stmt.settled': 'Settled',
  'stmt.none':
    "You don't have any statements yet. Your first one appears at the end of your first full month.",
  'stmt.intro':
    'A month-by-month record for each unit: what you owed at the start, everything charged and paid, and what was left at the end.',
  'stmt.receiptsLink': 'Individual receipts and your agreement',
  'stmt.allUnits': '· all units',
  'stmt.owedAtEnd': '{amount} owed at month end',
  'stmt.creditAtEnd': '{amount} in credit at month end',

  // --- Statement document (shared with the admin ledger) ----------------
  'sv.openingBalance': 'Balance at the start of {label}',
  'sv.charged': 'Charged this month',
  'sv.paid': 'Paid this month',
  'sv.credits': 'Credits',
  'sv.refunded': 'Refunded to you',
  'sv.writtenOff': 'Written off',
  'sv.closingBalance': 'Balance at the end of {label}',
  'sv.everythingHeading': 'Everything in this month',
  'sv.nothingHappened': 'Nothing was charged or paid on this unit in {label}.',
  'sv.regionLabel': 'Statement',
  'sv.caption': 'Charges and payments for unit {unit} in {label}',
  'sv.colDate': 'Date',
  'sv.colWhat': 'What it was',
  'sv.colType': 'Type',
  'sv.colAmount': 'Amount',
  'sv.type.charge': 'Charge',
  'sv.type.payment': 'Payment',
  'sv.type.credit': 'Credit',
  'sv.type.refund': 'Refund',
  'sv.type.adjustment': 'Adjustment',
  'sv.type.write_off': 'Written off',
  'sv.title': 'Statement',
  'sv.pageTitle': 'Statement — {label}',
  'sv.allStatements': '← All statements',
  'sv.unitFacility': 'Unit {unit} · {facility}',
  'sv.printNote':
    "Dates are shown in {facility}'s local time. Use your browser's print option to save or print this statement.",
  'doc.title': 'Document',
  'doc.notFound': "We couldn't find that document on your account.",
  'doc.backToDocuments': 'Back to documents',

  // --- Documents and receipts (US-704, B-146, B-179) --------------------
  'docs.title': 'Documents and receipts',
  'docs.yourDocuments': 'Your documents',
  'docs.none':
    "You don't have any documents on file yet. Your signed agreement appears here once you've moved in.",
  'docs.unitSuffix': ' · Unit {unit}',
  'docs.download': 'Download',
  'docs.view': 'View',
  'docs.payments': 'Payments',
  'docs.noPayments': 'No payments yet.',
  'docs.paymentsCaption': 'Payments on your account, most recent first',
  'docs.colDate': 'Date',
  'docs.colUnit': 'Unit',
  'docs.colAmount': 'Amount',
  'docs.returned': 'Returned unpaid by the bank, so this amount is owed again',
  'docs.returnedFee': ', along with a {fee} returned-payment fee',
  'docs.payReturnedLabel': 'Pay {amount} now on unit {unit}',
  'docs.payReturnedLabelNoUnit': 'Pay {amount} now',
  'docs.payReturned': 'Pay {amount} now',
  'docs.or': 'or',
  'docs.aboutThis': 'about this.',
  'docs.returnedShort': 'returned',
  'docs.needReceipt': 'Need a receipt for one of these, or a statement for your accounts? Call',
  'docs.needReceiptAfter': "and we'll send it over.",

  // --- Account statement (B-256) ----------------------------------------
  'astmt.noChange': 'No change',
  'astmt.added': '{amount} added',
  'astmt.cleared': '{amount} cleared',
  'astmt.heading': '{account} — {label}',
  'astmt.unitsOne': '{count} unit · {facility}',
  'astmt.unitsOther': '{count} units · {facility}',
  'astmt.caption': 'Every unit billed to {account} in {label}',
  'astmt.colUnit': 'Unit',
  'astmt.colOwedStart': 'Owed at start',
  'astmt.colChange': 'Change',
  'astmt.colOwedEnd': 'Owed at end',
  'astmt.allUnits': 'All units',
  'astmt.note':
    "This is a summary. Each unit's own statement lists every charge and payment on it — follow the unit number to see one. Dates are shown in {facility}'s local time. Use your browser's print option to save or print this page.",

  // --- Payment plan (B-090c, B-193, D-98) -------------------------------
  'plan.title': 'Payment plan',
  'plan.intro':
    "What was agreed and what's left. Your plan covers the amount that was already overdue when it was set up — your regular rent is still due on its own date each month, on top of the payments below. This page updates itself as your payments come in. Plans you have finished with stay here so you can see what you paid.",
  'plan.none': "You're not on a payment plan right now.",
  'plan.status.active': 'Active — keep to the dates below and collections stay paused.',
  'plan.status.completed': 'Completed — this plan is paid off. Thank you for keeping to it.',
  'plan.status.broken':
    'Ended because a payment was missed. The whole balance on this unit is due now, and late fees and gate access have gone back to normal.',
  'plan.status.cancelled':
    'Cancelled, so it is no longer running. The balance on this unit is due under your normal terms.',
  'plan.heading': '{facility} — Unit {unit} · agreed {agreed}',
  'plan.paidOf': '{paid} paid of {total}.',
  'plan.autoCollect':
    "We'll charge your card on file for each payment on the date it's due — you don't need to do anything.",
  'plan.selfPay':
    "You'll need to make each payment yourself by the date it's due. We won't charge your card automatically for these.",
  'plan.caption': 'Installment schedule for unit {unit}, agreed {agreed}',
  'plan.colDue': 'Due',
  'plan.colAmount': 'Amount',
  'plan.colLeftAfter': 'Left after',
  'plan.colStatus': 'Status',
  'plan.missed': 'Missed',
  'plan.lateBy': 'Late — pay by {date}',
  'plan.status.paid': 'paid',
  'plan.status.due': 'due',
  'plan.status.upcoming': 'upcoming',
  'plan.payDue': 'Pay {amount} due {date}',
  'plan.payWholeInstead': 'Pay my whole balance on this unit instead',
  'plan.payBalance': 'Pay my balance on this unit',

  // --- Protection and insurance (D-17) ----------------------------------
  'prot.title': 'Protection and insurance',
  'prot.intro':
    "Every unit needs either one of our protection plans or your own insurance. Changes take effect at the start of your next billing month — this month's charge never changes, and neither does the cover you have until then.",
  'prot.noUnits': "You don't have any units right now.",
  'prot.unitFacility': ' · {facility}',
  'prot.youHaveBefore': 'You have',
  'prot.youHaveAfter': 'at {amount}/month.',
  'prot.ownInsurance': 'You are covered by your own insurance on this unit.',
  'prot.expired':
    'The policy we have on file ran out on {date}. Until you give us current cover, we have to add one of our protection plans to this unit and charge for it. Send us your new policy below and that stops.',
  'prot.pendingChange': 'Changing to {plan} ({amount}/month) on {date}.',
  'prot.pendingStop':
    'Your protection plan stops on {date} — you will be covered by your own insurance from then.',
  'prot.callOffLabel': 'Call off this change',
  'prot.callOff': 'Call this off',
  'prot.changeFormLabel': 'Change cover for unit {unit}',
  'prot.levelOfCover': 'Level of cover',
  'prot.choose': 'Choose…',
  'prot.planOption': '{name} — {coverage} of cover, {premium}/month',
  'prot.iHaveOwn': 'I have my own insurance',
  'prot.changeCover': 'Change cover',
  'prot.tellUsSummary': 'Tell us about your own insurance',
  'prot.tellUsBody':
    'We need your insurer, your policy number and the date the policy runs out. Attach the declaration page too if you have it handy — a photo is fine.',
  'prot.proofFormLabel': 'Your own insurance for unit {unit}',
  'prot.insurer': 'Insurer',
  'prot.policyNumber': 'Policy number',
  'prot.runsOutOn': 'Runs out on',
  'prot.declarationPage': 'Declaration page (optional)',
  'prot.declarationHint':
    'A PDF or a photo of the page, up to 10 MB. You can send the details without it and bring the document in later.',
  'prot.sendDetails': 'Send these details',

  // --- Contact details (US-706) -----------------------------------------
  'cont.title': 'Contact details',
  'cont.phoneSection': 'Phone and alternate contact',
  'cont.phone': 'Phone',
  'cont.altName': 'Alternate contact name',
  'cont.altPhone': 'Alternate contact phone',
  'cont.altEmail': 'Alternate contact email',
  'cont.saveDetails': 'Save details',
  'cont.addressSection': 'Mailing address',
  'cont.addressIntro':
    "This is where we post anything that has to reach you on paper, so it's worth keeping current.",
  'cont.address1': 'Street address',
  'cont.address2': 'Apartment or unit (optional)',
  'cont.city': 'City',
  'cont.state': 'State',
  'cont.postalCode': 'ZIP code',
  'cont.saveAddress': 'Save address',
  'cont.previousAddresses': 'Previous addresses',
  'cont.until': 'until {date}',
  'cont.emailSection': 'Email address',
  'cont.emailIsBefore': 'Your email is',
  'cont.emailIsAfter': "It's also how you sign in.",
  'cont.emailChangeIntro':
    "To change it, we send a link to the new address to make sure it reaches you — and let your current address know, in case it wasn't you asking.",
  'cont.changeEmailFormLabel': 'Change email address',
  'cont.newEmail': 'New email address',
  'cont.sendConfirmation': 'Send confirmation link',

  // --- Notification preferences (CN-13, D-51) ---------------------------
  'notif.title': 'Notification preferences',
  'notif.gridHeading': 'What we send, and how',
  'notif.regionLabel': 'Notification preferences',
  'notif.colCategory': 'Category',
  'notif.colEmail': 'Email',
  'notif.colText': 'Text',
  'notif.byEmail': '{category} by email',
  'notif.byText': '{category} by text',
  'notif.savePreferences': 'Save preferences',
  'notif.mandatoryNote':
    'Payment reminders, receipts and account notices only — not everything we send. Delinquency notices, lien-related mail and rate-increase notices always go by email; that is a legal requirement, not a setting, and there is no control for it here.',
  'notif.cat.payment_reminders': 'Payment reminders',
  'notif.cat.payment_reminders.desc': 'Rent due soon, due today, a card that needs updating.',
  'notif.cat.receipts': 'Receipts',
  'notif.cat.receipts.desc': 'A copy of what was charged, each time.',
  'notif.cat.operational_notices': 'Operational notices',
  'notif.cat.operational_notices.desc': 'Gate access, unit locks, insurance proof.',
  'notif.smsHeading': 'Text message consent',
  'notif.smsIntroBefore': 'What we send, when we send it and how to stop it is set out in our',
  'notif.smsPolicyLink': 'text message policy',
  'notif.status': 'Status',
  'notif.granted': 'Granted — texts are on',
  'notif.revoked': 'Revoked — texts are off',
  'notif.asOf': 'As of',
  'notif.recordedFrom': 'Recorded from',
  'notif.disclosureVersion': 'Disclosure version',
  'notif.neverAskedSms': 'We have never asked you about text messages, so none are sent.',
  'notif.turnOffTexts': 'Turn off text messages',
  'notif.stopNote':
    'This has the same effect as replying STOP to a text from us: every SMS to this number stops, including account and payment texts, immediately.',
  'notif.marketingHeading': 'Marketing text messages',
  'notif.marketingIntro':
    'Separate from the account texts above. Turning these off never affects payment reminders or gate codes, and turning them on is not required to rent.',
  'notif.marketingGranted': 'Granted — marketing texts are on',
  'notif.marketingRevoked': 'Revoked — marketing texts are off',
  'notif.neverAskedMarketing': 'We have never asked you about marketing texts, so none are sent.',
  'notif.turnOffMarketing': 'Turn off marketing texts',
  'notif.turnOnMarketing': 'Turn on marketing texts',

  // --- Refer a friend (PRD 10 §5.1/§5.6) --------------------------------
  'refer.title': 'Refer a friend',
  'refer.offer':
    'When a friend rents at {facility} on your invite and their first payment clears, they get {friendReward} off their first invoice and you get {yourReward} off your next one.',
  'refer.notRunning': 'The referral program is not running at {facility} at the moment.',
  'refer.noLease':
    'Referrals are for current tenants, and there is no active lease on your account right now.',
  'refer.yourInvites': 'Your invites',
  'refer.noInvites': 'You have no unused invites. Make one and share it with a friend.',
  'refer.goodUntil': 'Good until {date}. One friend each.',
  'refer.shareMessage': 'Storage at {facility} — use my invite and we both get a credit: {link}',
  'refer.makeInvite': 'Make a new invite',
  'refer.yourReferrals': 'Your referrals',
  'refer.noReferrals': 'Nothing yet. When a friend uses one of your invites, it will show up here.',
  'refer.regionLabel': 'Your referrals',
  'refer.caption':
    'Every friend you have referred, what state their referral is in, and when the credit lands',
  'refer.colFriend': 'Friend',
  'refer.colState': 'State',
  'refer.colCredit': 'Credit',
  'refer.notUsedYet': 'Not used yet',
  'refer.onInvoiceDated': 'on your {date} invoice',
  'refer.onNextInvoice': 'on your next invoice',
  'refer.state.shared': 'Invite shared — not used yet',
  'refer.state.pending': 'Moved in — waiting for their first payment to clear',
  'refer.state.earned': 'Credit earned',
  'refer.state.refused': 'No credit',
  'refer.state.expired': 'Invite expired unused',
  'refer.state.clawed_back': 'Credit reversed',
  'refer.terms': 'The terms',
  'refer.term1': 'Each invite works once, for one friend.',
  'refer.term2':
    'Your friend has to be new to us — someone who has rented here before does not qualify.',
  'refer.term3Before': 'The credit is earned when they move in',
  'refer.term3And': 'and',
  'refer.term3After': 'their first payment clears, not when they reserve.',
  'refer.term4':
    'Yours comes off your next invoice, which may be up to a month away. Theirs comes off their first.',
  'refer.term5':
    'Neither credit is cash and neither is refundable. If you move out with an unused credit, it does not carry over.',
  'refer.term6': 'An unused invite expires after {days} days.',
  'refer.term7': 'You can hold {cap} unused invites at a time.',

  // --- Who can get in (US-9, US-8) --------------------------------------
  'acc.title': 'Who can get in',
  'acc.own': 'own',
  'acc.unlockHeading': 'Open the gate from your phone',
  'acc.keypadStillWorks':
    'Your gate code still works at the keypad and always will. Phone unlock needs a signal, so keep the code where you can find it.',
  'acc.impersonatedNoUnlock':
    'The gate cannot be opened during a support session. The tenant can do it from this page themselves.',
  'acc.suspendedHere':
    'Your access here is switched off while the balance is unpaid, so the gate will not open — from your phone or at the keypad.',
  'acc.openGateAt': 'Open the gate at {facility}',
  'acc.openGate': 'Open the gate',
  'acc.turnOffAt': 'Turn off phone unlock at {facility}',
  'acc.turnOffLostPhone': 'Turn off phone unlock — I lost this phone',
  'acc.notSwitchedOn':
    'Not switched on. Turning it on gives this account its own key, separate from your gate code — losing your phone means switching this off, not changing your code.',
  'acc.turnOnAt': 'Turn on phone unlock at {facility}',
  'acc.turnOn': 'Turn on phone unlock',
  'acc.troubleAtGate': 'Trouble at the gate? Call',
  'acc.whoElse': 'Who else can get in',
  'acc.noUnits': "You don't have any units right now.",
  'acc.unitFacility': ' · {facility}',
  'acc.unitSuspended':
    'Access to this unit is switched off while the balance is unpaid. Anyone you add now will not be able to get in until it is cleared — and neither can the people already on this list.',
  'acc.nobodyElse': 'Nobody else can get into this unit at the moment.',
  'acc.untilDay': ' · until {date}',
  'acc.theirCode': 'Their code:',
  'acc.codesHiddenSupport': 'Codes are hidden during a support session.',
  'acc.callForCode': 'Call the office for their code.',
  'acc.codeSwitchedOff': 'Their code is switched off.',
  'acc.addedAtOffice': 'Added at the office.',
  'acc.withdrawFor': 'Withdraw access for {name}',
  'acc.withdraw': 'Withdraw access',
  'acc.atCap':
    'You have the most people this facility allows ({cap}). Withdraw somebody to add another, or call the office.',
  'acc.addSomeone': 'Add someone',
  'acc.addSomeoneBody':
    'They will get their own code, which we will show you once you add them. You can have up to {cap} people on this unit.',
  'acc.addFormLabel': 'Add someone to unit {unit}',
  'acc.fullName': 'Full name',
  'acc.phone': 'Phone',
  'acc.relationship': 'Who they are to you',
  'acc.relationshipHint': 'For example: spouse, employee, brother.',
  'acc.whenTheyCanGetIn': 'When they can get in',
  'acc.lastDay': 'Last day (optional)',
  'acc.lastDayHint': 'Leave blank and their code works until you withdraw it.',
  'acc.addThem': 'Add them',
  'acc.hours.anytime': 'Any time the gate is open',
  'acc.hours.weekdays': 'Weekdays only',
  'acc.hours.weekends': 'Weekends only',
  'acc.hours.custom': 'Limited hours — call the office',
  'acc.introBefore': 'Open the gate from your phone, and give the people you trust their',
  'acc.introAfter':
    'gate code rather than a copy of yours. The gate log records who actually came in, and you can withdraw any one of them at any time without changing your own code.',

  // --- Move-out (US-707, B-164/B-173/B-174, D-85) -----------------------
  'mo.title': 'Request a move-out',
  'mo.noUnits': "We don't see an active unit on this account.",
  'mo.notFound': "We couldn't find that unit on your account.",
  'mo.chooseAUnit': 'Choose a unit',
  'mo.whichUnit': 'Which unit?',
  'mo.unitOption': '{facility} — Unit {unit}',
  'mo.lienRefusal':
    "Unit {unit} is in the lien process, so a move-out has to be arranged with the office rather than online. They'll go through what you owe and what happens next with you.",
  'mo.lienListed': '{facility} — {refusal}',
  'mo.scheduledTitle': 'Move-out scheduled',
  'mo.scheduledBodyBefore': 'Unit {unit} at {facility} is scheduled to move out on',
  'mo.scheduledBodyAfter':
    'Your gate code keeps working and your account stays active until then. Our team will verify the unit and finish closing your account after that date.',
  'mo.cancelFormLabel': 'Cancel move-out',
  'mo.cancelThis': 'Cancel this move-out',
  'mo.chooseDifferent': '← Choose a different unit',
  'mo.headingForUnit': 'Request a move-out — Unit {unit}, {facility}',
  'mo.noticeOne': 'This unit needs at least {days} day notice, so the earliest date you can pick is {date}.',
  'mo.noticeOther': 'This unit needs at least {days} days notice, so the earliest date you can pick is {date}.',
  'mo.formLabel': 'Request a move-out',
  'mo.date': 'Move-out date',
  'mo.update': 'Update',
  'mo.currentBalance': 'Current balance',
  'mo.creditUnusedDays': 'Credit for unused days',
  'mo.promoRecovered': 'Promotional discount recovered',
  'mo.refundExpected': 'Refund you should expect',
  'mo.willStillOwe': 'You will still owe',
  'mo.settledInFull': 'Settled in full',
  'mo.activeUntil':
    'Your gate code and account stay active until {date}. Our team will verify the unit is empty before your account is finally closed.',
  'mo.requestOn': 'Request a move-out on {date}',
  'mo.problem.not_found': "We couldn't find that unit on your account.",
  'mo.problem.lien_pipeline':
    'This unit is in the lien process, so a move-out has to be arranged with the office rather than online. Please call them.',
  'mo.problem.date_too_soon': 'That date is before the notice this unit requires. Pick a later date.',
  'mo.problem.date_too_far_out': 'Pick a date within the next {days} days.',
  'mo.problem.already_requested': 'A move-out is already scheduled for this unit.',
  'mo.problem.nothing_to_cancel': "There's no move-out scheduled to cancel.",
  'mo.problem.too_late': 'That move-out date has already arrived — call us to change anything now.',
  'mo.problem.generic': 'That request could not be completed. Reload the page and try again.',

  // --- Transfer (US-709, B-090b, B-137/B-142/B-173, D-85) ---------------
  'tr.title': 'Move to another unit',
  'tr.noUnits': "We don't see an active unit on this account.",
  'tr.notFound': "We couldn't find that unit on your account.",
  'tr.chooseAUnit': 'Choose a unit',
  'tr.whichUnit': 'Which unit are you moving out of?',
  'tr.unitOption': '{facility} — Unit {unit} ({type})',
  'tr.lienRefusal':
    "Unit {unit} is in the lien process, so a move has to be arranged with the office rather than online. They'll go through your options with you.",
  'tr.lienListed': '{facility} — {refusal}',
  'tr.requestedTitle': 'Transfer requested',
  'tr.holdingBefore': "We're holding",
  'tr.holdingUnit': 'Unit {unit}',
  'tr.holdingAtFor': 'at {facility} for you, for a move on',
  'tr.holdingAtRate': 'at',
  'tr.holdingRateNote':
    '— the rate we quoted you, held for this request. Nothing has changed yet — you still have Unit {unit}, your gate code still works, and your rent is unchanged until the team completes the move with you.',
  'tr.holdLastsBefore': 'The hold lasts until',
  'tr.holdLastsAfter': "If the team hasn't reached you by then, call the office",
  'tr.toKeepIt': 'to keep it.',
  'tr.theyWillCall': "They'll call to arrange a time. If you need it sooner, call the office",
  'tr.cancelFormLabel': 'Cancel transfer request',
  'tr.cancelThis': 'Cancel this request',
  'tr.chooseDifferent': '← Choose a different unit',
  'tr.headingForUnit': 'Move out of Unit {unit} into another unit',
  'tr.payingNow':
    "You're paying {rate} a month for Unit {unit} ({type}) at {facility}. Asking here holds the unit you pick — it doesn't move anything. The team will call you to arrange the day and finish the swap.",
  'tr.nothingFreeBefore': "There's nothing else free at {facility} right now. Call the office",
  'tr.nothingFreeAfter': "and they'll let you know when something opens up.",
  'tr.formLabel': 'Request this transfer',
  'tr.whichWouldYouLike': 'Which unit would you like?',
  'tr.optionUnit': 'Unit {unit}',
  'tr.sameAsNow': 'same as now',
  'tr.moreAMonth': '{amount} more a month',
  'tr.lessAMonth': '{amount} less a month',
  'tr.whenMove': 'When would you like to move?',
  'tr.showCost': 'Show me what it costs',
  'tr.previewFailed': 'That preview could not be completed.',
  'tr.newRentFor': 'New monthly rent for Unit {unit}',
  'tr.creditForDays': 'Credit for the days left on Unit {unit}',
  'tr.unitForRange': 'Unit {unit} for {range}',
  'tr.transferFee': 'Transfer fee',
  'tr.toPayOnDay': 'To pay on the day',
  'tr.creditedToAccount': 'Credited to your account',
  'tr.nothingToPay': 'Nothing to pay on the day',
  'tr.willHold':
    "We'll hold Unit {unit} for you and the team will call to arrange the move. Your current unit, gate code and rent stay exactly as they are until you and the team have actually done the swap — you can cancel any time before that.",
  'tr.requestFrom': 'Request Unit {unit} from {date}',
  'tr.problem.not_found': "We couldn't find that unit on your account.",
  'tr.problem.date_in_past': 'Pick today or a later date.',
  'tr.problem.date_too_far_out': 'Pick a date within the next {days} days.',
  'tr.problem.already_requested':
    "You've already asked to move to another unit at this site. Cancel that first.",
  'tr.problem.lien_pipeline':
    'This unit is in the lien process, so a move has to be arranged with the office rather than online. Please call them.',
  'tr.problem.lease_not_occupying': 'That lease has already ended — there is nothing to transfer.',
  'tr.problem.unit_not_available':
    'That unit is not available. Pick one with no lease, reservation or hold on it.',
  'tr.problem.unit_different_facility':
    'A transfer moves you within one facility. That unit is at another site.',
  'tr.problem.same_unit': 'That is the unit you are already in.',
  'tr.problem.no_rate_for_unit_type': 'That unit has no published rate, so we cannot quote it.',

  // --- Static pages: About / Contact / FAQ (B-262, PRD 01 FR-8.1) ---------
  // The prose pages, which D-122 left in English because it had no way to give
  // them a URL. They have one now. `/terms`, `/privacy` and `/messaging-policy`
  // are still absent and stay that way: they are what a lawyer wrote, and a
  // translated TCPA or E-SIGN disclosure recorded against an English version
  // constant is evidence of a consent nobody gave (B-259 owns that).
  'about.meta': 'What this project is.',
  'about.title': 'About',
  'about.intro': 'A small self-storage operator, run on software we own.',
  'about.whatHeading': 'What we are',
  'about.whatBody':
    'We run a handful of self-storage facilities and built the software that runs them, rather than renting it per site per month. That means the prices and availability you see come from the same system the front desk uses — not a nightly export.',
  'about.siteHeading': 'A note on this site',
  'about.siteBody':
    'This is a learning project built to production standards. The facilities, tenants, and prices shown are demonstration data, and nothing here is a real offer of storage.',

  'contact.meta': 'How to reach us.',
  'contact.title': 'Contact',
  'contact.intro': 'The fastest way to reach us is the phone.',
  'contact.phoneHeading': 'Phone',
  'contact.emailHeading': 'Email',
  'contact.facilityHeading': 'A specific facility',
  'contact.facilityBody':
    'Each facility lists its own phone number, office hours, and gate hours on its page. Those reach the site directly.',

  'faq.meta': 'How reservations, move-ins, gate access, and billing work.',
  'faq.title': 'Frequently asked questions',
  'faq.intro': "Short answers to what people ask most. Call us if yours isn't here.",
  'faq.reserveHeading': 'Do I need to pay to reserve a unit?',
  'faq.reserveBody':
    "No. Reservations are free, need no card, and need no account — just your name, email, phone, and the date you want to move in. The hold expires on its own if you don't move in.",
  'faq.onlineHeading': 'Can I rent entirely online?',
  'faq.onlineBody':
    'Yes. You pick a unit, sign the lease electronically, pay the first amount due, and get your gate code — without visiting an office.',
  'faq.termHeading': 'Is there a long-term contract?',
  'faq.termBody':
    'No. Rentals are month-to-month. You give notice according to your lease and move out.',
  'faq.priceHeading': 'What is the difference between the online and in-store price?',
  'faq.priceBody':
    'Some sizes cost less when you rent online than when you rent at the counter. Both prices are shown before you commit, so you can see which one applies to you. Reserving does not change the price — renting online is what does.',
  'faq.sizeHeading': 'What size do I need?',
  'faq.sizeIntro': 'A rough guide, and we will happily talk it through on the phone:',
  'faq.size5x5Label': '5 by 5 feet',
  'faq.size5x5Body':
    'a large closet. Boxes, seasonal decorations, a bike, a few pieces of small furniture.',
  'faq.size10x10Label': '10 by 10 feet',
  'faq.size10x10Body':
    'about half a garage, or the contents of a one-bedroom apartment including a sofa and a mattress set.',
  'faq.size10x20Label': '10 by 20 feet',
  'faq.size10x20Body': 'a single garage. A three-bedroom house, or a car with room left over.',
  'faq.sizeAdvice':
    'If you are between two sizes, take the larger one. Paying a little more beats discovering on moving day that the last of it does not fit.',
  'faq.hoursHeading': 'When can I get to my unit?',
  'faq.hoursBody':
    'Office hours and gate hours are different, and both are listed on every facility page. Gate hours are when you can reach your unit; office hours are when staff are there.',
  'faq.elseHeading': 'Something else?',
  'faq.elseCall': 'Call',
  'faq.elseEmail': 'or email',


  // --- Accessibility statement (B-262, PRD 01 §6.8) ----------------------
  // Unlike the legal pages this describes OUR OWN conformance, so every
  // sentence has to be true of the build that is deployed — in both languages.
  // A Spanish accessibility statement whose gap list is in English fails
  // precisely the reader it exists for, which is why `scan-coverage.ts` carries
  // a `reasonEs` for every customer-facing exception rather than this page
  // rendering half a translation.
  'a11y.meta': 'Our accessibility target, what we test, and how to tell us when we get it wrong.',
  'a11y.title': 'Accessibility',
  'a11y.intro':
    'We aim to meet WCAG 2.1 Level AA across every page and every flow. This page says how far we have actually got.',
  'a11y.targetHeading': 'What we target',
  'a11y.targetBody':
    'Web Content Accessibility Guidelines (WCAG) 2.1, Level AA. That covers keyboard operation, screen-reader support, colour contrast, text resizing, and reflow on small screens.',
  'a11y.trueHeading': 'What is true today',
  'a11y.true.keyboard':
    'Every page on this public site works with a keyboard alone, and the focus indicator meets the 3:1 contrast the guidelines ask for.',
  'a11y.true.colour':
    'Colour is never the only way we tell you something — a status shown in colour is also written in words.',
  'a11y.true.zoom':
    'Text can be resized to 200% and the page reflows to 320px wide without sideways scrolling.',
  'a11y.true.labels': 'Form fields have real labels, not just placeholder text.',
  'a11y.true.errors':
    'When a form rejects something you typed, the message is tied to the field itself, so a screen reader reads it out with that field rather than leaving you to hunt for it — and what you already entered is still there, so you fix the one thing we asked about rather than filling the form in again. A successful save is announced too.',
  'a11y.true.motion': "Animation respects your system's reduced-motion setting.",
  'a11y.true.maps':
    'Where we show a map, the information is given as text first and the map is collapsed behind a button you have to press. On a facility page that text is the address and a directions link; on search results it is the list of facilities itself, with distances and prices. You never need the map, and if one fails to load we say so rather than leaving an empty box.',
  'a11y.checkHeading': 'How we check',
  'a11y.check.runs':
    'Automated accessibility tests run at both phone and desktop widths on every push to our main branch, and on every pull request that is open for review. They are not a release gate: a failing run tells us, it does not stop the deploy. A check the tool cannot decide fails the run as well, on every page in it, so “we did not test that” never quietly reads as “that passed”.',
  'a11y.check.waiverIntro':
    'A few of those undecided checks are ones we have looked at and found to be a limit of the tool rather than a real problem. They are set aside in three different ways, and we would rather name each than round them off:',
  'a11y.check.waiverPage':
    'Some are waived only on the page they were checked on — a bar that overlaps the page on purpose so it stays in reach, a striped background the checker cannot see through. The same check still has to pass everywhere else.',
  'a11y.check.waiverSite':
    'Some are waived anywhere on the site, but only where the test itself re-checks the thing that confused the tool. A cell that has scrolled out of view in a wide table is one: it is set aside only where you have a scrollbar that brings it back, and something genuinely painted off the edge of the screen still fails.',
  'a11y.check.waiverFrame':
    'Content inside a frame served by another company — the card form, the map — is not checked by these tests. That is their page, not ours. A frame we build ourselves is checked like anything else.',
  'a11y.check.routeIntro':
    'They do not yet cover everything. These are the pages outside that run, and the reason each one is:',
  'a11y.check.routeAfter':
    'We would rather name each gap than let a general claim cover it. This list is generated from the same file the tests read, so a page that stops being checked appears here rather than quietly disappearing from both.',
  'a11y.check.stateIntro':
    'That list names pages. Some screens also have states — an error message, a hold that has expired, a size that sold out while you were deciding — that only appear once you have done something on them. These are the ones we know are not covered, and why:',
  'a11y.check.stateAfter':
    'More states than these probably exist that we have not found and named yet — unlike the page list above, this one cannot claim to be complete.',
  'a11y.check.floorBefore':
    'Automated testing is a floor, not a ceiling — it catches roughly a third of real problems, and it cannot judge whether a screen reader says something that makes sense.',
  'a11y.check.floorStrong':
    'Neither a full screen-reader pass nor a recorded keyboard pass has been carried out yet',
  'a11y.check.floorAfter': ', so nothing on this page rests on one.',
  'a11y.shortHeading': 'Where we fall short today',
  'a11y.short.intro':
    'This site is under active construction. These are the problems we know about, as of {date}. If one of them blocks you, tell us and we will help you finish what you were doing by phone or email in the meantime.',
  'a11y.short.jsLabel': 'Renting online without JavaScript.',
  'a11y.short.jsBody':
    'The whole checkout works with JavaScript turned off, but the countdown on the 30-minute hold does not: it shows the time left when the page was drawn and does not tick down, so if you are reading the lease when it runs out, the expiry can be the first you hear of it. With JavaScript on you are warned five minutes out and can extend the hold in one press.',
  'a11y.short.staffLabel': 'Our staff-facing screens',
  'a11y.short.staffBody':
    'have known problems. Long lists on Tasks, Leads, Delinquency and Support sessions are not paginated. No customer uses them, but we are not going to describe them as done.',
  'a11y.short.mapsLabel': 'The maps we show are not fully accessible',
  'a11y.short.mapsBody':
    ", and they are not ours to fix. A facility page embeds OpenStreetMap, whose zoom controls are named “+” and “−” and whose marker has no text alternative. Search results can show a second map from a different provider, where we control the price markers but not the tiles or the vendor's own controls beneath them; we have not yet assessed that one against a live map, so nothing here rests on it. Both stay collapsed behind a button, and neither is ever the only way to get the information.",
  'a11y.short.spanishLabel': 'The Spanish site is scanned in fewer places than the English one.',
  'a11y.short.spanishBody':
    'Every public page and every account page now has a Spanish address of its own, and our automated run follows the English ones. The pages it does check in Spanish are named in the list above, and so is every page it does not. The Spanish text is the same markup as the English, so a problem found on one is a problem on both — what is not yet measured is how the longer Spanish wording reflows on a small screen, page by page.',
  'a11y.short.lastReviewed': 'Last reviewed: {date}.',
  'a11y.tellHeading': 'Tell us when we get it wrong',
  'a11y.tell.before': 'If something here blocks you, email',
  'a11y.tell.middle': 'or call',
  'a11y.tell.after':
    '. Tell us the page and what happened, and we will fix it and reply. An accessibility barrier is a bug, and we treat it as one.',


  // --- Guide pages (B-262, PRD 04 US-4) ---------------------------------
  // The frame around a guide's MDX prose. The prose itself is a file per
  // language under `content/guides`, because a 50-line article is not a
  // dictionary entry — what lives here is the chrome a reader meets on every
  // one of them.
  'guide.allGuides': '← All guides',
  'guide.lastUpdated': 'Last updated',
  'guide.carryFilterBefore': 'We will carry the',
  'guide.carryFilterAfter': 'filter through to the facility you pick.',
  'guide.questionsHeading': 'Questions people ask',
  'guide.moreBefore': 'More in the',
  'guide.moreLink': 'storage guides',
  'guide.moreMiddle': ', or',
  'guide.moreSearchLink': 'find storage near you',
  'guide.hubTitle': 'Storage guides',
  'guide.hubDescription':
    'Plain answers to the questions people ask before renting a storage unit: what size you need, what fits, what to pack, and whether climate control is worth it.',
  'guide.hubIntro':
    'Five guides to the decisions people make before they rent: what size, what fits, what to pack, and whether to pay for climate control.',
  'guide.hubReadMore': 'Read',
  'guide.notFound': 'Guide not found',

} as const
