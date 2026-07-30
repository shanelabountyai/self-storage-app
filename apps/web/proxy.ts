import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/auth.config'

// Edge-level gate for /admin/*: JWT sessions decode without a DB round-trip,
// so this check costs nothing and runs before any page renders. It only
// verifies "signed in as staff" — per-permission and per-facility checks need
// the database and happen in the layout/page (lib/rbac/authorize.ts).
//
// This builds its own NextAuth instance from the edge-safe authConfig rather
// than importing the app's `auth` from ./auth — that one adds providers whose
// authorize() functions import @storage/db, and Prisma's client is not
// Edge-Runtime compatible (middleware always runs on the edge). Both
// instances read the same AUTH_SECRET, so a JWT either one issues is decodable
// by the other.
const { auth } = NextAuth(authConfig)

export default auth((request) => {
  const isStaff = request.auth?.user?.audience === 'staff'
  if (!isStaff) {
    const url = new URL('/login', request.nextUrl.origin)
    url.searchParams.set('from', request.nextUrl.pathname)
    return NextResponse.redirect(url)
  }
})

export const config = {
  matcher: ['/admin/:path*'],
}
