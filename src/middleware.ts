import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

    // ✅ BYPASS (pages publiques + assets + API publique)
  if (
    pathname.startsWith("/_next") ||
    pathname === "/next.svg" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/posters/") ||
    pathname.startsWith("/skgl") ||
    pathname.startsWith("/api/public/")
  ) {
    return NextResponse.next();
  }

  // Zones à protéger
  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/prospects") ||
    pathname.startsWith("/clients") ||
    pathname.startsWith("/devis") ||
    pathname.startsWith("/facturation") ||
    pathname.startsWith("/archives") ||
    pathname.startsWith("/settings");

  if (!isProtected) return NextResponse.next();

  // Cookies NextAuth/Auth.js possibles
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token") ||
    req.cookies.has("next-auth.session-token") ||
    req.cookies.has("__Secure-next-auth.session-token");

  if (hasSession) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/prospects/:path*",
    "/clients/:path*",
    "/devis/:path*",
    "/facturation/:path*",
    "/archives/:path*",
    "/settings/:path*",
  ],
};
