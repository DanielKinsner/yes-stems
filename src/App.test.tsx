import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const tauriMocks = vi.hoisted(() => ({
  convertFileSrc: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  open: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: tauriMocks.convertFileSrc,
  invoke: tauriMocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: tauriMocks.listen,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: tauriMocks.open,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath: tauriMocks.openPath,
}));

describe("YES Stems app", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    tauriMocks.invoke.mockReset();
    tauriMocks.convertFileSrc.mockReset();
    tauriMocks.convertFileSrc.mockImplementation((path: string) => `asset://localhost/${path}`);
    tauriMocks.open.mockReset();
    tauriMocks.openPath.mockReset();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(() => undefined);
    vi.unstubAllGlobals();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("renders the extraction workspace without scaffold copy", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "YES Stems" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run extraction/i })).toBeDisabled();
    expect(screen.queryByText(/Welcome to Tauri/i)).not.toBeInTheDocument();
  });

  it("renders the pro workstation sections", () => {
    render(<App />);

    for (const heading of [
      "Source",
      "Output",
      "Extraction Mode",
      "Advanced",
      "Analysis",
      "Processing",
      "Results",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }

    expect(screen.getByText("6 expected stems")).toBeInTheDocument();
  });

  it("defaults to local ML six-stem expectations", () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: /Local ML 6 Stems/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("vocals.wav")).toBeInTheDocument();
    expect(screen.getByText("drums.wav")).toBeInTheDocument();
    expect(screen.getByText("bass.wav")).toBeInTheDocument();
    expect(screen.getByText("guitar.wav")).toBeInTheDocument();
    expect(screen.getByText("piano.wav")).toBeInTheDocument();
    expect(screen.getByText("other.wav")).toBeInTheDocument();
  });

  it("keeps classic DSP layer mode available", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /Classic DSP Layers/i }));

    expect(screen.getByText("vocal_foreground.wav")).toBeInTheDocument();
    expect(screen.getByText("instrumental_sum.wav")).toBeInTheDocument();
    expect(screen.getByText("drums_percussion.wav")).toBeInTheDocument();
    expect(screen.getByText("bass_band.wav")).toBeInTheDocument();
    expect(screen.getByText("harmonic_bed.wav")).toBeInTheDocument();
    expect(screen.getByText("residual.wav")).toBeInTheDocument();
  });

  it("runs extraction through Tauri commands and renders the report", async () => {
    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\song.wav")
      .mockResolvedValueOnce("C:\\renders");
    tauriMocks.invoke
      .mockResolvedValueOnce({
        fileName: "song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        peak: 0.8,
        waveformPeaks: [0.1, 0.8, 0.4],
      })
      .mockResolvedValueOnce({
        sourceName: "song",
        mode: "localMlSix",
        modeLabel: "Local ML 6 Stems",
        outputDir: "C:\\renders\\song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        reconstructionError: -1,
        methodNotes: ["Local Demucs model inference (htdemucs_6s); no cloud or API calls."],
        stems: [
          {
            name: "Vocals",
            role: "Demucs vocal stem from local offline model inference.",
            path: "C:\\renders\\song\\vocals.wav",
            frames: 132_300,
            peak: 0.5,
          },
          {
            name: "Guitar",
            role: "Experimental Demucs guitar stem.",
            path: "C:\\renders\\song\\guitar.wav",
            frames: 132_300,
            peak: 0.7,
          },
        ],
      });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Select track/i }));
    await screen.findByText("song");
    fireEvent.click(screen.getByRole("button", { name: /Choose output folder/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));

    await screen.findByRole("heading", { name: "Vocals" });
    expect(screen.getByRole("heading", { name: "Guitar" })).toBeInTheDocument();
    expect(screen.getByText("local ML output")).toBeInTheDocument();
    expect(screen.getByText(/Local Demucs model inference/i)).toBeInTheDocument();
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("extract_stems", {
      request: {
        inputPath: "C:\\music\\song.wav",
        outputDir: "C:\\renders",
        mode: "localMlSix",
        tuning: {
          aggressiveness: 5,
          artifactReduction: 5,
        },
      },
    });
  });

  it("replaces a finished source and clears stale extraction results", async () => {
    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\first.wav")
      .mockResolvedValueOnce("C:\\renders")
      .mockResolvedValueOnce("C:\\music\\second.wav");
    tauriMocks.invoke
      .mockResolvedValueOnce({
        fileName: "first",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        peak: 0.8,
        waveformPeaks: [0.2, 0.7, 0.3],
      })
      .mockResolvedValueOnce({
        sourceName: "first",
        mode: "localMlSix",
        modeLabel: "Local ML 6 Stems",
        outputDir: "C:\\renders\\first",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        reconstructionError: -1,
        methodNotes: ["finished first"],
        stems: [
          {
            name: "Vocals",
            role: "Demucs vocal stem from local offline model inference.",
            path: "C:\\renders\\first\\vocals.wav",
            frames: 132_300,
            peak: 0.5,
          },
        ],
      })
      .mockResolvedValueOnce({
        fileName: "second",
        sampleRate: 48_000,
        channels: 2,
        frames: 240_000,
        durationSeconds: 5,
        peak: 0.6,
        waveformPeaks: [0.1, 0.3, 0.9],
      });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Select track/i }));
    await screen.findByText("first");
    fireEvent.click(screen.getByRole("button", { name: /Choose output folder/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));
    await screen.findByText("1 wav stems");

    fireEvent.click(screen.getByRole("button", { name: /Replace track/i }));

    await screen.findByText("second");
    expect(screen.queryByText("1 wav stems")).not.toBeInTheDocument();
    expect(screen.getByText("6 expected stems")).toBeInTheDocument();
  });

  it("passes classic DSP tuning from enabled advanced sliders", async () => {
    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\song.wav")
      .mockResolvedValueOnce("C:\\renders");
    tauriMocks.invoke
      .mockResolvedValueOnce({
        fileName: "song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        peak: 0.8,
        waveformPeaks: [0.1, 0.8, 0.4],
      })
      .mockResolvedValueOnce({
        sourceName: "song",
        mode: "vocalInstrumental",
        modeLabel: "Classic Vocal + Instrumental",
        outputDir: "C:\\renders\\song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        reconstructionError: 0.08,
        methodNotes: ["DSP tuning used aggressiveness 8 and artifact reduction 2."],
        stems: [],
      });

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /Classic Vocal \+ Instrumental/i }));
    fireEvent.change(screen.getByLabelText("Aggressiveness"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Artifact Reduction"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Select track/i }));
    await screen.findByText("song");
    fireEvent.click(screen.getByRole("button", { name: /Choose output folder/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));

    await screen.findByText(/DSP tuning used aggressiveness 8/i);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("extract_stems", {
      request: {
        inputPath: "C:\\music\\song.wav",
        outputDir: "C:\\renders",
        mode: "vocalInstrumental",
        tuning: {
          aggressiveness: 8,
          artifactReduction: 2,
        },
      },
    });
  });

  it("auditions rendered stems through Tauri asset audio", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const addEventListener = vi.fn();
    const AudioMock = vi.fn(function MockAudio(this: HTMLAudioElement) {
      this.addEventListener = addEventListener;
      this.currentTime = 0;
      this.pause = pause;
      this.play = play;
    });
    vi.stubGlobal("Audio", AudioMock);

    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\song.wav")
      .mockResolvedValueOnce("C:\\renders");
    tauriMocks.invoke
      .mockResolvedValueOnce({
        available: true,
        runner: "demucs.exe",
        device: "cpu",
        checked: [],
        detail: "ready",
      })
      .mockResolvedValueOnce({
        fileName: "song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        peak: 0.8,
        waveformPeaks: [0.1, 0.8, 0.4],
      })
      .mockResolvedValueOnce({
        sourceName: "song",
        mode: "localMlSix",
        modeLabel: "Local ML 6 Stems",
        outputDir: "C:\\renders\\song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        reconstructionError: -1,
        methodNotes: ["Local Demucs model inference (htdemucs_6s); no cloud or API calls."],
        stems: [
          {
            name: "Vocals",
            role: "Demucs vocal stem from local offline model inference.",
            path: "C:\\renders\\song\\vocals.wav",
            frames: 132_300,
            peak: 0.5,
          },
        ],
      });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Select track/i }));
    await screen.findByText("song");
    fireEvent.click(screen.getByRole("button", { name: /Choose output folder/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));

    const playButton = await screen.findByRole("button", { name: "Play Vocals" });
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith("C:\\renders\\song\\vocals.wav");
      expect(play).toHaveBeenCalled();
    });
  });

  it("plays all rendered stems from the result action", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const addEventListener = vi.fn();
    const AudioMock = vi.fn(function MockAudio(this: HTMLAudioElement) {
      this.addEventListener = addEventListener;
      this.currentTime = 0;
      this.pause = pause;
      this.play = play;
    });
    vi.stubGlobal("Audio", AudioMock);

    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\song.wav")
      .mockResolvedValueOnce("C:\\renders");
    tauriMocks.invoke
      .mockResolvedValueOnce({
        available: true,
        runner: "demucs.exe",
        device: "cpu",
        checked: [],
        detail: "ready",
      })
      .mockResolvedValueOnce({
        fileName: "song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        peak: 0.8,
        waveformPeaks: [0.1, 0.8, 0.4],
      })
      .mockResolvedValueOnce({
        sourceName: "song",
        mode: "localMlSix",
        modeLabel: "Local ML 6 Stems",
        outputDir: "C:\\renders\\song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        reconstructionError: -1,
        methodNotes: ["Local Demucs model inference (htdemucs_6s); no cloud or API calls."],
        stems: [
          {
            name: "Vocals",
            role: "Demucs vocal stem from local offline model inference.",
            path: "C:\\renders\\song\\vocals.wav",
            frames: 132_300,
            peak: 0.5,
          },
          {
            name: "Drums",
            role: "Demucs drum stem from local offline model inference.",
            path: "C:\\renders\\song\\drums.wav",
            frames: 132_300,
            peak: 0.4,
          },
        ],
      });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Select track/i }));
    await screen.findByText("song");
    fireEvent.click(screen.getByRole("button", { name: /Choose output folder/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Play All" }));

    await waitFor(() => {
      expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith("C:\\renders\\song\\vocals.wav");
      expect(play).toHaveBeenCalled();
    });
  });
});
