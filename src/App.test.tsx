import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  open: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
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
    tauriMocks.open.mockReset();
    tauriMocks.openPath.mockReset();
    tauriMocks.listen.mockReset();
    tauriMocks.listen.mockResolvedValue(() => undefined);
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

    expect(screen.getByText("drums_percussion.wav")).toBeInTheDocument();
    expect(screen.getByText("bass_band.wav")).toBeInTheDocument();
    expect(screen.getByText("harmonic_bed.wav")).toBeInTheDocument();
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
      },
    });
  });
});
