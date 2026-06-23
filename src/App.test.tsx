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

  it("switches to full-band layer expectations", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("tab", { name: /Full Band Layers/i }));

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
        mode: "vocalInstrumental",
        modeLabel: "Vocal + Instrumental",
        outputDir: "C:\\renders\\song",
        sampleRate: 44_100,
        channels: 2,
        frames: 132_300,
        durationSeconds: 3,
        reconstructionError: 0.012,
        methodNotes: ["Local non-AI extraction; no model inference or cloud processing."],
        stems: [
          {
            name: "Vocals",
            role: "Non-repeating midrange foreground estimate.",
            path: "C:\\renders\\song\\vocals.wav",
            frames: 132_300,
            peak: 0.5,
          },
          {
            name: "Instrumental",
            role: "Complement of the vocal foreground mask.",
            path: "C:\\renders\\song\\instrumental.wav",
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
    expect(screen.getByRole("heading", { name: "Instrumental" })).toBeInTheDocument();
    expect(tauriMocks.invoke).toHaveBeenLastCalledWith("extract_stems", {
      request: {
        inputPath: "C:\\music\\song.wav",
        outputDir: "C:\\renders",
        mode: "vocalInstrumental",
      },
    });
  });
});
