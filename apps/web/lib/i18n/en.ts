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
} as const
