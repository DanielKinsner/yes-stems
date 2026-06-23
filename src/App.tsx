import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Activity,
  AlertTriangle,
  AudioWaveform,
  CheckCircle2,
  Drum,
  FolderOpen,
  FolderOutput,
  Gauge,
  Layers3,
  Mic2,
  Music2,
  Play,
} from "lucide-react";
import "./App.css";

type StemMode = "vocalInstrumental" | "fullBand";

type TrackAnalysis = {
  fileName: string;
  sampleRate: number;
  channels: number;
  frames: number;
  durationSeconds: number;
  peak: number;
};

type ProgressEvent = {
  phase: string;
  progress: number;
  detail: string;
};

type StemFile = {
  name: string;
  role: string;
  path: string;
  frames: number;
  peak: number;
};

type ExtractionReport = {
  sourceName: string;
  mode: StemMode;
  modeLabel: string;
  outputDir: string;
  sampleRate: number;
  channels: number;
  frames: number;
  durationSeconds: number;
  stems: StemFile[];
  methodNotes: string[];
  reconstructionError: number;
};

const modeDetails: Record<
  StemMode,
  {
    label: string;
    short: string;
    stems: string[];
  }
> = {
  vocalInstrumental: {
    label: "Vocal + Instrumental",
    short: "Foreground vocal estimate plus complement.",
    stems: ["vocals.wav", "instrumental.wav"],
  },
  fullBand: {
    label: "Full Band Layers",
    short: "HPSS, bass-band, foreground, and residual layers.",
    stems: [
      "vocal_foreground.wav",
      "instrumental_sum.wav",
      "drums_percussion.wav",
      "bass_band.wav",
      "harmonic_bed.wav",
      "residual.wav",
    ],
  },
};

const waveformBars = Array.from({ length: 80 }, (_, index) => {
  const tone = Math.sin(index * 0.43) * 0.5 + Math.sin(index * 0.11 + 1.4) * 0.35;
  return 24 + Math.round(Math.abs(tone) * 74);
});

