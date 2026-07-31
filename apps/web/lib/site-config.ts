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
] as const
