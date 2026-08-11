// Brand-level values the public site needs before there is anywhere to
// configure them. Per-facility phone/address already live on Facility (B-008);
// these are the *organisation* equivalents, which nothing owns yet — org-level
// defaults arrive with B-079. Kept in one file so that item has one place to
// replace rather than a hunt through templates.
export const SITE = {
  name: 'Storage Co.',
  tagline: 'Simple self-storage, rented online in minutes.',
  /// E.164 for the `tel:` href, formatted separately for display.
  phone: { href: '+15125550100', display: '(512) 555-0100' },
  supportEmail: 'help@example.com',
  /// The number tenants text to opt in, and the one the messaging policy
  /// publishes. Separate from `phone` on purpose: the office line and the A2P
  /// messaging number are usually different, and printing the wrong one on the
  /// page an A2P 10DLC review reads is how a campaign gets rejected.
  smsNumber: { href: '+18775147301', display: '(877) 514-7301' },
} as const

/// Static/legal pages required by PRD 01 FR-8.1. Listed once so the footer,
/// the sitemap (B-066), and the a11y sweep can't drift apart.
export const LEGAL_PAGES = [
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/accessibility', label: 'Accessibility' },
  // PRD 05 CN-14 / §6.4. Public because it has to be: an A2P 10DLC campaign
  // review asks for the URL, and the portal's own consent control points here.
  { href: '/messaging-policy', label: 'Text messages' },
] as const