function App() {
  const [inputPath, setInputPath] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [mode, setMode] = useState<StemMode>("vocalInstrumental");
  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [progress, setProgress] = useState<ProgressEvent>({
    phase: "idle",
    progress: 0,
    detail: "Ready",
  });
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unlisten = listen<ProgressEvent>("stems://progress", (event) => {
      setProgress(event.payload);
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const canRun = inputPath.length > 0 && outputDir.length > 0 && !isExtracting;
  const selectedMode = modeDetails[mode];
  const duration = analysis ? formatDuration(analysis.durationSeconds) : "--:--";

  const resultStats = useMemo(() => {
    if (!report) {
      return [];
    }

    return [
      `${report.stems.length} wav stems`,
      `${report.sampleRate.toLocaleString()} Hz`,
      `${report.channels} ch`,
      `${(report.reconstructionError * 100).toFixed(2)}% residual error`,
    ];
  }, [report]);

  async function chooseInput() {
    setError("");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Audio",
          extensions: ["wav", "flac", "mp3", "aif", "aiff", "m4a", "ogg"],
        },
      ],
    });

    if (typeof selected !== "string") {
      return;
    }

    setInputPath(selected);
    setReport(null);
    setProgress({ phase: "analyze", progress: 0.08, detail: "Reading source metadata" });

    try {
      const nextAnalysis = await invoke<TrackAnalysis>("analyze_track", {
        inputPath: selected,
      });
      setAnalysis(nextAnalysis);
      setProgress({ phase: "ready", progress: 0, detail: "Source ready" });
    } catch (caught) {
      setAnalysis(null);
      setProgress({ phase: "error", progress: 0, detail: "Analyze failed" });
      setError(errorMessage(caught));
    }
  }

  async function chooseOutput() {
    setError("");
    const selected = await open({
      multiple: false,
      directory: true,
    });

    if (typeof selected === "string") {
      setOutputDir(selected);
    }
  }

  async function runExtraction() {
    if (!canRun) {
      return;
    }

    setIsExtracting(true);
    setReport(null);
    setError("");
    setProgress({ phase: "queued", progress: 0.02, detail: "Starting extraction" });

    try {
      const nextReport = await invoke<ExtractionReport>("extract_stems", {
        request: {
          inputPath,
          outputDir,
          mode,
        },
      });
      setReport(nextReport);
      setProgress({ phase: "complete", progress: 1, detail: "Stem files written" });
    } catch (caught) {
      setProgress({ phase: "error", progress: 0, detail: "Extraction failed" });
      setError(errorMessage(caught));
    } finally {
      setIsExtracting(false);
    }
  }

  async function revealOutput() {
    if (report?.outputDir) {
      await openPath(report.outputDir);
      return;
    }

    if (outputDir) {
      await openPath(outputDir);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <AudioWaveform size={19} />
          </div>
          <div>
            <h1>YES Stems</h1>
            <p>Local non-AI stem extraction</p>
          </div>
        </div>

        <div className={`run-state run-state-${progress.phase}`}>
          {progress.phase === "complete" ? <CheckCircle2 size={16} /> : <Activity size={16} />}
          <span>{progress.detail}</span>
        </div>
      </header>

      <section className="workspace-grid">
        <aside className="left-rail" aria-label="Extraction setup">
          <section className="panel setup-panel">
            <div className="panel-heading">
              <Music2 size={17} />
              <h2>Source</h2>
            </div>

            <button className="file-picker" type="button" onClick={chooseInput}>
              <FolderOpen size={18} />
              <span>{inputPath ? compactPath(inputPath) : "Select track"}</span>
            </button>

            <button className="file-picker" type="button" onClick={chooseOutput}>
              <FolderOutput size={18} />
              <span>{outputDir ? compactPath(outputDir) : "Choose output folder"}</span>
            </button>

            <div className="source-grid">
              <Metric label="Duration" value={duration} />
              <Metric
                label="Rate"
                value={analysis ? `${analysis.sampleRate.toLocaleString()} Hz` : "--"}
              />
              <Metric label="Channels" value={analysis ? String(analysis.channels) : "--"} />
              <Metric label="Peak" value={analysis ? `${dbfs(analysis.peak)} dBFS` : "--"} />
            </div>
          </section>

          <section className="panel mode-panel">
            <div className="panel-heading">
              <Layers3 size={17} />
              <h2>Mode</h2>
            </div>

            <div className="segmented-control" role="tablist" aria-label="Stem mode">
              {(Object.keys(modeDetails) as StemMode[]).map((modeKey) => (
                <button
                  key={modeKey}
                  type="button"
                  role="tab"
                  aria-selected={mode === modeKey}
                  className={mode === modeKey ? "selected" : ""}
                  onClick={() => setMode(modeKey)}
                >
                  {modeKey === "vocalInstrumental" ? <Mic2 size={16} /> : <Drum size={16} />}
                  <span>{modeDetails[modeKey].label}</span>
                </button>
              ))}
            </div>

            <p className="mode-summary">{selectedMode.short}</p>

            <div className="expected-stems">
              {selectedMode.stems.map((stem) => (
                <span key={stem}>{stem}</span>
              ))}
            </div>
          </section>

          <button className="run-button" type="button" disabled={!canRun} onClick={runExtraction}>
            <Play size={18} fill="currentColor" />
            <span>{isExtracting ? "Extracting" : "Run extraction"}</span>
          </button>
        </aside>

        <section className="analysis-stage" aria-label="Analysis view">
          <div className="stage-toolbar">
            <div>
              <h2>{analysis?.fileName ?? "No source loaded"}</h2>
              <p>{analysis ? `${analysis.frames.toLocaleString()} frames` : "Awaiting local audio"}</p>
            </div>
            <div className="stage-mode">
              <Gauge size={16} />
              <span>{selectedMode.label}</span>
            </div>
          </div>

          <div className="spectral-field">
            <div className="spectral-grid" aria-hidden="true">
              {Array.from({ length: 9 }, (_, index) => (
                <span key={index} />
              ))}
            </div>
            <div className="waveform" aria-hidden="true">
              {waveformBars.map((height, index) => (
                <span
                  key={`${height}-${index}`}
                  style={{
                    height: `${height}%`,
                    opacity: inputPath ? 0.42 + (height / 100) * 0.45 : 0.24,
                  }}
                />
              ))}
            </div>
            <div className="progress-track" aria-label="Extraction progress">
              <span style={{ width: `${Math.round(progress.progress * 100)}%` }} />
            </div>
          </div>

          {error ? (
            <div className="notice error-notice" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          ) : (
            <div className="notice">
              <Activity size={18} />
              <span>{progress.detail}</span>
            </div>
          )}
        </section>

        <aside className="right-rail" aria-label="Extraction results">
          <section className="panel results-panel">
            <div className="panel-heading">
              <CheckCircle2 size={17} />
              <h2>Stems</h2>
            </div>

            {report ? (
              <>
                <div className="result-stats">
                  {resultStats.map((stat) => (
                    <span key={stat}>{stat}</span>
                  ))}
                </div>
                <div className="stem-list">
                  {report.stems.map((stem) => (
                    <article key={stem.path} className="stem-row">
                      <div>
                        <h3>{stem.name}</h3>
                        <p>{stem.role}</p>
                      </div>
                      <span>{dbfs(stem.peak)} dBFS</span>
                    </article>
                  ))}
                </div>
                <button className="secondary-button" type="button" onClick={revealOutput}>
                  <FolderOpen size={16} />
                  <span>Open output</span>
                </button>
              </>
            ) : (
              <div className="empty-results">
                <AudioWaveform size={28} />
                <p>Stem report appears after extraction.</p>
              </div>
            )}
          </section>

          <section className="panel method-panel">
            <div className="panel-heading">
              <Gauge size={17} />
              <h2>Method</h2>
            </div>
            <ul>
              {(report?.methodNotes ?? [
                "Phase-preserving STFT masks.",
                "HPSS plus repeating-background cues.",
                "Useful layers, not recovered multitracks.",
              ]).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </aside>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function compactPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return path;
  }

  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remaining = totalSeconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function dbfs(value: number) {
  if (value <= 0) {
    return "-inf";
  }

  return (20 * Math.log10(value)).toFixed(1);
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export default App;
