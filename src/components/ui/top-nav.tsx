"use client";

import * as React from "react";
import { Search, User, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { searchCatalogLive } from "@/lib/api";
import type { Title } from "@/lib/types";

/** Debounce a bit under 200ms so results feel instant but keystrokes don't each fire a request. */
const SEARCH_DEBOUNCE_MS = 180;

interface TopNavProps {
  /** Optional custom class names on the root. */
  className?: string;
  /**
   * Prefills and opens the search field. Passed by /search rather than read
   * from `useSearchParams`, which would force every page using TopNav behind a
   * Suspense boundary and opt them out of static rendering.
   */
  initialQuery?: string;
  profileName?: string;
  profileAvatar?: string;
}

const NAV_LINKS = [
  { label: "Home", href: "/hub" },
  { label: "Series", href: "/series" },
  { label: "Movies", href: "/movies" },
  { label: "My List", href: "/my-list" },
];

const MENU_ITEMS = [
  { label: "My Stuff", href: "/my-list" },
  { label: "Switch Profiles", href: "/" },
  { label: "Settings", href: "/settings" },
  { label: "Sign Out", href: "/" },
];

/** Closes `open` on a pointerdown outside `ref`, while `open` is true. */
function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  setOpen: (open: boolean) => void
) {
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [ref, open, setOpen]);
}

/**
 * Pezzy top navigation. Centered wordmark HBO Max-style, links on the left,
 * search + profile menu on the right. Transparent over the hero at the top
 * of the page, becomes a frosted glass bar once the user scrolls past ~40px.
 * The Ask Pezzy chat opens from its own floating widget.
 */
export function TopNav({
  className,
  initialQuery = "",
  profileName = "Profile",
  profileAvatar,
}: TopNavProps) {
  const router = useRouter();
  const [scrolled, setScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(initialQuery.length > 0);
  const [query, setQuery] = React.useState(initialQuery);
  const [results, setResults] = React.useState<Title[]>([]);
  const [resultsOpen, setResultsOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const searchFormRef = React.useRef<HTMLFormElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  // Debounced live search as the user types. Results are keyed to a
  // request token so a slow earlier response can never overwrite a newer one.
  // An empty query never fires: this effect returns immediately without it.
  React.useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      searchCatalogLive(trimmed, controller.signal)
        .then((titles) => {
          setResults(titles);
          setResultsOpen(true);
          setActiveIndex(-1);
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useClickOutside(menuRef, menuOpen, setMenuOpen);
  useClickOutside(searchFormRef, resultsOpen, setResultsOpen);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300 ease-out",
        scrolled
          ? "border-b border-white/10 bg-background/70 backdrop-blur"
          : "border-b border-transparent bg-transparent",
        className
      )}
    >
      <div className="relative flex h-16 w-full items-center px-[4vw]">
        {/* Left: nav links */}
        <nav className="hidden items-center gap-8 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Center: wordmark, absolutely centered like HBO Max */}
        <Link
          href="/hub"
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-wordmark text-2xl font-semibold tracking-tight text-foreground md:text-3xl"
        >
          Pezzy
        </Link>

        {/* Right: search, profile menu */}
        <div className="ml-auto flex items-center gap-3">
          <form
            ref={searchFormRef}
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = query.trim();
              if (!trimmed) return;
              setResultsOpen(false);
              router.push(`/search?q=${encodeURIComponent(trimmed)}`);
            }}
            className="relative flex items-center"
          >
            <AnimatePresence initial={false}>
              {searchOpen && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: "auto", opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <input
                    ref={searchInputRef}
                    type="search"
                    role="combobox"
                    aria-expanded={resultsOpen}
                    aria-controls="nav-search-listbox"
                    aria-autocomplete="list"
                    aria-activedescendant={
                      activeIndex >= 0 ? `nav-search-option-${activeIndex}` : undefined
                    }
                    value={query}
                    onChange={(e) => {
                      const value = e.target.value;
                      setQuery(value);
                      if (!value.trim()) {
                        abortRef.current?.abort();
                        setResults([]);
                        setResultsOpen(false);
                        setActiveIndex(-1);
                      }
                    }}
                    onFocus={() => {
                      if (results.length > 0) setResultsOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        if (resultsOpen) {
                          setResultsOpen(false);
                        } else {
                          setSearchOpen(false);
                        }
                        return;
                      }
                      if (!resultsOpen || results.length === 0) return;

                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setActiveIndex((i) => (i + 1) % results.length);
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
                      } else if (e.key === "Enter" && activeIndex >= 0) {
                        e.preventDefault();
                        const picked = results[activeIndex];
                        setResultsOpen(false);
                        setSearchOpen(false);
                        router.push(`/title/${picked.id}`);
                      }
                    }}
                    placeholder="Search anime"
                    aria-label="Search anime"
                    className="w-40 rounded-full border border-white/15 bg-background/70 px-4 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none sm:w-56"
                  />
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>
              {searchOpen && resultsOpen && (
                <motion.ul
                  id="nav-search-listbox"
                  role="listbox"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute left-0 top-[calc(100%+8px)] w-72 overflow-hidden rounded-md border border-border bg-background/90 py-1 shadow-lg backdrop-blur"
                >
                  {results.length === 0 ? (
                    <li className="px-4 py-3 text-sm text-muted-foreground">
                      Nothing matched “{query.trim()}”.
                    </li>
                  ) : (
                    results.map((title, index) => (
                      <li
                        key={title.id}
                        id={`nav-search-option-${index}`}
                        role="option"
                        aria-selected={index === activeIndex}
                      >
                        <Link
                          href={`/title/${title.id}`}
                          onClick={() => {
                            setResultsOpen(false);
                            setSearchOpen(false);
                          }}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={cn(
                            "flex items-center gap-3 px-4 py-2 text-sm transition-colors",
                            index === activeIndex
                              ? "bg-white/10 text-foreground"
                              : "text-foreground/90 hover:bg-white/10 hover:text-foreground"
                          )}
                        >
                          <span className="truncate">{title.title}</span>
                          {title.year && (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              {title.year}
                            </span>
                          )}
                        </Link>
                      </li>
                    ))
                  )}
                </motion.ul>
              )}
            </AnimatePresence>
            <button
              type={searchOpen ? "submit" : "button"}
              aria-label={searchOpen ? "Submit search" : "Search"}
              onClick={() => {
                if (!searchOpen) {
                  setSearchOpen(true);
                  requestAnimationFrame(() => searchInputRef.current?.focus());
                }
              }}
              className="rounded-full p-2 text-foreground/90 transition-colors hover:bg-white/10 hover:text-foreground"
            >
              <Search className="h-5 w-5" />
            </button>
            {searchOpen && (
              <button
                type="button"
                aria-label="Close search"
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                  setResultsOpen(false);
                }}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </form>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-label={`${profileName} profile`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="h-8 w-8 overflow-hidden rounded-full ring-1 ring-white/10 transition-all hover:ring-primary/50"
            >
              {profileAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profileAvatar}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <User className="m-1.5 h-5 w-5 text-muted-foreground" />
              )}
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  role="menu"
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-[calc(100%+10px)] w-48 overflow-hidden rounded-md border border-border bg-background/80 py-1 shadow-lg backdrop-blur"
                >
                  <div className="border-b border-white/10 pb-1 md:hidden">
                    {NAV_LINKS.map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="block px-4 py-2 text-sm text-foreground/90 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                  {MENU_ITEMS.map((item) => (
                    <Link
                      key={item.label}
                      href={item.href}
                      role="menuitem"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-foreground/90 transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      {item.label}
                    </Link>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
