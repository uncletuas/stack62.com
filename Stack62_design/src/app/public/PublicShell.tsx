import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { Logo } from "../components/Logo";
import { useAppContext } from "../context/app-context";
import { useTheme } from "../context/theme-context";

/**
 * Header + footer shared across the public marketing pages
 * (landing, pricing, sign-in, sign-up, invite). Authed users see a
 * "Go to app" CTA in place of "Sign in / Get started".
 *
 * Public pages are dark-only — the design is built around a dark hero
 * gradient and the brand tokens look thin in light mode. We force the
 * theme to dark while this shell is mounted, then release the override
 * on unmount so the user's saved in-app preference returns as soon as
 * they cross into /app.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAppContext();
  const navigate = useNavigate();
  const { forceResolved } = useTheme();

  useEffect(() => {
    forceResolved("dark");
    return () => forceResolved(null);
  }, [forceResolved]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 text-slate-900 dark:text-slate-50">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/70 dark:bg-slate-950/70 border-b border-slate-200/70 dark:border-slate-800/70">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <BrandMark />
            <span className="font-semibold tracking-tight text-base">
              Stack62
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-slate-600 dark:text-slate-300">
            <Link to="/#how" className="hover:text-slate-900 dark:hover:text-white transition">How it works</Link>
            <Link to="/#features" className="hover:text-slate-900 dark:hover:text-white transition">Features</Link>
            <Link to="/pricing" className="hover:text-slate-900 dark:hover:text-white transition">Pricing</Link>
            <Link to="/#faq" className="hover:text-slate-900 dark:hover:text-white transition">FAQ</Link>
          </nav>
          <div className="flex items-center gap-2">
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate("/app")}>
                Go to app
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigate("/sign-in")}
                >
                  Sign in
                </Button>
                <Button size="sm" onClick={() => navigate("/sign-up")}>
                  Get started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-slate-200/70 dark:border-slate-800/70 mt-24">
        <div className="max-w-7xl mx-auto px-6 py-12 grid md:grid-cols-4 gap-8 text-sm">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <BrandMark />
              <span className="font-semibold">Stack62</span>
            </div>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
              The AI-powered environment where your business runs — one
              place for operations, decisions, and your whole team.
            </p>
          </div>
          <FooterCol
            heading="Product"
            links={[
              { label: "How it works", to: "/#how" },
              { label: "Features", to: "/#features" },
              { label: "Pricing", to: "/pricing" },
            ]}
          />
          <FooterCol
            heading="Company"
            links={[
              { label: "Loopital", to: "https://loopital.com" },
              { label: "Contact", to: "mailto:hello@stack62.com" },
            ]}
          />
          <FooterCol
            heading="Legal"
            links={[
              { label: "Terms", to: "/#legal" },
              { label: "Privacy", to: "/#legal" },
              { label: "DPA", to: "/#legal" },
            ]}
          />
        </div>
        <div className="border-t border-slate-200/70 dark:border-slate-800/70">
          <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <p>© {new Date().getFullYear()} Stack62. All rights reserved.</p>
            <p className="mt-2 md:mt-0">
              A{" "}
              <a
                href="https://loopital.com"
                className="font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
              >
                Loopital
              </a>{" "}
              product.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({
  heading,
  links,
}: {
  heading: string;
  links: { label: string; to: string }[];
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
        {heading}
      </div>
      <ul className="space-y-2">
        {links.map((l) => (
          <li key={l.label}>
            {l.to.startsWith("mailto:") || l.to.startsWith("http") ? (
              <a
                href={l.to}
                className="text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white"
              >
                {l.label}
              </a>
            ) : (
              <Link
                to={l.to}
                className="text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white"
              >
                {l.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BrandMark({ size = 28 }: { size?: number }) {
  return <Logo size={size} />;
}
