"use client";

import * as React from "react";
import { MessageCircle, MessageSquare, Send, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { askPezzy } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ChatResponse, RecoRow } from "@/lib/types";
import { ContentRow } from "@/components/ui/content-row";

interface AskPezzyProps {
  profileId: string;
}

interface Message {
  id: string;
  role: "user" | "pezzy";
  text: string;
  row?: RecoRow;
}

/**
 * Simple module-level event so the top nav's "Ask Pezzy" button can open
 * this self-managed widget without prop-drilling or a context provider.
 */
const openEvent = new EventTarget();
export function openAskPezzy() {
  openEvent.dispatchEvent(new Event("open"));
}

let messageId = 0;
const nextId = () => `msg-${messageId++}`;

const containerVariants: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", damping: 25, stiffness: 300, staggerChildren: 0.05 },
  },
  exit: { opacity: 0, y: 20, scale: 0.95, transition: { duration: 0.2 } },
};

const messageVariants: Variants = {
  hidden: { opacity: 0, y: 10, x: -6 },
  visible: {
    opacity: 1,
    y: 0,
    x: 0,
    transition: { type: "spring", stiffness: 500, damping: 30 },
  },
};

/** Pezzy's avatar: a navy gradient tile with the brand icon. */
function PezzyAvatar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border border-steel/40 bg-gradient-to-br from-primary to-secondary text-primary-foreground",
        className
      )}
    >
      <MessageCircle className="h-1/2 w-1/2" />
    </div>
  );
}

/**
 * Floating "talk to your homepage" widget. The trigger bottom-right morphs
 * between a message icon and a close icon; opening reveals a glass card with a
 * Pezzy-branded header, avatar-attributed messages, and a rounded composer.
 * Sending calls the shared recommendation core via askPezzy() and can render a
 * generated row inline. Respects prefers-reduced-motion.
 */
export function AskPezzy({ profileId }: AskPezzyProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = React.useState(false);
  const [messages, setMessages] = React.useState<Message[]>([
    {
      id: nextId(),
      role: "pezzy",
      text: "Tell me what you're in the mood for and I'll build a row for it.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);
  const userAvatar = `/avatars/${profileId}.png`;

  React.useEffect(() => {
    const handler = () => setOpen(true);
    openEvent.addEventListener("open", handler);
    return () => openEvent.removeEventListener("open", handler);
  }, []);

  React.useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, loading]);

  const handleSend = async () => {
    const message = input.trim();
    if (!message || loading) return;

    setMessages((prev) => [...prev, { id: nextId(), role: "user", text: message }]);
    setInput("");
    setLoading(true);

    try {
      const res: ChatResponse = await askPezzy({ profileId, message });
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "pezzy", text: res.reply, row: res.row },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "pezzy",
          text: "Sorry, I couldn't get that just now. Try again in a moment.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-4">
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-window"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            style={{ transformOrigin: "bottom right" }}
            className="w-[380px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-white/10 bg-background/60 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl"
          >
            {/* Header */}
            <div className="relative overflow-hidden border-b border-white/10 bg-elevated/40 p-4">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/25 to-secondary/20 opacity-60" />
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <PezzyAvatar className="h-10 w-10 border-2 border-background shadow-sm" />
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Pezzy</h3>
                    <span className="text-xs text-muted-foreground">
                      Search &amp; recommendations
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Chat area */}
            <div
              ref={listRef}
              className="flex h-[320px] flex-col gap-4 overflow-y-auto bg-gradient-to-b from-background/20 to-background/40 p-4"
            >
              {messages.map((m) =>
                m.role === "pezzy" ? (
                  <motion.div
                    key={m.id}
                    variants={messageVariants}
                    initial={reduceMotion ? false : "hidden"}
                    animate="visible"
                  >
                    <div className="flex gap-3">
                      <PezzyAvatar className="h-8 w-8 flex-none border border-white/10 shadow-sm" />
                      <div className="flex max-w-[85%] flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">
                          Pezzy
                        </span>
                        <div className="rounded-2xl rounded-tl-none border border-white/10 bg-elevated/60 px-4 py-2.5 text-sm text-foreground shadow-sm backdrop-blur-sm">
                          {m.text}
                        </div>
                      </div>
                    </div>
                    {m.row && (
                      <div className="-mx-4 mt-3">
                        <ContentRow row={m.row} />
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key={m.id}
                    variants={messageVariants}
                    initial={reduceMotion ? false : "hidden"}
                    animate="visible"
                    className="flex flex-row-reverse gap-3 self-end"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={userAvatar}
                      alt=""
                      className="h-8 w-8 flex-none rounded-full border border-white/10 object-cover shadow-sm"
                    />
                    <div className="flex max-w-[85%] flex-col items-end gap-1">
                      <div className="rounded-2xl rounded-tr-none border border-steel/50 bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-md">
                        {m.text}
                      </div>
                    </div>
                  </motion.div>
                )
              )}

              {/* Typing indicator */}
              {loading && (
                <div className="flex gap-3">
                  <PezzyAvatar className="h-8 w-8 flex-none border border-white/10 shadow-sm" />
                  <div className="flex w-16 items-center justify-center gap-1 rounded-2xl rounded-tl-none border border-white/10 bg-elevated/60 px-4 py-3 shadow-sm backdrop-blur-sm">
                    {reduceMotion ? (
                      <span className="text-xs text-muted-foreground">...</span>
                    ) : (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-steel animate-bounce [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-steel animate-bounce [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 rounded-full bg-steel animate-bounce" />
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-white/10 bg-background/60 p-3 backdrop-blur-md">
              <form
                className="relative flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Message Pezzy..."
                  className="flex-1 rounded-full border border-white/10 bg-background/50 px-4 py-2.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-steel/50 focus:bg-background focus:ring-2 focus:ring-ring/30"
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim()}
                  aria-label="Send"
                  className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-steel/60 bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                >
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trigger */}
      <motion.button
        type="button"
        whileHover={reduceMotion ? undefined : { scale: 1.05 }}
        whileTap={reduceMotion ? undefined : { scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close Ask Pezzy" : "Ask Pezzy"}
        className={cn(
          "group relative flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          open
            ? "border border-white/10 bg-elevated text-foreground"
            : "border border-steel/60 bg-primary text-primary-foreground"
        )}
      >
        <span className="absolute inset-0 -z-10 rounded-full bg-inherit opacity-20 blur-xl transition-opacity duration-300 group-hover:opacity-40" />
        {open ? <X className="h-6 w-6" /> : <MessageSquare className="h-6 w-6" />}
      </motion.button>
    </div>
  );
}
