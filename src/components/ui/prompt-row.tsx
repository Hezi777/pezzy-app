"use client";

import * as React from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Plus, Send, X } from "lucide-react";
import { getRecommendations } from "@/lib/api";
import type { RecoRow } from "@/lib/types";
import { ContentRow } from "@/components/ui/content-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { entranceTransition } from "@/lib/motion";

interface PromptRowProps {
  profileId: string;
}

/**
 * The homepage's row composer. Deliberately reads as a compact action, not a
 * fake rail: a dashed-border pill with a plus mark at rest, expanding in
 * place into a bordered composer card. Generated rows stack above it and can
 * each be dismissed, since asking will keep adding more of them over time.
 */
export function PromptRow({ profileId }: PromptRowProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [rows, setRows] = React.useState<RecoRow[]>([]);
  const [prompt, setPrompt] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generate = async (text: string) => {
    const message = text.trim();
    if (!message || loading) return;

    setLoading(true);
    setError(null);
    try {
      const result = await getRecommendations({
        profileId,
        intent: "chat",
        prompt: message,
      });
      // Give each generated row a unique id so repeated asks don't collide.
      const stamped = result.map((row) => ({ ...row, id: `${row.id}-${Date.now()}` }));
      setRows((prev) => [...prev, ...stamped]);
      setPrompt("");
    } catch {
      setError("Couldn't build that row just now. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  };

  const dismissRow = (id: string) => {
    setRows((prev) => prev.filter((row) => row.id !== id));
  };

  return (
    <div>
      {/* Rows generated from prompts, stacked above the composer */}
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <motion.div
            key={row.id}
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          >
            <ContentRow row={row} onDismiss={() => dismissRow(row.id)} />
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Composer */}
      <div className="px-[4vw] py-4">
        <AnimatePresence mode="wait" initial={false}>
          {!open ? (
            <motion.button
              key="collapsed"
              type="button"
              onClick={() => setOpen(true)}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="group inline-flex items-center gap-2.5 rounded-full border border-dashed border-white/15 bg-white/[0.02] py-2 pl-2 pr-4 transition-colors hover:border-steel/40 hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                Make your own row
              </span>
            </motion.button>
          ) : (
            <motion.div
              key="expanded"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: 8 }}
              transition={entranceTransition}
              className="w-full max-w-xl rounded-2xl border border-white/10 bg-card p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Plus className="h-3 w-3" />
                </span>
                <h2 className="text-sm font-medium text-muted-foreground">
                  Make your own row
                </h2>
              </div>

              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  generate(prompt);
                }}
              >
                <input
                  autoFocus
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Something like: revenge stories with a great villain"
                  className="flex-1 rounded-full border border-white/10 bg-background px-4 py-2.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-steel/50 focus:ring-2 focus:ring-ring/30"
                />
                <Button
                  type="submit"
                  disabled={loading || !prompt.trim()}
                  aria-label="Generate row"
                  className="h-10 w-10 flex-none rounded-full p-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
                <button
                  type="button"
                  aria-label="Close composer"
                  onClick={() => {
                    setOpen(false);
                    setPrompt("");
                    setError(null);
                  }}
                  className={cn(
                    "flex h-10 w-10 flex-none items-center justify-center rounded-full border border-white/10 text-muted-foreground transition-colors hover:border-steel/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              </form>

              {/* Status */}
              {loading && (
                <div className="mt-3 flex items-center gap-2 text-sm text-steel">
                  {reduceMotion ? (
                    <span>Building your row...</span>
                  ) : (
                    <>
                      <span className="flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-steel animate-bounce [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-steel animate-bounce [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-steel animate-bounce" />
                      </span>
                      <span>Building your row</span>
                    </>
                  )}
                </div>
              )}
              {error && (
                <p className="mt-3 text-sm text-accent">{error}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
