import Link from 'next/link'
import type { MDXComponents } from 'mdx/types'

// PRD 04 US-4 AC2 (B-082 part 3). How a guide's markdown becomes this site's
// typography.
//
// Required by `@next/mdx` in the App Router: without this file every element a
// guide produces renders with no styling at all. That is not a cosmetic
// problem here — Tailwind's preflight resets headings and lists to plain text,
// so an unmapped `##` renders at body size and a `-` list loses its bullets.
// A reader would still get correct semantics and a screen reader would still
// announce a level-2 heading; a sighted reader would see a wall of prose.
//
// The mapping is deliberately small. A guide can use headings, paragraphs,
// lists, links, emphasis and a horizontal rule — that is the whole vocabulary
// of the five guides, and every element added here is one more thing a writer
// can reach for and one more thing to check at 320px and 200% zoom.

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    // No `h1`. The page frame renders the guide's title as the only level-one
    // heading, and a second one is a 1.3.1 failure that automated tools do not
    // always catch. Guides start at `##`, and the frame's own heading order
    // depends on their doing so.
    h2: ({ children }) => (
      <h2 className="mt-10 text-xl font-medium tracking-tight text-balance">{children}</h2>
    ),
    h3: ({ children }) => <h3 className="mt-6 text-base font-medium">{children}</h3>,
    p: ({ children }) => <p className="mt-4 text-pretty">{children}</p>,
    ul: ({ children }) => <ul className="mt-4 flex list-disc flex-col gap-2 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="mt-4 flex list-decimal flex-col gap-2 pl-5">{children}</ol>,
    li: ({ children }) => <li className="text-pretty">{children}</li>,
    strong: ({ children }) => <strong className="font-medium">{children}</strong>,
    hr: () => <hr className="mt-8 border-t" />,
    a: ({ href, children }) => {
      const target = href ?? '#'
      // An internal link goes through `next/link` so a guide's cross-references
      // behave like every other link on the site; an external or `tel:` one is
      // left as a plain anchor, which is what those are.
      return target.startsWith('/') ? (
        <Link href={target} className="underline underline-offset-4">
          {children}
        </Link>
      ) : (
        <a href={target} className="underline underline-offset-4">
          {children}
        </a>
      )
    },
    ...components,
  }
}
