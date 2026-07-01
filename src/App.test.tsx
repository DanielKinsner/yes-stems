import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

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

const RUNTIME_READY = {
  available: true,
  runner: "demucs.exe",
  device: "cpu",
  checked: [],
  detail: "ready",
};

const sixStemReport = {
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
      bytes: 103_000_000,
    },
    {
      name: "Guitar",
      role: "Experimental Demucs guitar stem.",
      path: "C:\\renders\\song\\guitar.wav",
      frames: 132_300,
      peak: 0.7,
      bytes: 71_000_000,
    },
  ],
};

const analysisFor = (fileName: string, overrides: Record<string, unknown> = {}) => ({
  fileName,
  sampleRate: 44_100,
  channels: 2,
  frames: 132_300,
  durationSeconds: 3,
  peak: 0.8,
  waveformPeaks: [0.1, 0.8, 0.4],
  ...overrides,
});

function withTauri() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
}

function stubAudio() {
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
  return { play, pause };
}

type InvokeSetup = {
  analysis?: unknown;
  analyses?: unknown[];
  report?: unknown;
  exportResult?: unknown;
  onExport?: (args: unknown) => void;
};

function setupInvoke({ analysis, analyses, report, exportResult, onExport }: InvokeSetup) {
  let analyzeCall = 0;
  tauriMocks.invoke.mockImplementation((command: string, args?: unknown) => {
    switch (command) {
      case "check_local_ml_runtime":
        return Promise.resolve(RUNTIME_READY);
      case "analyze_track": {
        const next = analyses ? analyses[Math.min(analyzeCall, analyses.length - 1)] : analysis;
        analyzeCall += 1;
        return Promise.resolve(next);
      }
      case "extract_stems":
        return Promise.resolve(report);
      case "export_stems":
        onExport?.(args);
        return Promise.resolve(exportResult ?? { exportDir: "D:\\exports\\song", exportedFiles: 2 });
      default:
        return Promise.reject(new Error(`Unexpected command ${command}`));
    }
  });
}

