"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  User,
  Bell,
  PlayCircle,
  Languages,
  ShieldCheck,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { entranceTransition } from "@/lib/motion";
import { Button } from "@/components/ui/button";
import {
  SettingsSection,
  SettingsCard,
  SettingRow,
  Toggle,
  SelectRow,
  TextInput,
} from "@/components/ui/settings-controls";
import { AvatarStudio } from "@/components/ui/avatar-studio";
import {
  DEFAULT_SUBTITLE_LANGUAGE_ORDER,
  SUBTITLE_LANGUAGES,
} from "@/lib/subtitle-languages";

type SectionId =
  | "profile"
  | "playback"
  | "language"
  | "privacy"
  | "notifications"
  | "about";

const NAV_GROUPS: {
  label: string;
  items: { id: SectionId; label: string; icon: typeof User }[];
}[] = [
  {
    label: "Account",
    items: [
      { id: "profile", label: "Profile", icon: User },
      { id: "notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Preferences",
    items: [
      { id: "playback", label: "Playback", icon: PlayCircle },
      { id: "language", label: "Language & Subtitles", icon: Languages },
    ],
  },
  {
    label: "Privacy",
    items: [{ id: "privacy", label: "Privacy & Data", icon: ShieldCheck }],
  },
  {
    label: "General",
    items: [{ id: "about", label: "About", icon: Info }],
  },
];

const AUDIO_OPTIONS: { value: "ask" | "sub" | "dub"; label: string }[] = [
  { value: "ask", label: "Ask me each time" },
  { value: "sub", label: "Subtitled" },
  { value: "dub", label: "Dubbed" },
];

// Every /api/settings/* route follows the same { [key]: value } GET/PUT
// shape, so the load-on-mount and save-on-change calls below share these
// two helpers instead of repeating the fetch boilerplate per setting.
async function fetchSetting<T>(
  url: string,
  key: string
): Promise<T | undefined> {
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const result = (await response.json()) as Record<string, unknown> | null;
  return result?.[key] as T | undefined;
}

function putSetting(url: string, key: string, value: unknown) {
  return fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  });
}

