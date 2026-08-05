import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'My account' }

// B-034 builds the real dashboard (balance, autopay, gate code). This is only
// proof the gate in portal/layout.tsx works — real content is that item's.
export default function PortalHomePage() {
  return (
    <div>
      <h1 className="text-xl font-semibold">My account</h1>
      <p className="text-muted-foreground mt-2 text-sm text-pretty">
        Your account dashboard is on its way — balance, autopay, and your gate code will live here.
      </p>
    </div>
  )
}
