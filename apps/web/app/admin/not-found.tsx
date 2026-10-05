import Link from 'next/link'
import { DocumentTitle } from '@/components/site/error-panel'

// B-435 (PRD 01 §6.7).
export default function AdminNotFound() {
  return (
    <div className="flex flex-col items-start gap-4">
      <DocumentTitle title="Record not found" />
      <h1 className="text-2xl font-bold tracking-tight">Record not found</h1>
      <p>It does not exist, or it belongs to a facility you cannot see.</p>
      <Link href="/admin" className="inline-flex min-h-11 items-center underline underline-offset-4">
        Back to the dashboard
      </Link>
    </div>
  )
}
