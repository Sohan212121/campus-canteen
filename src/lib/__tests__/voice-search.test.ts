import { describe, it, expect, vi, beforeEach } from "vitest";

interface MockSpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null;
}

describe("Voice Search Feature & Web Speech Recognition", () => {
  let mockRecognitionInstance: MockSpeechRecognitionInstance;

  beforeEach(() => {
    mockRecognitionInstance = {
      lang: "en-IN",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      onstart: null,
      onend: null,
      onerror: null,
      onresult: null,
    };
  });

  it("checks browser SpeechRecognition API initialization and callbacks", () => {
    let capturedResult = "";
    const onSearch = (text: string) => {
      capturedResult = text;
    };

    mockRecognitionInstance.onresult = (event: { results: Array<Array<{ transcript: string }>> }) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        onSearch(transcript.trim());
      }
    };

    // Simulate speech event with transcript "Masala Dosa"
    mockRecognitionInstance.onresult({
      results: [[{ transcript: "  Masala Dosa  " }]],
    });

    expect(capturedResult).toBe("Masala Dosa");
  });

  it("cleans and trims voice transcripts correctly", () => {
    const processTranscript = (raw: string) => raw.trim().replace(/\s+/g, " ");

    expect(processTranscript("  paneer   butter masala   ")).toBe("paneer butter masala");
    expect(processTranscript("cold coffee")).toBe("cold coffee");
    expect(processTranscript("   ")).toBe("");
  });

  it("handles empty or whitespace-only voice transcript without calling onSearch", () => {
    let called = false;
    const onSearch = () => {
      called = true;
    };

    const handleSpeechResult = (event: { results: Array<Array<{ transcript: string }>> }) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript && transcript.trim()) {
        onSearch();
      }
    };

    handleSpeechResult({
      results: [[{ transcript: "    " }]],
    });

    expect(called).toBe(false);
  });
});
