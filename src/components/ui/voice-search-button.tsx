"use client";

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from "react";
import { Mic } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { hasAcknowledgedVoiceNotice, acknowledgeVoiceNotice } from "@/lib/search/search-helpers";

interface SpeechRecognitionResultItem {
  transcript: string;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResultItem[];
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

const emptySubscribe = () => () => {};

export interface VoiceSearchButtonProps {
  onSearch: (transcript: string) => void;
  className?: string;
  size?: "sm" | "md";
  lang?: string;
}

export function VoiceSearchButton({
  onSearch,
  className,
  size = "md",
  lang = "en-IN",
}: VoiceSearchButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const isSupported = useSyncExternalStore(
    emptySubscribe,
    () => Boolean(getSpeechRecognitionConstructor()),
    () => true
  );
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const stopListening = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors if already stopped
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const toggleListening = () => {
    const SpeechRecognitionClass = getSpeechRecognitionConstructor();

    if (!SpeechRecognitionClass) {
      toast.info("Voice search is not supported in this browser. Please type to search.");
      return;
    }

    if (isListening) {
      stopListening();
      toast.dismiss("voice-search-toast");
      return;
    }

    // First use notice
    if (!hasAcknowledgedVoiceNotice()) {
      toast.info("Voice search uses your browser's speech service.", {
        id: "voice-search-ack-toast",
        duration: 3500,
      });
      acknowledgeVoiceNotice();
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      // 10-second automatic safety timeout
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        if (recognitionRef.current) {
          stopListening();
          toast.info("Voice search timed out. Speak again or type to search.", { id: "voice-search-toast" });
        }
      }, 10000);

      recognition.onstart = () => {
        setIsListening(true);
        toast.info("Listening...", {
          id: "voice-search-toast",
          description: "Speak clearly into your microphone",
          duration: 4000,
        });
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        const transcript = event.results?.[0]?.[0]?.transcript;
        if (transcript && transcript.trim()) {
          const cleaned = transcript.trim();
          onSearch(cleaned);
          toast.success(`Voice search: "${cleaned}"`, {
            id: "voice-search-toast",
            duration: 2500,
          });
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        setIsListening(false);
        if (event.error === "no-speech") {
          toast.info("No speech detected. Please try again.", { id: "voice-search-toast" });
        } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          toast.error("Microphone access denied. Please allow microphone permissions in your browser.", { id: "voice-search-toast" });
        } else {
          toast.error("Could not capture speech. Please try again or type to search.", { id: "voice-search-toast" });
        }
      };

      recognition.onend = () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      toast.error("Unable to start voice search. Please try again.");
    }
  };

  const isSmall = size === "sm";

  return (
    <button
      type="button"
      onClick={toggleListening}
      aria-label={isListening ? "Stop listening to voice" : "Voice search"}
      title={
        isListening
          ? "Listening... Click to stop"
          : isSupported
          ? "Voice search"
          : "Voice search not supported in this browser"
      }
      className={cn(
        "relative flex items-center justify-center rounded-full transition-all cursor-pointer active:scale-95 select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-500 shadow-xs",
        isSmall ? "h-6 w-6" : "h-7 w-7 sm:h-8 sm:w-8",
        isListening
          ? "bg-black text-red-500 border border-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]"
          : "bg-black text-red-500 hover:bg-black/85 hover:scale-105 border border-black/80 dark:border-[#222533]",
        className
      )}
    >
      {isListening ? (
        <>
          <span className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
          <Mic className={isSmall ? "h-3.5 w-3.5 text-red-500" : "h-4 w-4 text-red-500"} />
        </>
      ) : (
        <Mic className={isSmall ? "h-3.5 w-3.5 text-red-500" : "h-4 w-4 text-red-500"} />
      )}
    </button>
  );
}