export default function SettingsPage() {
  const shouldReduceMotion = useReducedMotion();
  const [activeSection, setActiveSection] = useState<SectionId>("profile");

  // TODO: persist to server
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [maturityRating, setMaturityRating] = useState("All");
  const [showAvatarStudio, setShowAvatarStudio] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState("");

  const [autoplayNext, setAutoplayNext] = useState(true);
  const [autoplayPreviews, setAutoplayPreviews] = useState(true);
  const [reduceMotion, setReduceMotionSetting] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  const [videoQuality, setVideoQuality] = useState("Auto");
  const [autoSkipIntro, setAutoSkipIntroState] = useState(false);
  const [preferredAudio, setPreferredAudioState] = useState<
    "ask" | "sub" | "dub"
  >("ask");

  const [appLanguage, setAppLanguage] = useState("English");
  const [subtitleLanguage, setSubtitleLanguage] = useState("English");
  const [aiTranslation, setAiTranslation] = useState(true);
  const [subtitleSize, setSubtitleSize] = useState("Medium");
  const [alwaysGenerateSubtitles, setAlwaysGenerateSubtitlesState] =
    useState(false);
  const [preferredSubtitleLanguages, setPreferredSubtitleLanguages] = useState<
    string[]
  >([...DEFAULT_SUBTITLE_LANGUAGE_ORDER]);

  const [personalizedRows, setPersonalizedRows] = useState(true);
  const [askPezzy, setAskPezzy] = useState(true);
  const [useWatchHistory, setUseWatchHistory] = useState(true);
  const [talkToHomepage, setTalkToHomepage] = useState(true);

  const [faceAvatarGeneration, setFaceAvatarGeneration] = useState(false);
  const [personalizedAds, setPersonalizedAds] = useState(false);

  const [newEpisodes, setNewEpisodes] = useState(true);
  const [recommendations, setRecommendations] = useState(true);
  const [productNews, setProductNews] = useState(false);
  const [emailNotifications, setEmailNotifications] = useState(true);

  useEffect(() => {
    void fetchSetting<string[]>(
      "/api/settings/subtitle-languages",
      "languages"
    ).then((languages) => {
      if (languages?.length) setPreferredSubtitleLanguages(languages);
    });
    void fetchSetting<boolean>(
      "/api/settings/auto-skip-intro",
      "autoSkipIntro"
    ).then((value) => {
      if (typeof value === "boolean") setAutoSkipIntroState(value);
    });
    void fetchSetting<"ask" | "sub" | "dub">(
      "/api/settings/preferred-audio",
      "preferredAudio"
    ).then((value) => {
      if (value) setPreferredAudioState(value);
    });
    void fetchSetting<boolean>(
      "/api/settings/always-generate-subtitles",
      "alwaysGenerateSubtitles"
    ).then((value) => {
      if (typeof value === "boolean") setAlwaysGenerateSubtitlesState(value);
    });
  }, []);

  const handleAutoSkipIntroChange = (value: boolean) => {
    setAutoSkipIntroState(value);
    void putSetting("/api/settings/auto-skip-intro", "autoSkipIntro", value);
  };

  const handlePreferredAudioChange = (value: "ask" | "sub" | "dub") => {
    setPreferredAudioState(value);
    void putSetting("/api/settings/preferred-audio", "preferredAudio", value);
  };

  const handleAlwaysGenerateSubtitlesChange = (value: boolean) => {
    setAlwaysGenerateSubtitlesState(value);
    void putSetting(
      "/api/settings/always-generate-subtitles",
      "alwaysGenerateSubtitles",
      value
    );
  };

  const moveSubtitleLanguage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= preferredSubtitleLanguages.length) return;
    const next = [...preferredSubtitleLanguages];
    [next[index], next[target]] = [next[target], next[index]];
    setPreferredSubtitleLanguages(next);
    void putSetting("/api/settings/subtitle-languages", "languages", next);
  };

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-[230px] shrink-0 flex-col gap-8 border-r border-white/10 px-4 py-8 md:flex">
        <div className="flex items-center gap-2 px-2">
          <Link
            href="/hub"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="text-sm font-semibold text-foreground">Settings</span>
        </div>

        <nav className="flex flex-col gap-6">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      isActive
                        ? "bg-white/[0.06] font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-12 md:py-12 lg:px-16">
        <div className="mx-auto mb-8 flex w-full max-w-[680px] items-center gap-3 md:hidden">
          <Link
            href="/hub"
            aria-label="Back to home"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <label htmlFor="settings-section" className="sr-only">
            Settings section
          </label>
          <select
            id="settings-section"
            value={activeSection}
            onChange={(event) => setActiveSection(event.target.value as SectionId)}
            className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            {NAV_GROUPS.flatMap((group) =>
              group.items.map((item) => (
                <option key={item.id} value={item.id} className="bg-card text-foreground">
                  {item.label}
                </option>
              ))
            )}
          </select>
        </div>
        <motion.div
          key={activeSection}
          initial={shouldReduceMotion ? undefined : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={entranceTransition}
          className="mx-auto w-full max-w-[680px]"
        >
          {activeSection === "profile" ? (
            <SettingsSection
              title="Profile"
              description="Your name, avatar, and account basics. Changes apply across Pezzy."
            >
              <div className="space-y-8">
                <SettingsCard>
                  <div className="flex flex-col gap-4 border-b border-white/[0.06] py-5">
                    <span className="text-sm font-medium text-foreground">
                      Profile picture
                    </span>
                    <div className="flex flex-wrap items-center gap-4">
                      {avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarUrl}
                          alt="Profile avatar"
                          className="h-16 w-16 rounded-full object-cover ring-1 ring-white/10"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
                          <User className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => setShowAvatarStudio((v) => !v)}
                          >
                            Change picture
                          </Button>
                          {avatarUrl ? (
                            <Button variant="ghost" onClick={() => setAvatarUrl("")}>
                              Remove
                            </Button>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Pick from the gallery, upload a photo, or try the AI generator.
                        </p>
                      </div>
                    </div>
                    {showAvatarStudio ? (
                      <AvatarStudio
                        profileId="local"
                        initialAvatar={avatarUrl}
                        showNameField={false}
                        onComplete={(url: string) => setAvatarUrl(url)}
                      />
                    ) : null}
                  </div>

                  <SettingRow label="Display name">
                    <TextInput
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </SettingRow>
                  <SettingRow label="Primary email">
                    <TextInput
                      type="text"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </SettingRow>
                  <SettingRow label="Maturity rating">
                    <SelectRow
                      value={maturityRating}
                      onChange={setMaturityRating}
                      options={["All", "Teen", "Mature"]}
                    />
                  </SettingRow>
                </SettingsCard>
              </div>
            </SettingsSection>
          ) : null}

          {activeSection === "playback" ? (
            <SettingsSection
              title="Playback"
              description="Control autoplay, quality, and the personalization that shapes your homepage."
            >
              <div className="space-y-8">
                <SettingsCard>
                  <SettingRow label="Autoplay next episode">
                    <Toggle
                      checked={autoplayNext}
                      onChange={setAutoplayNext}
                      label="Autoplay next episode"
                    />
                  </SettingRow>
                  <SettingRow label="Autoplay previews while browsing">
                    <Toggle
                      checked={autoplayPreviews}
                      onChange={setAutoplayPreviews}
                      label="Autoplay previews while browsing"
                    />
                  </SettingRow>
                  <SettingRow label="Reduce motion">
                    <Toggle
                      checked={reduceMotion}
                      onChange={setReduceMotionSetting}
                      label="Reduce motion"
                    />
                  </SettingRow>
                  <SettingRow label="Data saver">
                    <Toggle
                      checked={dataSaver}
                      onChange={setDataSaver}
                      label="Data saver"
                    />
                  </SettingRow>
                  <SettingRow label="Default video quality">
                    <SelectRow
                      value={videoQuality}
                      onChange={setVideoQuality}
                      options={["Auto", "480p", "720p", "1080p", "4K"]}
                    />
                  </SettingRow>
                  <SettingRow
                    label="Automatically skip intros"
                    description="Skip the opening as soon as it starts. Off shows a Skip Intro button instead."
                  >
                    <Toggle
                      checked={autoSkipIntro}
                      onChange={handleAutoSkipIntroChange}
                      label="Automatically skip intros"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Preferred audio"
                    description="Skip the sub/dub picker every time you start something."
                  >
                    <SelectRow
                      value={
                        AUDIO_OPTIONS.find((option) => option.value === preferredAudio)
                          ?.label ?? AUDIO_OPTIONS[0].label
                      }
                      onChange={(label) => {
                        const option = AUDIO_OPTIONS.find((item) => item.label === label);
                        handlePreferredAudioChange(option?.value ?? "ask");
                      }}
                      options={AUDIO_OPTIONS.map((option) => option.label)}
                    />
                  </SettingRow>
                </SettingsCard>

                <SettingsCard>
                  <SettingRow
                    label="Personalized rows"
                    description="Build homepage rows from your taste."
                  >
                    <Toggle
                      checked={personalizedRows}
                      onChange={setPersonalizedRows}
                      label="Personalized rows"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Talk to your homepage"
                    description="Turn a prompt into a new row on the fly."
                  >
                    <Toggle
                      checked={talkToHomepage}
                      onChange={setTalkToHomepage}
                      label="Talk to your homepage"
                    />
                  </SettingRow>
                  <SettingRow label="Ask Pezzy assistant">
                    <Toggle
                      checked={askPezzy}
                      onChange={setAskPezzy}
                      label="Ask Pezzy assistant"
                    />
                  </SettingRow>
                </SettingsCard>
              </div>
            </SettingsSection>
          ) : null}

          {activeSection === "language" ? (
            <SettingsSection
              title="Language & Subtitles"
              description="Set your interface language and how subtitles are displayed and generated."
            >
              <div className="space-y-8">
                <SettingsCard>
                  <SettingRow label="App language">
                    <SelectRow
                      value={appLanguage}
                      onChange={setAppLanguage}
                      options={[
                        "English",
                        "Español",
                        "日本語",
                        "Français",
                        "Deutsch",
                      ]}
                    />
                  </SettingRow>
                  <SettingRow label="Subtitle language">
                    <SelectRow
                      value={subtitleLanguage}
                      onChange={setSubtitleLanguage}
                      options={["Off", "English", "Español", "日本語"]}
                    />
                  </SettingRow>
                  <SettingRow
                    label="AI on-demand translation"
                    description="Generate subtitles in your language on the fly when an official track is missing."
                  >
                    <Toggle
                      checked={aiTranslation}
                      onChange={setAiTranslation}
                      label="AI on-demand translation"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Always generate subtitles"
                    description="Start local Whisper transcription and AI translation as soon as playback begins, instead of waiting for you to ask."
                  >
                    <Toggle
                      checked={alwaysGenerateSubtitles}
                      onChange={handleAlwaysGenerateSubtitlesChange}
                      label="Always generate subtitles"
                    />
                  </SettingRow>
                  <SettingRow label="Subtitle size">
                    <SelectRow
                      value={subtitleSize}
                      onChange={setSubtitleSize}
                      options={["Small", "Medium", "Large"]}
                    />
                  </SettingRow>
                  <div className="py-5">
                    <div className="mb-3">
                      <p className="text-sm font-medium text-foreground">
                        Translation priority
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Languages at the top are translated and shown first.
                      </p>
                    </div>
                    <ol className="space-y-1.5">
                      {preferredSubtitleLanguages.map((code, index) => {
                        const language = SUBTITLE_LANGUAGES.find(
                          (item) => item.code === code
                        );
                        if (!language) return null;
                        return (
                          <li
                            key={code}
                            className="flex min-h-11 items-center gap-3 rounded-lg bg-white/[0.035] px-3"
                          >
                            <span className="w-5 text-xs tabular-nums text-muted-foreground">
                              {index + 1}
                            </span>
                            <span
                              lang={code}
                              className="min-w-0 flex-1 text-sm text-foreground"
                            >
                              {language.name}
                            </span>
                            <button
                              type="button"
                              onClick={() => moveSubtitleLanguage(index, -1)}
                              disabled={index === 0}
                              aria-label={`Move ${language.name} earlier`}
                              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-25"
                            >
                              <ChevronUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveSubtitleLanguage(index, 1)}
                              disabled={
                                index === preferredSubtitleLanguages.length - 1
                              }
                              aria-label={`Move ${language.name} later`}
                              className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:opacity-25"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </SettingsCard>
              </div>
            </SettingsSection>
          ) : null}

          {activeSection === "privacy" ? (
            <SettingsSection
              title="Privacy & Data"
              description="Decide what Pezzy can use to personalize your experience, and manage your data."
            >
              <div className="space-y-8">
                <SettingsCard>
                  <SettingRow
                    label="Use my watch history"
                    description="Lets recommendations and rows draw on what you've watched."
                  >
                    <Toggle
                      checked={useWatchHistory}
                      onChange={setUseWatchHistory}
                      label="Use my watch history"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Allow face-photo avatar generation"
                    description="Required to turn a selfie into an anime avatar. Your photo is processed for generation only and never stored."
                  >
                    <Toggle
                      checked={faceAvatarGeneration}
                      onChange={setFaceAvatarGeneration}
                      label="Allow face-photo avatar generation"
                    />
                  </SettingRow>
                  <SettingRow label="Personalized ads">
                    <Toggle
                      checked={personalizedAds}
                      onChange={setPersonalizedAds}
                      label="Personalized ads"
                    />
                  </SettingRow>
                  <SettingRow
                    label="Download my data"
                    description="Export a copy of your profile, ratings, and watch history."
                  >
                    <Button variant="secondary">Download</Button>
                  </SettingRow>
                </SettingsCard>

                <SettingsCard className="border-red-500/20 bg-red-500/[0.03]">
                  <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-foreground">
                        Delete my face data
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Removes any stored biometric data used for avatar
                        generation. This cannot be undone.
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0 border-red-500/30 text-red-400 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                    >
                      Delete face data
                    </Button>
                  </div>
                </SettingsCard>
              </div>
            </SettingsSection>
          ) : null}

          {activeSection === "notifications" ? (
            <SettingsSection
              title="Notifications"
              description="Choose what Pezzy notifies you about and where."
            >
              <div className="space-y-8">
                <SettingsCard>
                  <SettingRow label="New episodes">
                    <Toggle
                      checked={newEpisodes}
                      onChange={setNewEpisodes}
                      label="New episodes"
                    />
                  </SettingRow>
                  <SettingRow label="Recommendations">
                    <Toggle
                      checked={recommendations}
                      onChange={setRecommendations}
                      label="Recommendations"
                    />
                  </SettingRow>
                  <SettingRow label="Product news">
                    <Toggle
                      checked={productNews}
                      onChange={setProductNews}
                      label="Product news"
                    />
                  </SettingRow>
                  <SettingRow label="Email notifications">
                    <Toggle
                      checked={emailNotifications}
                      onChange={setEmailNotifications}
                      label="Email notifications"
                    />
                  </SettingRow>
                </SettingsCard>
              </div>
            </SettingsSection>
          ) : null}

          {activeSection === "about" ? (
            <SettingsSection
              title="About"
              description="App information, legal, and account access."
            >
              <div className="space-y-8">
                <SettingsCard>
                  <SettingRow label="App version">
                    <span className="text-sm text-muted-foreground">0.2.0</span>
                  </SettingRow>
                  <SettingRow label="Terms of Service">
                    <a
                      href="#"
                      className="text-sm text-accent-blue-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      View
                    </a>
                  </SettingRow>
                  <SettingRow label="Privacy Policy">
                    <a
                      href="#"
                      className="text-sm text-accent-blue-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      View
                    </a>
                  </SettingRow>
                </SettingsCard>

                <SettingsCard className="border-red-500/20 bg-red-500/[0.03]">
                  <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium text-foreground">
                        Sign out
                      </span>
                      <span className="text-xs text-muted-foreground">
                        End your session on this device.
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      className="shrink-0 border-red-500/30 text-red-400 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                    >
                      Sign out
                    </Button>
                  </div>
                </SettingsCard>
              </div>
            </SettingsSection>
          ) : null}
        </motion.div>
      </main>
    </div>
  );
}
