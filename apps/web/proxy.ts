import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/auth.config'

// Edge-level gate for /admin/* and /portal/* (B-033): JWT sessions decode
// without a DB round-trip, so this check costs nothing and runs before any
// page renders. It only verifies "signed in as the right audience" —
// per-permission and per-facility checks for staff need the database and
// happen in the layout/page (lib/rbac/authorize.ts); the portal has no
// further check because a tenant actor carries no permissions to check.
//
// This builds its own NextAuth instance from the edge-safe authConfig rather
// than importing the app's `auth` from ./auth — that one adds providers whose
// authorize() functions import @storage/db, and Prisma's client is not
// Edge-Runtime compatible (middleware always runs on the edge). Both
// instances read the same AUTH_SECRET, so a JWT either one issues is decodable
// by the other.
const { auth } = NextAuth(authConfig)

export default auth((request) => {
  const audience = request.auth?.user?.audience
  const requiredAudience = request.nextUrl.pathname.startsWith('/admin') ? 'staff' : 'tenant'

  if (audience !== requiredAudience) {
    const url = new URL('/login', request.nextUrl.origin)
    url.searchParams.set('from', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }
})

export const config = {
  matcher: ['/admin/:path*', '/portal/:path*'],
}