async function selectSourceAndArm() {
  fireEvent.click(screen.getByRole("button", { name: /Change File/i }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /Run Extraction/i })).toBeEnabled();
  });
}

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
    window.localStorage.clear();
  });

  it("renders the extraction workspace without scaffold copy", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "YES Stems" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run Extraction/i })).toBeDisabled();
    expect(screen.queryByText(/Welcome to Tauri/i)).not.toBeInTheDocument();
  });

  it("renders the workstation sections", () => {
    render(<App />);

    for (const heading of ["Options", "Stems Preview", "Extraction Report", "What Was Written", "Notes"]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }

    expect(screen.getByRole("button", { name: /Export All Stems/i })).toBeDisabled();
  });

  it("defaults to local ML six-stem expectations", () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: /Local ML 6 Stems/i })).toHaveAttribute("aria-selected", "true");
    for (const file of ["vocals.wav", "drums.wav", "bass.wav", "guitar.wav", "piano.wav", "other.wav"]) {
      expect(screen.getByText(file)).toBeInTheDocument();
    }
  });

  it("keeps classic DSP layer mode available", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /Classic DSP Layers/i }));

    for (const file of [
      "vocal_foreground.wav",
      "instrumental_sum.wav",
      "drums_percussion.wav",
      "bass_band.wav",
      "harmonic_bed.wav",
      "residual.wav",
    ]) {
      expect(screen.getByText(file)).toBeInTheDocument();
    }
  });

  it("runs extraction through Tauri commands and renders the report", async () => {
    withTauri();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    setupInvoke({ analysis: analysisFor("song"), report: sixStemReport });

    render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));

    // The written-files panel shows real, formatted sizes once the report lands.
    await screen.findByText("98.2 MB");
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("extract_stems", {
      request: {
        inputPath: "C:\\music\\song.wav",
        mode: "localMlSix",
        tuning: { aggressiveness: 5, artifactReduction: 5 },
        cleanup: { enabled: true, strength: 5 },
      },
    });
  });

  it("replaces a finished source and clears stale extraction results", async () => {
    withTauri();
    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\first.wav")
      .mockResolvedValueOnce("C:\\music\\second.wav");
    setupInvoke({
      analyses: [analysisFor("first"), analysisFor("second", { sampleRate: 48_000, durationSeconds: 5 })],
      report: { ...sixStemReport, sourceName: "first", outputDir: "C:\\renders\\first" },
    });

    render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));
    await screen.findByText("98.2 MB");

    fireEvent.click(screen.getByRole("button", { name: /Change File/i }));

    await waitFor(() => {
      expect(screen.getAllByText("second").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText("98.2 MB")).not.toBeInTheDocument();
    expect(screen.getByText("piano.wav")).toBeInTheDocument();
  });

  it("passes classic DSP tuning from enabled advanced sliders", async () => {
    withTauri();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    setupInvoke({
      analysis: analysisFor("song"),
      report: {
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
      },
    });

    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /Classic Vocal \+ Instrumental/i }));
    fireEvent.change(screen.getByLabelText("Aggressiveness"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Artifact Reduction"), { target: { value: "2" } });
    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));

    // The method note surfaces in both the left hint and the right notes panel.
    expect((await screen.findAllByText(/DSP tuning used aggressiveness 8/i)).length).toBeGreaterThan(0);
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("extract_stems", {
      request: {
        inputPath: "C:\\music\\song.wav",
        mode: "vocalInstrumental",
        tuning: { aggressiveness: 8, artifactReduction: 2 },
        cleanup: { enabled: true, strength: 5 },
      },
    });
  });

  it("passes stem cleanup options from advanced controls", async () => {
    withTauri();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    setupInvoke({ analysis: analysisFor("song"), report: sixStemReport });

    render(<App />);

    fireEvent.change(screen.getByLabelText("Cleanup Strength"), { target: { value: "70" } });
    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));

    await screen.findByText("98.2 MB");
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("extract_stems", {
      request: {
        inputPath: "C:\\music\\song.wav",
        mode: "localMlSix",
        tuning: { aggressiveness: 5, artifactReduction: 5 },
        cleanup: { enabled: true, strength: 7 },
      },
    });
  });

  it("updates the overview selection from pointer drags", async () => {
    withTauri();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    setupInvoke({
      analysis: analysisFor("song", { frames: 441_000, durationSeconds: 10, waveformPeaks: [0.1, 0.8, 0.4, 0.7] }),
    });

    const { container } = render(<App />);

    await selectSourceAndArm();
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

    const selection = container.querySelector(".selection-range") as HTMLElement;
    expect(selection).not.toBeNull();
    expect(selection.style.left).toBe("10%");
    expect(selection.style.width).toBe("50%");
  });

  it("auditions a stem through Tauri asset audio when soloed", async () => {
    withTauri();
    const { play } = stubAudio();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    setupInvoke({ analysis: analysisFor("song"), report: sixStemReport });

    render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));
    await screen.findByText("98.2 MB");

    fireEvent.click(await screen.findByRole("button", { name: "Solo Vocals" }));

    await waitFor(() => {
      expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith("C:\\renders\\song\\vocals.wav");
      expect(play).toHaveBeenCalled();
    });
  });

  it("plays rendered stems from the transport", async () => {
    withTauri();
    const { play } = stubAudio();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    setupInvoke({ analysis: analysisFor("song"), report: sixStemReport });

    render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));
    await screen.findByText("98.2 MB");

    fireEvent.click(await screen.findByRole("button", { name: "Play preview" }));

    await waitFor(() => {
      expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith("C:\\renders\\song\\vocals.wav");
      expect(play).toHaveBeenCalled();
    });
  });

  it("seeks playback when the scrubber is clicked", async () => {
    withTauri();
    const { play } = stubAudio();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    setupInvoke({ analysis: analysisFor("song"), report: sixStemReport });

    const { container } = render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));
    await screen.findByText("98.2 MB");

    fireEvent.click(await screen.findByRole("button", { name: "Play preview" }));
    await waitFor(() => expect(play).toHaveBeenCalled());

    const scrub = container.querySelector(".scrub") as HTMLElement;
    scrub.getBoundingClientRect = () => ({
      left: 0,
      width: 100,
      top: 0,
      right: 100,
      bottom: 6,
      height: 6,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(scrub, { clientX: 50, pointerId: 1 });

    const knob = container.querySelector(".scrub .knob") as HTMLElement;
    expect(knob.style.left).toBe("50%");
  });

  it("exports completed stems to a chosen folder", async () => {
    withTauri();
    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\song.wav")
      .mockResolvedValueOnce("D:\\exports");
    const onExport = vi.fn();
    setupInvoke({ analysis: analysisFor("song"), report: sixStemReport, onExport });

    render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));
    await screen.findByText("98.2 MB");

    fireEvent.click(screen.getByRole("button", { name: /Export All Stems/i }));

    await waitFor(() => {
      expect(tauriMocks.openPath).toHaveBeenCalledWith("D:\\exports\\song");
      expect(screen.getByText(/Exported 2 files/i)).toBeInTheDocument();
    });
    expect(onExport).toHaveBeenCalledWith({
      request: {
        sourceName: "song",
        destinationRoot: "D:\\exports",
        stems: sixStemReport.stems,
        format: "wav24",
      },
    });
  });

  it("exports in a chosen format (16-bit)", async () => {
    withTauri();
    tauriMocks.open
      .mockResolvedValueOnce("C:\\music\\song.wav")
      .mockResolvedValueOnce("D:\\exports");
    const onExport = vi.fn();
    setupInvoke({ analysis: analysisFor("song"), report: sixStemReport, onExport });

    render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));
    await screen.findByText("98.2 MB");

    fireEvent.change(screen.getByLabelText("Export format"), { target: { value: "wav16" } });
    fireEvent.click(screen.getByRole("button", { name: /Export All Stems/i }));

    await waitFor(() => {
      expect(onExport).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({ format: "wav16" }),
        }),
      );
    });
  });

  it("cancels an in-flight extraction with the Stop button", async () => {
    withTauri();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav");
    // extract_stems never resolves, so the UI stays in the extracting state.
    tauriMocks.invoke.mockImplementation((command: string) => {
      switch (command) {
        case "check_local_ml_runtime":
          return Promise.resolve(RUNTIME_READY);
        case "analyze_track":
          return Promise.resolve(analysisFor("song"));
        case "extract_stems":
          return new Promise(() => {});
        case "cancel_extraction":
          return Promise.resolve();
        default:
          return Promise.reject(new Error(`Unexpected command ${command}`));
      }
    });

    render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));

    const stop = await screen.findByRole("button", { name: /Stop extraction/i });
    fireEvent.click(stop);

    await waitFor(() => {
      expect(tauriMocks.invoke).toHaveBeenCalledWith("cancel_extraction");
    });
  });

  it("opens the settings panel from the header gear", () => {
    render(<App />);

    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText("Default export folder")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open logs folder/i })).toBeInTheDocument();
  });

  it("switches mode with the number-key shortcut", () => {
    render(<App />);

    expect(screen.getByRole("tab", { name: /Local ML 6 Stems/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.keyDown(document.body, { key: "2" });

    expect(screen.getByRole("tab", { name: /Local ML 4 Stems/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("dismisses the export toast with its close button", async () => {
    withTauri();
    tauriMocks.open.mockResolvedValueOnce("C:\\music\\song.wav").mockResolvedValueOnce("D:\\exports");
    setupInvoke({ analysis: analysisFor("song"), report: sixStemReport });

    render(<App />);

    await selectSourceAndArm();
    fireEvent.click(screen.getByRole("button", { name: /Run Extraction/i }));
    await screen.findByText("98.2 MB");

    fireEvent.click(screen.getByRole("button", { name: /Export All Stems/i }));
    await screen.findByText(/Exported 2 files/i);

    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(screen.queryByText(/Exported 2 files/i)).not.toBeInTheDocument();
  });
});

describe("ErrorBoundary", () => {
  afterEach(() => {
    cleanup();
  });

  it("catches render errors and offers diagnostics", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    function Boom(): never {
      throw new Error("kaboom");
    }

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Copy diagnostics/i })).toBeInTheDocument();
    spy.mockRestore();
  });
});
