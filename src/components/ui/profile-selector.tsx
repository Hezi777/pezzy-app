"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { entranceTransition } from "@/lib/motion";

// A single profile. Icon can be an image URL or a React node (e.g. the Add button).
interface Profile {
  id: string;
  label: string;
  icon: string | React.ReactNode;
}

interface ProfileSelectorProps {
  /** Main title above the profiles */
  title?: string;
  /** Profiles to display */
  profiles: Profile[];
  /** Called with the profile id when one is selected */
  onProfileSelect: (id: string) => void;
  /** Optional custom class names on the root */
  className?: string;
}

/**
 * Pezzy "Who's Watching?" profile selector.
 *
 * Ported from the 21st.dev ProfileSelector, re-skinned to the Pezzy Design DNA:
 * cinematic navy-black base, HBO-style spotlight glow on hover (violet primary),
 * frosted avatar ring, and a staggered "composing" entrance so the profiles feel
 * assembled for you. Respects prefers-reduced-motion.
 */
export const ProfileSelector = ({
  title = "Who's watching?",
  profiles,
  onProfileSelect,
  className,
}: ProfileSelectorProps) => {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className={cn(
        "flex min-h-screen w-full flex-col items-center justify-center bg-background p-4",
        className
      )}
    >
      <div className="flex flex-col items-center">
        <motion.h1
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={entranceTransition}
          className="mb-12 font-display text-3xl font-semibold tracking-tight text-foreground md:text-5xl"
        >
          {title}
        </motion.h1>

        <div className="flex max-w-4xl flex-wrap justify-center gap-x-6 gap-y-8 md:gap-x-8">
          {profiles.map((profile, i) => (
            <motion.div
              key={profile.id}
              initial={reduceMotion ? false : { opacity: 0, y: 20, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                ...entranceTransition,
                duration: 0.45,
                delay: 0.15 + i * 0.08, // stagger: the row "composes itself"
              }}
              className="group flex w-28 flex-col items-center gap-3 md:w-36"
            >
              <button
                onClick={() => onProfileSelect(profile.id)}
                aria-label={`Select profile: ${profile.label}`}
                className="group relative h-28 w-28 rounded-full outline-none transition-transform duration-300 ease-out hover:-translate-y-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:h-36 md:w-36"
              >
                {/* Spotlight glow — HBO-style, blooms on hover/focus */}
                <div className="pointer-events-none absolute -inset-2 rounded-full bg-primary/0 blur-xl transition-all duration-300 group-hover:bg-primary/25 group-focus-visible:bg-primary/25" />

                {/* Avatar surface + frosted ring */}
                <div className="absolute inset-0 rounded-full bg-muted ring-1 ring-white/10 transition-all duration-300 group-hover:ring-primary/50" />

                <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-full">
                  {typeof profile.icon === "string" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.icon}
                      alt={`${profile.label} profile`}
                      className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
                    />
                  ) : (
                    profile.icon
                  )}
                </div>
              </button>

              <p className="text-base text-muted-foreground transition-colors group-hover:text-foreground md:text-lg">
                {profile.label}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Helper for non-image icons (e.g. the Add button).
export const ProfileIcon = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex h-full w-full items-center justify-center text-4xl text-foreground/80 md:text-5xl",
      className
    )}
  >
    {children}
  </div>
);
