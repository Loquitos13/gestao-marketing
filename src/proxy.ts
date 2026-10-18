import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = [/^\/login/, /^\/share\//, /^\/api\/health/, /^\/api\/share\//, /^\/_next\//, /^\/favicon/];

/**
 * Verificação rápida da presença do cookie de sessão (a validação real é feita no servidor
 * em cada página/ação). Protege também contra CSRF em pedidos que alteram estado nas rotas API.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();

  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    if (origin && origin !== req.nextUrl.origin) return new NextResponse("Origem inválida", { status: 403 });
  }

  if (!req.cookies.has("mih_session")) {
    if (pathname.startsWith("/api/")) return new NextResponse("Não autenticado", { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
