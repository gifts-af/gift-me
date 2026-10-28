import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";
import { supabaseKey, supabaseUrl } from "./env";

// Paths signed-out visitors may open. /api/keepalive checks its own secret
// (ALL-43). The manifest and icons must load signed out, or "Add to Home
// Screen" breaks on the sign-in page. Home ("/") needs an account (ALL-20).
export function isPublicPath(pathname: string) {
  return (
    pathname === "/lists" ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon") ||
    pathname.startsWith("/pwa-icon/") ||
    pathname === "/api/keepalive" ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/share/") ||
    pathname.startsWith("/auth")
  );
}

// Sign-in, then back to the page that was asked for.
export function signInRedirect(requested: URL): URL {
  const url = new URL("/auth/login", requested);
  const back = requested.pathname + requested.search;
  if (back !== "/") url.searchParams.set("next", back);
  return url;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    supabaseUrl!,
    supabaseKey!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.redirect(signInRedirect(request.nextUrl));
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
