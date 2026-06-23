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
      "Extraction Mode",
      "Advanced",
      "Analysis",
      "Processing",
      "Results",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }

    expect(screen.getByText("6 expected stems")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export All/i })).toBeDisabled();
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
      .mockResolvedValueOnce("C:\\music\\song.wav");
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
        mode: "localMlSix",
        tuning: {
          aggressiveness: 5,
          artifactReduction: 5,
        },
        cleanup: {
          enabled: true,
          strength: 4,
        },
      },
    });
  });

  it("replaces a finished source and clears stale extraction results", async () => {
    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\first.wav")
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
      .mockResolvedValueOnce("C:\\music\\song.wav");
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
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));

    await screen.findByText(/DSP tuning used aggressiveness 8/i);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("extract_stems", {
      request: {
        inputPath: "C:\\music\\song.wav",
        mode: "vocalInstrumental",
        tuning: {
          aggressiveness: 8,
          artifactReduction: 2,
        },
        cleanup: {
          enabled: true,
          strength: 4,
        },
      },
    });
  });

  it("passes stem cleanup options from advanced controls", async () => {
    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\song.wav");
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
        methodNotes: ["cleanup disabled by request"],
        stems: [],
      });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Cleanup Strength"), { target: { value: "7" } });
    fireEvent.click(screen.getByLabelText(/Clean Up Stems/i));
    fireEvent.click(screen.getByRole("button", { name: /Select track/i }));
    await screen.findByText("song");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));

    await screen.findByText(/cleanup disabled/i);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("extract_stems", {
      request: {
        inputPath: "C:\\music\\song.wav",
        mode: "localMlSix",
        tuning: {
          aggressiveness: 5,
          artifactReduction: 5,
        },
        cleanup: {
          enabled: false,
          strength: 7,
        },
      },
    });
  });

  it("updates timeline selection without pointer capture APIs", async () => {
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    tauriMocks.invoke.mockResolvedValueOnce({
      fileName: "song",
      sampleRate: 44_100,
      channels: 2,
      frames: 441_000,
      durationSeconds: 10,
      peak: 0.8,
      waveformPeaks: [0.1, 0.8, 0.4, 0.7],
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Select track/i }));
    await screen.findByText("song");
    const overview = screen.getByLabelText("Audio overview selection");
    overview.getBoundingClientRect = vi.fn(() => ({
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));

    fireEvent.pointerDown(overview, { clientX: 10, pointerId: 1 });
    fireEvent.pointerMove(overview, { clientX: 60, pointerId: 1 });
    fireEvent.pointerUp(overview, { clientX: 60, pointerId: 1 });

    expect(screen.getByText("0:01.00 - 0:06.00")).toBeInTheDocument();
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
      .mockResolvedValueOnce("C:\\music\\song.wav");
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
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));

    await screen.findByText("1 wav stems");
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
      .mockResolvedValueOnce("C:\\music\\song.wav");
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
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));
    await screen.findByText("2 wav stems");
    fireEvent.click(await screen.findByRole("button", { name: "Play All" }));

    await waitFor(() => {
      expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith("C:\\renders\\song\\vocals.wav");
      expect(play).toHaveBeenCalled();
    });
  });

  it("exports completed stems to a chosen folder", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\song.wav")
      .mockResolvedValueOnce("D:\\exports");
    tauriMocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "check_local_ml_runtime") {
        return Promise.resolve({
          available: true,
          runner: "demucs.exe",
          device: "cpu",
          checked: [],
          detail: "ready",
        });
      }

      if (command === "analyze_track") {
        return Promise.resolve({
          fileName: "song",
          sampleRate: 44_100,
          channels: 2,
          frames: 132_300,
          durationSeconds: 3,
          peak: 0.8,
          waveformPeaks: [0.1, 0.8, 0.4],
        });
      }

      if (command === "extract_stems") {
        return Promise.resolve({
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
      }

      if (command === "export_stems") {
        expect(args).toEqual({
          request: {
            sourceName: "song",
            destinationRoot: "D:\\exports",
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
          },
        });
        return Promise.resolve({
          exportDir: "D:\\exports\\song",
          exportedFiles: 2,
        });
      }

      return Promise.reject(new Error(`Unexpected command ${command}`));
    });

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /Select track/i }));
    await screen.findByText("song");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run extraction/i })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /Run extraction/i }));

    await screen.findByRole("heading", { name: "Vocals" });
    fireEvent.click(screen.getByRole("button", { name: /Export All/i }));

    await waitFor(() => {
      expect(tauriMocks.openPath).toHaveBeenCalledWith("D:\\exports\\song");
      expect(screen.getByText(/Exported 2 files/i)).toBeInTheDocument();
    });
  });
});
