import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "../components/ui/button";
import { useAppContext } from "../context/app-context";

/**
 * Header + footer shared across the public marketing pages
 * (landing, pricing, sign-in, sign-up, invite). Authed users see a
 * "Go to app" CTA in place of "Sign in / Get started".
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAppContext();
  const navigate = useNavigate();

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
            <Link to="/#product" className="hover:text-slate-900 dark:hover:text-white transition">Product</Link>
            <Link to="/#how-it-works" className="hover:text-slate-900 dark:hover:text-white transition">How it works</Link>
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
              An AI-native operating layer for the systems that run your
              business — built so you stay in control.
            </p>
          </div>
          <FooterCol
            heading="Product"
            links={[
              { label: "Features", to: "/#product" },
              { label: "How it works", to: "/#how-it-works" },
              { label: "Pricing", to: "/pricing" },
            ]}
          />
          <FooterCol
            heading="Company"
            links={[
              { label: "Trust & security", to: "/#trust" },
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
              Built for teams who want AI in the loop, not the cockpit.
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
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className="rounded-lg shadow-sm"
    >
      <defs>
        <linearGradient id="s62g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0F172A" />
          <stop offset="100%" stopColor="#1E293B" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#s62g)" />
      <path
        d="M9 11.5c0-1.93 1.79-3.5 4-3.5h6c2.21 0 4 1.57 4 3.5S21.21 15 19 15h-6"
        stroke="#fff"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M23 20.5c0 1.93-1.79 3.5-4 3.5h-6c-2.21 0-4-1.57-4-3.5S10.79 17 13 17h6"
        stroke="#fff"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}
