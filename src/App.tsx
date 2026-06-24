import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Activity,
  AlertTriangle,
  AudioWaveform,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  Drum,
  FileAudio,
  FolderOpen,
  FolderOutput,
  Layers3,
  Mic2,
  Music2,
  Pause,
  Play,
  Settings,
  Square,
  Zap,
} from "lucide-react";
import "./App.css";

type StemMode = "localMlSix" | "localMlFour" | "vocalInstrumental" | "fullBand";

type TrackAnalysis = {
  fileName: string;
  sampleRate: number;
  channels: number;
  frames: number;
  durationSeconds: number;
  peak: number;
  waveformPeaks: number[];
};

type LocalMlStatus = {
  available: boolean;
  runner: string | null;
  device: string;
  checked: string[];
  detail: string;
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

type ExportStemsResult = {
  exportDir: string;
  exportedFiles: number;
};

const modeDetails: Record<
  StemMode,
  {
    label: string;
    short: string;
    stems: string[];
  }
> = {
  localMlSix: {
    label: "Local ML 6 Stems",
    short: "Demucs htdemucs_6s: vocals, drums, bass, guitar, piano, other.",
    stems: ["vocals.wav", "drums.wav", "bass.wav", "guitar.wav", "piano.wav", "other.wav"],
  },
  localMlFour: {
    label: "Local ML 4 Stems",
    short: "Mature Demucs split: vocals, drums, bass, other.",
    stems: ["vocals.wav", "drums.wav", "bass.wav", "other.wav"],
  },
  vocalInstrumental: {
    label: "Classic Vocal + Instrumental",
    short: "DSP foreground estimate plus instrumental complement.",
    stems: ["vocals.wav", "instrumental.wav"],
  },
  fullBand: {
    label: "Classic DSP Layers",
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

const waveformBars = Array.from({ length: 96 }, (_, index) => {
  const tone = Math.sin(index * 0.43) * 0.5 + Math.sin(index * 0.11 + 1.4) * 0.35;
  return 0.12 + Math.abs(tone) * 0.52;
});

const frequencyTicks = ["20k", "10k", "5k", "2k", "1k", "500", "100", "20"];

function App() {
  const [inputPath, setInputPath] = useState("");
  const [mode, setMode] = useState<StemMode>("localMlSix");
  const [aggressiveness, setAggressiveness] = useState(5);
  const [artifactReduction, setArtifactReduction] = useState(5);
  const [cleanupEnabled, setCleanupEnabled] = useState(false);
  const [cleanupStrength, setCleanupStrength] = useState(2);
  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(null);
  const [localMlStatus, setLocalMlStatus] = useState<LocalMlStatus | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [progress, setProgress] = useState<ProgressEvent>({
    phase: "idle",
    progress: 0,
    detail: "Ready",
  });
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const [auditionPath, setAuditionPath] = useState("");
  const [auditionError, setAuditionError] = useState("");
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [timelineSelection, setTimelineSelection] = useState({ start: 0, end: 0 });
  const [exportError, setExportError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playAllTokenRef = useRef(0);
  const selectionAnchorRef = useRef(0);
  const timelineDraggingRef = useRef(false);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    const unlisten = listen<ProgressEvent>("stems://progress", (event) => {
      setProgress(event.payload);
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    if (!report) {
      stopAudition();
    }
  }, [report]);

  useEffect(() => {
    return () => {
      stopAudition(false);
    };
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }

    let alive = true;
    invoke<LocalMlStatus>("check_local_ml_runtime")
      .then((status) => {
        if (alive) {
          setLocalMlStatus(status);
        }
      })
      .catch((caught) => {
        if (alive) {
          setLocalMlStatus({
            available: false,
            runner: null,
            device: "cpu",
            checked: [],
            detail: errorMessage(caught),
          });
        }
      });

    return () => {
      alive = false;
    };
  }, []);

  const localMode = isLocalMlMode(mode);
  const localRuntimeReady = !localMode || !hasTauriRuntime() || localMlStatus?.available === true;
  const canRun = inputPath.length > 0 && !isExtracting && localRuntimeReady;
  const selectedMode = modeDetails[mode];
  const duration = analysis ? formatDuration(analysis.durationSeconds) : "--:--";
  const progressPercent = Math.round(progress.progress * 100);
  const currentFileName = analysis?.fileName ?? (inputPath ? fileNameFromPath(inputPath) : "No source loaded");
  const sampleRate = analysis ? `${analysis.sampleRate.toLocaleString()} Hz` : "--";
  const channelLabel = analysis ? `${analysis.channels} ch` : "--";
  const waveformLevels = useMemo(() => waveformLevelsForAnalysis(analysis), [analysis]);
  const selectionStart = Math.min(timelineSelection.start, timelineSelection.end);
  const selectionEnd = Math.max(timelineSelection.start, timelineSelection.end);
  const selectedSeconds = analysis ? selectionStart * analysis.durationSeconds : 0;
  const selectionText = analysis
    ? `${formatPreciseTime(selectionStart * analysis.durationSeconds)} - ${formatPreciseTime(
        selectionEnd * analysis.durationSeconds,
      )}`
    : "No source selected";
  const stemRows = report
    ? report.stems.map((stem) => ({
        key: stem.path,
        name: stem.name,
        fileName: fileNameFromPath(stem.path),
        role: stem.role,
        peak: `${dbfs(stem.peak)} dBFS`,
        status: auditionPath === stem.path ? "Playing" : "Ready",
        path: stem.path,
      }))
    : selectedMode.stems.map((stem) => ({
        key: stem,
        name: stemDisplayName(stem),
        fileName: stem,
        role: stemRole(stem),
        peak: "-- dB",
        status: "Pending",
        path: "",
      }));

  const resultStats = useMemo(() => {
    if (!report) {
      return [
        `${selectedMode.stems.length} expected stems`,
        localMode ? "local ML output" : "DSP output",
        sampleRate,
        channelLabel,
      ];
    }

    return [
      `${report.stems.length} wav stems`,
      `${report.sampleRate.toLocaleString()} Hz`,
      `${report.channels} ch`,
      report.reconstructionError >= 0
        ? `${(report.reconstructionError * 100).toFixed(2)}% residual error`
        : "local ML output",
    ];
  }, [channelLabel, localMode, report, sampleRate, selectedMode.stems.length]);

  const processLog = useMemo(() => {
    const lines = [
      analysis
        ? `00:00:00 Loaded file: ${analysis.fileName}`
        : "00:00:00 Waiting for an audio track",
      `00:00:01 Mode: ${selectedMode.label}`,
      localMode
        ? "00:00:02 Engine: Local Demucs sidecar"
        : "00:00:02 Engine: Rust DSP backend",
      `00:00:03 Runtime: ${engineStatusText(mode, localMlStatus)}`,
    ];

    if (error) {
      lines.push(`00:00:04 Error: ${error}`);
    } else if (report) {
      lines.push(`00:00:04 Complete: wrote ${report.stems.length} stems`);
      lines.push(`00:00:05 Working files: ${report.outputDir}`);
      // Keep completion notes visible without turning the console into a report viewer.
      for (const note of report.methodNotes.slice(0, 3)) {
        lines.push(`00:00:06 Note: ${note}`);
      }
    } else if (isExtracting) {
      lines.push(`00:00:04 Processing: ${progress.detail} ${progressPercent}%`);
    } else {
      lines.push(`00:00:04 Ready: choose a source track`);
    }

    return lines;
  }, [
    analysis,
    error,
    isExtracting,
    localMode,
    localMlStatus,
    mode,
    progress.detail,
    progressPercent,
    report,
    selectedMode.label,
  ]);

  async function chooseInput() {
    if (isExtracting) {
      return;
    }

    setError("");
    setExportError("");
    setExportMessage("");
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

    resetExtractionState();
    setInputPath(selected);
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

  function resetExtractionState() {
    stopAudition();
    setReport(null);
    setAnalysis(null);
    setAuditionError("");
    setTimelineSelection({ start: 0, end: 0 });
    setProgress({ phase: "idle", progress: 0, detail: "Ready" });
  }

  async function runExtraction() {
    if (!canRun) {
      return;
    }

    setIsExtracting(true);
    setReport(null);
    setError("");
    setExportError("");
    setExportMessage("");
    setProgress({ phase: "queued", progress: 0.02, detail: "Starting extraction" });

    try {
      const nextReport = await invoke<ExtractionReport>("extract_stems", {
        request: {
          inputPath,
          mode,
          tuning: {
            aggressiveness,
            artifactReduction,
          },
          cleanup: {
            enabled: cleanupEnabled,
            strength: cleanupStrength,
          },
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
    if (report?.outputDir && hasTauriRuntime()) {
      await openPath(report.outputDir);
      return;
    }
  }

  async function exportAll() {
    if (!report || !hasTauriRuntime() || isExporting) {
      return;
    }

    setError("");
    setExportError("");
    setExportMessage("");
    const selected = await open({
      multiple: false,
      directory: true,
    });

    if (typeof selected !== "string") {
      return;
    }

    setIsExporting(true);
    try {
      const result = await invoke<ExportStemsResult>("export_stems", {
        request: {
          sourceName: report.sourceName,
          destinationRoot: selected,
          stems: report.stems,
        },
      });
      setExportMessage(`Exported ${result.exportedFiles} files to ${result.exportDir}`);
      await openPath(result.exportDir);
    } catch (caught) {
      setExportError(errorMessage(caught));
    } finally {
      setIsExporting(false);
    }
  }

  function stopAudition(updateState = true) {
    playAllTokenRef.current += 1;
    if (updateState) {
      setIsPlayingAll(false);
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }

    if (updateState) {
      setAuditionPath("");
    }
  }

  function handleModeChange(nextMode: StemMode) {
    if (isExtracting || nextMode === mode) {
      return;
    }

    setMode(nextMode);
    setReport(null);
    stopAudition();
    setProgress((current) =>
      current.phase === "complete" ? { phase: "ready", progress: 0, detail: "Mode changed" } : current,
    );
  }

  async function toggleAudition(stem: { name: string; path: string }) {
    if (!stem.path || !hasTauriRuntime()) {
      return;
    }

    if (auditionPath === stem.path) {
      stopAudition();
      return;
    }

    stopAudition();
    setAuditionError("");

    const audio = new Audio(convertFileSrc(stem.path));
    audioRef.current = audio;
    audio.addEventListener("ended", () => {
      setAuditionPath("");
      audioRef.current = null;
    });
    audio.addEventListener("error", () => {
      setAuditionError(`Could not play ${stem.name}. Open the output folder and try the WAV directly.`);
      setAuditionPath("");
      audioRef.current = null;
    });

    try {
      setAuditionPath(stem.path);
      await audio.play();
    } catch (caught) {
      setAuditionError(errorMessage(caught));
      setAuditionPath("");
      audioRef.current = null;
    }
  }

  async function togglePlayAll() {
    if (!report || !hasTauriRuntime()) {
      return;
    }

    if (isPlayingAll) {
      stopAudition();
      return;
    }

    const token = playAllTokenRef.current + 1;
    playAllTokenRef.current = token;
    setIsPlayingAll(true);
    setAuditionError("");
    await playStemInSequence(report.stems, 0, token);
  }

  async function playStemInSequence(stems: StemFile[], index: number, token: number) {
    if (playAllTokenRef.current !== token) {
      return;
    }

    if (index >= stems.length) {
      setIsPlayingAll(false);
      setAuditionPath("");
      audioRef.current = null;
      return;
    }

    const stem = stems[index];
    const audio = new Audio(convertFileSrc(stem.path));
    audioRef.current = audio;
    setAuditionPath(stem.path);
    audio.addEventListener("ended", () => {
      void playStemInSequence(stems, index + 1, token);
    });
    audio.addEventListener("error", () => {
      setAuditionError(`Could not play ${stem.name}. Open the output folder and try the WAV directly.`);
      setIsPlayingAll(false);
      setAuditionPath("");
      audioRef.current = null;
    });

    try {
      await audio.play();
    } catch (caught) {
      setAuditionError(errorMessage(caught));
      setIsPlayingAll(false);
      setAuditionPath("");
      audioRef.current = null;
    }
  }

  function handleTimelinePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!analysis) {
      return;
    }

    const value = timelineRatioFromEvent(event);
    selectionAnchorRef.current = value;
    timelineDraggingRef.current = true;
    setTimelineSelection({ start: value, end: value });
  }

  function handleTimelinePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!analysis || !timelineDraggingRef.current) {
      return;
    }

    setTimelineSelection({
      start: selectionAnchorRef.current,
      end: timelineRatioFromEvent(event),
    });
  }

  function handleTimelinePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!analysis || !timelineDraggingRef.current) {
      return;
    }

    timelineDraggingRef.current = false;
    setTimelineSelection((current) => {
      if (Math.abs(current.start - current.end) < 0.01) {
        const point = timelineRatioFromEvent(event);
        return { start: point, end: point };
      }

      return current;
    });
  }

  function handleTimelinePointerCancel() {
    timelineDraggingRef.current = false;
  }

  return (
    <main className="app-shell">
      <header className="app-chrome">
        <div className="chrome-left">
          <div className="brand-mark" aria-hidden="true">
            <AudioWaveform size={18} />
          </div>
          <h1>YES Stems</h1>
          <nav className="menu-strip" aria-label="Application menu">
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
            <span>Process</span>
            <span>Help</span>
          </nav>
        </div>

        <div className="chrome-right">
          <div className={`run-state run-state-${progress.phase}`}>
            {progress.phase === "complete" ? <CheckCircle2 size={15} /> : <Activity size={15} />}
            <span>{progress.detail}</span>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Settings unavailable"
            title="Settings are not available in this build."
            disabled
          >
            <Settings size={16} />
          </button>
        </div>
      </header>

      <section className="workbench">
        <aside className="rack left-rack" aria-label="Extraction setup">
          <section className="module source-module">
            <SectionHeading step="1" title="Source" />
            <div className="source-file">
              <FileAudio size={22} />
              <div>
                <strong>{currentFileName}</strong>
                <span>{analysis ? `WAV  -  ${sampleRate}  -  ${channelLabel}` : "Drop in WAV, FLAC, MP3, AIFF, M4A, or OGG"}</span>
              </div>
            </div>
            <button className="field-button" type="button" onClick={chooseInput} disabled={isExtracting}>
              <FolderOpen size={16} />
              <span>{inputPath ? `Replace track: ${compactPath(inputPath)}` : "Select track"}</span>
            </button>
          </section>

          <section className="module mode-module">
            <SectionHeading step="2" title="Extraction Mode" />
            <div className="mode-tabs" role="tablist" aria-label="Stem mode">
              {(Object.keys(modeDetails) as StemMode[]).map((modeKey) => (
                <button
                  key={modeKey}
                  type="button"
                  role="tab"
                  aria-selected={mode === modeKey}
                  className={mode === modeKey ? "selected" : ""}
                  disabled={isExtracting}
                  onClick={() => handleModeChange(modeKey)}
                >
                  <ModeIcon mode={modeKey} />
                  <span>
                    <strong>{modeDetails[modeKey].label}</strong>
                    <small>{modeDetails[modeKey].short}</small>
                  </span>
                  <i aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>

          <section className="module advanced-module">
            <SectionHeading title="Advanced" />
            <label className="select-row">
              <span>Algorithm</span>
              <button
                type="button"
                title="The selected mode determines the extraction algorithm."
                disabled
              >
                {localMode ? "Hybrid v2" : "Classic DSP"}
                <ChevronDown size={14} />
              </button>
            </label>
            <SliderRow
              label="Aggressiveness"
              value={aggressiveness}
              disabled={localMode || isExtracting}
              disabledReason="Only classic DSP modes use this control."
              onChange={setAggressiveness}
            />
            <SliderRow
              label="Artifact Reduction"
              value={artifactReduction}
              disabled={localMode || isExtracting}
              disabledReason="Only classic DSP modes use this control."
              onChange={setArtifactReduction}
            />
            <CheckboxRow
              label="Clean Up Stems"
              checked={cleanupEnabled}
              disabled={isExtracting}
              description="DC, edge, and quiet-bleed cleanup"
              onChange={setCleanupEnabled}
            />
            <SliderRow
              label="Cleanup Strength"
              value={cleanupStrength}
              disabled={!cleanupEnabled || isExtracting}
              disabledReason="Enable Clean Up Stems to change this control."
              onChange={setCleanupStrength}
            />
          </section>
        </aside>

        <section className="center-stage" aria-label="Analysis and processing">
          <section className="module analysis-module">
            <div className="module-bar">
              <SectionHeading step="3" title="Analysis" />
              <div className="time-readout">
                <span>{analysis ? "00:00.000" : "--:--.---"}</span>
                <span>/</span>
                <span>{duration}</span>
              </div>
            </div>

            <div
              className={`wave-overview ${analysis ? "interactive" : ""}`}
              aria-label="Audio overview selection"
              onPointerDown={handleTimelinePointerDown}
              onPointerMove={handleTimelinePointerMove}
              onPointerUp={handleTimelinePointerUp}
              onPointerCancel={handleTimelinePointerCancel}
              onPointerLeave={handleTimelinePointerCancel}
            >
              <div className="wave-bars" aria-hidden="true">
                {waveformLevels.map((height, index) => (
                  <span
                    key={`${index}-${height}`}
                    style={{
                      height: `${Math.max(7, Math.round(height * 100))}%`,
                      opacity: analysis ? 0.48 + height * 0.42 : 0.18,
                    }}
                  />
                ))}
              </div>
              {analysis ? (
                <>
                  <div
                    className="selection-range"
                    style={{
                      left: `${selectionStart * 100}%`,
                      width: `${Math.max(0.4, (selectionEnd - selectionStart) * 100)}%`,
                    }}
                    aria-hidden="true"
                  />
                  <div className="playhead" style={{ left: `${selectionStart * 100}%` }} aria-hidden="true" />
                </>
              ) : (
                <div className="overview-empty">Select a track to render an audio-derived overview.</div>
              )}
            </div>

            <div className="time-axis">
              {timeTicksForAnalysis(analysis).map((tick, index) => (
                <span key={`${tick}-${index}`}>{tick}</span>
              ))}
              <span>{duration}</span>
            </div>
            <div className="selection-readout">
              <span>Selection</span>
              <b>{selectionText}</b>
              <span>Cursor {formatPreciseTime(selectedSeconds)}</span>
            </div>

            <div className="spectrogram-grid">
              <div className="frequency-axis" aria-hidden="true">
                {frequencyTicks.map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>
              <div className="spectrogram">
                <div className="spectrogram-noise" aria-hidden="true" />
                <div className="spectrogram-harmonics" aria-hidden="true" />
              </div>
            </div>
          </section>

          <section className="module processing-module">
            <div className="module-bar">
              <SectionHeading step="4" title="Processing" />
              <button
                className="small-button"
                type="button"
                title="Cancel is unavailable until extraction runs on a cancellable worker."
                disabled
              >
                Cancel
              </button>
            </div>

            <div className="process-title-row">
              <div>
                <strong>{isExtracting ? `Extracting ${selectedMode.label}` : selectedMode.label}</strong>
                <span>{selectedMode.short}</span>
              </div>
              <b>{progressPercent}%</b>
            </div>
            <div className="process-progress" aria-label="Extraction progress">
              <span style={{ width: `${progressPercent}%` }} />
            </div>

            {error ? (
              <div className="notice error-notice" role="alert">
                <AlertTriangle size={17} />
                <span>{error}</span>
              </div>
            ) : (
              <div className="console">
                {processLog.map((line, index) => (
                  <p key={`${line}-${index}`}>{line}</p>
                ))}
              </div>
            )}

            <div className="transport-actions">
              <button
                className="secondary-action"
                type="button"
                title="Pause is unavailable until extraction runs on a pausable worker."
                disabled
              >
                <Pause size={16} />
                <span>Pause</span>
              </button>
              <button
                className="secondary-action"
                type="button"
                title="Cancel is unavailable until extraction runs on a cancellable worker."
                disabled
              >
                <Square size={15} />
                <span>Cancel</span>
              </button>
              <button className="run-button" type="button" disabled={!canRun} onClick={runExtraction}>
                <Play size={17} fill="currentColor" />
                <span>{runButtonText(isExtracting, localMode, localRuntimeReady)}</span>
              </button>
            </div>
          </section>
        </section>

        <aside className="rack right-rack" aria-label="Extraction results">
          <section className="module results-module">
            <div className="module-bar">
              <SectionHeading step="5" title="Results" />
            </div>

            <div className="result-stats">
              {resultStats.map((stat, index) => (
                <span key={`${stat}-${index}`}>{stat}</span>
              ))}
            </div>

            <div className="stem-list">
              {stemRows.map((stem) => (
                <article key={stem.key} className={stem.status === "Ready" ? "stem-row ready" : "stem-row"}>
                  <StemGlyph name={stem.name} />
                  <div>
                    <h3>{stem.name}</h3>
                    <p>{stem.fileName}</p>
                    <small>{stem.role}</small>
                  </div>
                  <div className="stem-meta">
                    <span>SNR</span>
                    <b>{stem.peak}</b>
                    <em>{stem.status}</em>
                  </div>
                  <button
                    className="icon-button stem-play-button"
                    type="button"
                    aria-label={`${stem.path && auditionPath === stem.path ? "Pause" : "Play"} ${stem.name}`}
                    disabled={!stem.path || !hasTauriRuntime()}
                    onClick={() => {
                      void toggleAudition(stem);
                    }}
                  >
                    {stem.path && auditionPath === stem.path ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
                  </button>
                </article>
              ))}
            </div>

            {auditionError ? (
              <div className="audition-error" role="alert">
                {auditionError}
              </div>
            ) : null}

            {exportMessage ? <div className="export-status">{exportMessage}</div> : null}
            {exportError ? (
              <div className="audition-error" role="alert">
                {exportError}
              </div>
            ) : null}

            <div className="result-actions">
              <button
                className="secondary-action"
                type="button"
                disabled={!report || !hasTauriRuntime()}
                onClick={() => {
                  void togglePlayAll();
                }}
              >
                {isPlayingAll ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
                <span>{isPlayingAll ? "Stop All" : "Play All"}</span>
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={revealOutput}
                disabled={!report || !hasTauriRuntime()}
              >
                <FolderOpen size={16} />
                <span>Working Files</span>
              </button>
              <button
                className="export-action"
                type="button"
                disabled={!report || isExporting || !hasTauriRuntime()}
                onClick={exportAll}
              >
                <FolderOutput size={16} />
                <span>{isExporting ? "Exporting" : "Export All"}</span>
              </button>
            </div>
          </section>
        </aside>
      </section>

      <footer className="status-bar">
        <span>{isExtracting ? "Processing" : progress.phase === "complete" ? "Complete" : "Ready"}</span>
        <span>{engineStatusText(mode, localMlStatus)}</span>
        <span className={localRuntimeReady ? "gpu-ready" : "gpu-warning"}>
          <Zap size={13} />
          {localRuntimeReady ? "Local Acceleration Ready" : "Runtime Missing"}
        </span>
      </footer>
    </main>
  );
}

function SectionHeading({ step, title }: { step?: string; title: string }) {
  return (
    <div className="section-heading">
      <span>{step ? `${step}.` : ""}</span>
      <h2>{title}</h2>
    </div>
  );
}

function SliderRow({
  label,
  value,
  disabled,
  disabledReason,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  disabledReason: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider-row">
      <span>{label}</span>
      <div>
        <input
          type="range"
          min="0"
          max="10"
          value={value}
          disabled={disabled}
          title={disabled ? disabledReason : `${label}: ${value}`}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          style={{ ["--slider-value" as string]: `${value * 10}%` }}
        />
        <output>{value}</output>
      </div>
    </label>
  );
}

function CheckboxRow({
  label,
  checked,
  disabled,
  description,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}

function StemGlyph({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("vocal")) {
    return <Mic2 size={23} />;
  }

  if (lower.includes("drum") || lower.includes("percussion")) {
    return <Drum size={23} />;
  }

  if (lower.includes("bass")) {
    return <Music2 size={23} />;
  }

  if (lower.includes("piano") || lower.includes("harmonic")) {
    return <Layers3 size={23} />;
  }

  return <AudioWaveform size={23} />;
}

function ModeIcon({ mode }: { mode: StemMode }) {
  if (mode === "localMlSix" || mode === "localMlFour") {
    return <BrainCircuit size={17} />;
  }

  if (mode === "vocalInstrumental") {
    return <Mic2 size={17} />;
  }

  return <Drum size={17} />;
}

function stemDisplayName(fileName: string) {
  const base = fileName.replace(/\.wav$/i, "").replace(/_/g, " ");
  return base.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stemRole(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.includes("vocal")) {
    return "Lead and backing vocal content";
  }
  if (lower.includes("drum") || lower.includes("percussion")) {
    return "Percussion and transient material";
  }
  if (lower.includes("bass")) {
    return "Low-frequency bass band";
  }
  if (lower.includes("guitar")) {
    return "Guitar-focused source estimate";
  }
  if (lower.includes("piano")) {
    return "Piano-focused source estimate";
  }
  if (lower.includes("instrumental")) {
    return "Vocal-minus instrumental bed";
  }
  if (lower.includes("harmonic")) {
    return "Sustained harmonic bed";
  }
  return "Residual and supporting musical material";
}

function isLocalMlMode(mode: StemMode) {
  return mode === "localMlSix" || mode === "localMlFour";
}

function runButtonText(isExtracting: boolean, localMode: boolean, localRuntimeReady: boolean) {
  if (isExtracting) {
    return "Extracting";
  }

  if (localMode && !localRuntimeReady) {
    return "Install local ML runtime";
  }

  return "Run extraction";
}

function engineStatusText(mode: StemMode, status: LocalMlStatus | null) {
  if (!isLocalMlMode(mode)) {
    return "Classic DSP mode runs inside the Rust backend.";
  }

  if (!hasTauriRuntime()) {
    return "Web preview; Tauri checks local ML runtime.";
  }

  if (!status) {
    return "Checking local Demucs runtime.";
  }

  if (status.available) {
    return `Local ML ready via ${status.runner} on ${status.device}.`;
  }

  return status.detail;
}

function compactPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return path;
  }

  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function fileNameFromPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function formatDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remaining = totalSeconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatPreciseTime(seconds: number) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remaining = safeSeconds - minutes * 60;
  return `${minutes}:${remaining.toFixed(2).padStart(5, "0")}`;
}

function waveformLevelsForAnalysis(analysis: TrackAnalysis | null) {
  if (!analysis?.waveformPeaks?.length) {
    return waveformBars;
  }

  const peak = Math.max(...analysis.waveformPeaks, 0.01);
  return analysis.waveformPeaks.map((value) => 0.08 + (value / peak) * 0.88);
}

function timeTicksForAnalysis(analysis: TrackAnalysis | null) {
  if (!analysis) {
    return ["0:00", "--:--", "--:--", "--:--", "--:--"];
  }

  return [0, 0.2, 0.4, 0.6, 0.8].map((ratio) =>
    formatDuration(analysis.durationSeconds * ratio),
  );
}

function timelineRatioFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
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

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export default App;
