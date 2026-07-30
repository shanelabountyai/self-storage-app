import { Button } from '@/components/ui/button'

// Placeholder home page. The real public site shell — search hero, header,
// legal pages — is B-013; this exists so the scaffold is verifiable end to end.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-balance">
        Self-Storage Platform
      </h1>
      <p className="text-muted-foreground text-lg text-pretty">
        Scaffold is running: Next.js App Router, Tailwind, shadcn/ui, and Prisma
        are wired up. Feature work starts at B-002 (core data model).
      </p>
      <div>
        <Button>Nothing to click yet</Button>
      </div>
    </main>
  )
}
