import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  Atom,
  AudioWaveform,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  Cpu,
  Drum,
  FileMusic,
  FolderInput,
  FolderOpen,
  Gauge,
  Guitar,
  HelpCircle,
  Info,
  Layers3,
  Lock,
  Maximize2,
  Mic2,
  Music2,
  Pause,
  Piano,
  Play,
  Settings,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  Waves,
  X,
} from "lucide-react";
import "./App.css";

type StemMode = "localMlSix" | "localMlFour" | "vocalInstrumental" | "fullBand";
type StageTab = "overview" | "spectrum" | "loudness" | "metrics";
type PlayMode = "sequence" | "all";
type ExportFormat = "wav16" | "wav24" | "wav32f";

type TrackAnalysis = {
  fileName: string;
  sampleRate: number;
  channels: number;
  frames: number;
  durationSeconds: number;
  peak: number;
  waveformPeaks: number[];
  spectrum?: number[];
  loudness?: number[];
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
  jobId?: string;
};

type StemFile = {
  name: string;
  role: string;
  path: string;
  frames: number;
  peak: number;
  bytes: number;
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
  { label: string; tag: string; model: string; short: string }
> = {
  localMlSix: {
    label: "Local ML 6 Stems",
    tag: "Recommended",
    model: "htdemucs_6s",
    short: "Vocals, drums, bass, guitar, piano, other.",
  },
  localMlFour: {
    label: "Local ML 4 Stems",
    tag: "Fast & robust",
    model: "htdemucs",
    short: "Vocals, drums, bass, other.",
  },
  vocalInstrumental: {
    label: "Classic Vocal + Instrumental",
    tag: "DSP",
    model: "DSP",
    short: "Foreground vocal estimate plus instrumental complement.",
  },
  fullBand: {
    label: "Classic DSP Layers",
    tag: "DSP",
    model: "DSP",
    short: "HPSS, bass-band, foreground, and residual layers.",
  },
};

const expectedStems: Record<StemMode, string[]> = {
  localMlSix: ["vocals.wav", "drums.wav", "bass.wav", "guitar.wav", "piano.wav", "other.wav"],
  localMlFour: ["vocals.wav", "drums.wav", "bass.wav", "other.wav"],
  vocalInstrumental: ["vocals.wav", "instrumental.wav"],
  fullBand: [
    "vocal_foreground.wav",
    "instrumental_sum.wav",
    "drums_percussion.wav",
    "bass_band.wav",
    "harmonic_bed.wav",
    "residual.wav",
  ],
};

const experimentalNote =
  "Guitar and piano stems are experimental in 6-stem mode and may bleed into each other or Other depending on the mix.";

// Shorter phrasing for the compact left-rack Options hint (the full note lives in the right-rack Notes panel).
const experimentalHint =
  "Guitar and piano are experimental in 6-stem mode and may bleed into each other or Other.";

// Demo dataset — only seeded when running outside Tauri (browser preview used for
// screenshots and design review). Real desktop builds always hydrate from the backend.
const demoWaveform = Array.from({ length: 440 }, (_, i) => {
  const env = 0.46 + 0.4 * Math.abs(Math.sin(i * 0.06) + 0.5 * Math.sin(i * 0.022 + 1.1));
  const detail = 0.6 + 0.4 * Math.abs(Math.sin(i * 0.95) + 0.3 * Math.sin(i * 0.37));
  return Math.min(1, env * detail);
});

const demoSpectrum = Array.from({ length: 64 }, (_, i) => {
  const t = i / 64;
  const shape = Math.pow(1 - t, 1.3) * (0.7 + 0.3 * Math.abs(Math.sin(i * 0.7)));
  return Math.min(1, 0.14 + shape);
});

const demoLoudness = Array.from({ length: 96 }, (_, i) => {
  const env = 0.5 + 0.4 * Math.abs(Math.sin(i * 0.09) + 0.4 * Math.sin(i * 0.31));
  return Math.min(1, env);
});

const demoStemSeed: Array<{ file: string; name: string; role: string; db: number; mb: number }> = [
  { file: "vocals.wav", name: "Vocals", role: "Lead and backing vocal content", db: -6.2, mb: 98.3 },
  { file: "drums.wav", name: "Drums", role: "Percussion and transient material", db: -8.4, mb: 91.7 },
  { file: "bass.wav", name: "Bass", role: "Low-frequency bass band", db: -7.1, mb: 52.1 },
  { file: "guitar.wav", name: "Guitar", role: "Guitar-focused source estimate", db: -9.3, mb: 68.4 },
  { file: "piano.wav", name: "Piano", role: "Piano-focused source estimate", db: -11.2, mb: 61.2 },
  { file: "other.wav", name: "Other", role: "Residual and supporting material", db: -10.5, mb: 76.5 },
];

const demoOutputDir = "C:\\Users\\Dan\\YES Stems\\Working\\Better Days";
const demoExportDir = "C:\\Users\\Dan\\YES Stems\\Exports\\";

function buildDemoAnalysis(): TrackAnalysis {
  return {
    fileName: "Better Days.mp3",
    sampleRate: 44_100,
    channels: 2,
    frames: Math.round(44_100 * 178.213),
    durationSeconds: 178.213,
    peak: 0.94,
    waveformPeaks: demoWaveform,
    spectrum: demoSpectrum,
    loudness: demoLoudness,
  };
}

function buildDemoReport(): ExtractionReport {
  return {
    sourceName: "Better Days",
    mode: "localMlSix",
    modeLabel: modeDetails.localMlSix.label,
    outputDir: demoOutputDir,
    sampleRate: 44_100,
    channels: 2,
    frames: Math.round(44_100 * 178.213),
    durationSeconds: 178.213,
    reconstructionError: -1,
    methodNotes: [experimentalNote],
    stems: demoStemSeed.map((stem) => ({
      name: stem.name,
      role: stem.role,
      path: `${demoOutputDir}\\${stem.file}`,
      frames: Math.round(44_100 * 178.213),
      peak: peakFromDb(stem.db),
      bytes: Math.round(stem.mb * 1024 * 1024),
    })),
  };
}

// Lightweight preference persistence. Only active in the real desktop build so that vitest
// and the browser demo stay stateless (localStorage is never touched when Tauri is absent).
const STORE_PREFIX = "yes-stems:";

function loadPersisted<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  if (!hasTauriRuntime()) {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + key);
    return raw == null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

function savePersisted(key: string, value: string) {
  if (!hasTauriRuntime()) {
    return;
  }
  try {
    window.localStorage.setItem(STORE_PREFIX + key, value);
  } catch {
    // storage disabled or over quota — preferences are best-effort
  }
}

function clearPersisted() {
  if (!hasTauriRuntime()) {
    return;
  }
  try {
    const keys = Object.keys(window.localStorage).filter((key) => key.startsWith(STORE_PREFIX));
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // storage disabled — nothing to clear
  }
}

function isStemMode(value: string): value is StemMode {
  return Object.prototype.hasOwnProperty.call(modeDetails, value);
}

function isAudioPath(path: string) {
  return /\.(wav|flac|mp3|aif|aiff|m4a|ogg)$/i.test(path);
}

const modeOrder: StemMode[] = ["localMlSix", "localMlFour", "vocalInstrumental", "fullBand"];

function App() {
  // Demo data is only seeded for the production browser preview (used for screenshots
  // and design review). The real Tauri desktop build hydrates from the backend, and the
  // test/dev environments stay empty so wiring can be exercised from a clean slate.
  const isDemo = !hasTauriRuntime() && import.meta.env.PROD;

  const [inputPath, setInputPath] = useState(() => (isDemo ? "Better Days.mp3" : ""));
  const [mode, setMode] = useState<StemMode>(() =>
    loadPersisted<StemMode>("mode", "localMlSix", (raw) => (isStemMode(raw) ? raw : "localMlSix")),
  );
  const [aggressiveness, setAggressiveness] = useState(5);
  const [artifactReduction, setArtifactReduction] = useState(5);
  const [cleanupEnabled, setCleanupEnabled] = useState(() =>
    loadPersisted("cleanupEnabled", true, (raw) => raw !== "false"),
  );
  const [cleanupStrength, setCleanupStrength] = useState(() =>
    loadPersisted("cleanupStrength", 45, (raw) => Math.max(0, Math.min(100, Number(raw) || 0))),
  );
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [analysis, setAnalysis] = useState<TrackAnalysis | null>(() =>
    isDemo ? buildDemoAnalysis() : null,
  );
  const [localMlStatus, setLocalMlStatus] = useState<LocalMlStatus | null>(null);
  const [report, setReport] = useState<ExtractionReport | null>(() =>
    isDemo ? buildDemoReport() : null,
  );
  const [progress, setProgress] = useState<ProgressEvent>(() =>
    isDemo
      ? { phase: "complete", progress: 1, detail: "Stem files written" }
      : { phase: "idle", progress: 0, detail: "Ready" },
  );
  const [activeTab, setActiveTab] = useState<StageTab>("overview");
  const [isExtracting, setIsExtracting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");
  const [auditionPath, setAuditionPath] = useState("");
  const [auditionError, setAuditionError] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playMode, setPlayMode] = useState<PlayMode>("sequence");
  const [soloStem, setSoloStem] = useState(() => (isDemo ? `${demoOutputDir}\\vocals.wav` : ""));
  const [mutedStems, setMutedStems] = useState<Set<string>>(new Set());
  const [volume, setVolume] = useState(() =>
    loadPersisted("volume", isDemo ? 0.8 : 0.85, (raw) => Math.max(0, Math.min(1, Number(raw) || 0))),
  );
  const [playhead, setPlayhead] = useState(() => (isDemo ? { current: 42, total: 178.213 } : { current: 0, total: 0 }));
  const [timelineSelection, setTimelineSelection] = useState({ start: 0, end: isDemo ? 1 : 0 });
  const [exportError, setExportError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [lastExportDir, setLastExportDir] = useState(() =>
    loadPersisted("lastExportDir", isDemo ? demoExportDir : "", (raw) => raw),
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>(() =>
    loadPersisted<ExportFormat>("exportFormat", "wav24", (raw) =>
      raw === "wav16" || raw === "wav24" || raw === "wav32f" ? raw : "wav24",
    ),
  );
  const [defaultExportDir, setDefaultExportDir] = useState(() =>
    loadPersisted("defaultExportDir", "", (raw) => raw),
  );
  const [showSettings, setShowSettings] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const allAudioRef = useRef<HTMLAudioElement[]>([]);
  const playTokenRef = useRef(0);
  const selectionAnchorRef = useRef(0);
  const timelineDraggingRef = useRef(false);
  const scrubbingRef = useRef(false);

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
      stopPlayback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  useEffect(() => {
    return () => {
      stopPlayback(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep live volume in sync with any playing audio elements.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
    for (const audio of allAudioRef.current) {
      audio.volume = volume;
    }
  }, [volume]);

  // Persist preferences (desktop only; no-ops in vitest / browser demo).
  useEffect(() => savePersisted("mode", mode), [mode]);
  useEffect(() => savePersisted("cleanupEnabled", String(cleanupEnabled)), [cleanupEnabled]);
  useEffect(() => savePersisted("cleanupStrength", String(cleanupStrength)), [cleanupStrength]);
  useEffect(() => savePersisted("volume", String(volume)), [volume]);
  useEffect(() => {
    if (lastExportDir) {
      savePersisted("lastExportDir", lastExportDir);
    }
  }, [lastExportDir]);
  useEffect(() => savePersisted("exportFormat", exportFormat), [exportFormat]);
  useEffect(() => savePersisted("defaultExportDir", defaultExportDir), [defaultExportDir]);

  // Auto-dismiss the export success toast after a few seconds.
  useEffect(() => {
    if (!exportMessage) {
      return;
    }
    const timer = setTimeout(() => setExportMessage(""), 8000);
    return () => clearTimeout(timer);
  }, [exportMessage]);

  // Keyboard shortcuts: Space (play/stop), Esc (stop), Ctrl/Cmd+O (open), 1–4 (switch mode).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target != null &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && (event.key === "o" || event.key === "O")) {
        event.preventDefault();
        void chooseInput();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || typing) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "Escape") {
        if (isExtracting) {
          void cancelExtraction();
        } else {
          stopPlayback();
        }
      } else if (event.key >= "1" && event.key <= "4") {
        const nextMode = modeOrder[Number(event.key) - 1];
        if (nextMode) {
          handleModeChange(nextMode);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, mode, isExtracting, isPlaying, soloStem, playMode, mutedStems, inputPath]);

  // Drag-and-drop an audio file anywhere on the window to load it (desktop only).
  useEffect(() => {
    if (!hasTauriRuntime()) {
      return;
    }
    let active = true;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        const { getCurrentWebview } = await import("@tauri-apps/api/webview");
        const dispose = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setIsDropTarget(true);
          } else if (payload.type === "drop") {
            setIsDropTarget(false);
            if (!isExtracting) {
              const path = payload.paths.find(isAudioPath) ?? payload.paths[0];
              if (path) {
                void analyzePath(path);
              }
            }
          } else {
            setIsDropTarget(false);
          }
        });
        if (active) {
          unlisten = dispose;
        } else {
          dispose();
        }
      } catch {
        // drag-and-drop unavailable on this platform — non-fatal
      }
    })();
    return () => {
      active = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExtracting]);

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
  const classicMode = !localMode;
  const localRuntimeReady = !localMode || !hasTauriRuntime() || localMlStatus?.available === true;
  const canRun = inputPath.length > 0 && !isExtracting && localRuntimeReady;
  const selectedMode = modeDetails[mode];
  const progressPercent = Math.round(progress.progress * 100);
  const sourceName = analysis?.fileName ?? (inputPath ? fileNameFromPath(inputPath) : "No source loaded");
  const sourceMeta = analysis
    ? `${sourceExt(analysis.fileName)}  ·  ${formatKHz(analysis.sampleRate)}  ·  ${formatDuration(analysis.durationSeconds)}`
    : "WAV · FLAC · MP3 · AIFF · M4A · OGG";
  const durationCode = analysis ? formatTimecodeMs(analysis.durationSeconds) : "--:--.---";
  const sampleRateLabel = analysis ? formatKHz(analysis.sampleRate) : "--";
  const channelsLabel = analysis ? channelName(analysis.channels) : "--";
  const waveformLevels = useMemo(() => waveformLevelsForAnalysis(analysis), [analysis]);
  const selectionStart = Math.min(timelineSelection.start, timelineSelection.end);
  const selectionEnd = Math.max(timelineSelection.start, timelineSelection.end);

  const statusLabel = report
    ? "Completed"
    : isExtracting
      ? "Processing"
      : analysis
        ? "Analyzed"
        : "Idle";
  const analysisStatus = report
    ? "Analysis Complete"
    : isExtracting
      ? `Processing ${progressPercent}%`
      : analysis
        ? "Analysis Complete"
        : "Awaiting source";

  const stemRows = useMemo(() => buildStemRows(report, mode), [report, mode]);
  const activeStem = soloStem || auditionPath || stemRows[0]?.path || "";
  const previewLabel = report
    ? soloStem
      ? stemNameFromPath(soloStem, stemRows)
      : playMode === "all"
        ? "All stems"
        : "Sequenced stems"
    : "No stems yet";

  const writtenRows = report
    ? report.stems.map((stem) => ({
        key: stem.path || stem.name,
        file: fileNameFromPath(stem.path) || `${stem.name.toLowerCase()}.wav`,
        size: formatBytes(stem.bytes),
        written: true,
      }))
    : expectedStems[mode].map((file) => ({ key: file, file, size: "—", written: false }));

  const notesText = report
    ? mode === "localMlSix"
      ? experimentalNote
      : report.methodNotes[0] ?? selectedMode.short
    : mode === "localMlSix"
      ? experimentalNote
      : selectedMode.short;

  // The left-rack Options hint uses a shorter phrasing than the right-rack Notes panel.
  const hintText = mode === "localMlSix" ? experimentalHint : notesText;

  const etaText = (() => {
    if (isExtracting) {
      return `Processing — ${progress.detail} ${progressPercent}%`;
    }
    if (!analysis) {
      return "Select a track to estimate";
    }
    const factor = localMode ? 0.77 : 0.25;
    return `Estimated Time: ~${formatDuration(analysis.durationSeconds * factor)}`;
  })();

  const footerPath = lastExportDir || report?.outputDir || "Chosen when you export";

  async function analyzePath(selected: string) {
    resetExtractionState();
    setError("");
    setExportError("");
    setExportMessage("");
    setInputPath(selected);
    setProgress({ phase: "analyze", progress: 0.08, detail: "Reading source metadata" });
    try {
      const nextAnalysis = await invoke<TrackAnalysis>("analyze_track", { inputPath: selected });
      setAnalysis(nextAnalysis);
      setTimelineSelection({ start: 0, end: 1 });
      setProgress({ phase: "ready", progress: 0, detail: "Source ready" });
    } catch (caught) {
      setAnalysis(null);
      setProgress({ phase: "error", progress: 0, detail: "Analyze failed" });
      setError(errorMessage(caught));
    }
  }

  async function chooseInput() {
    if (isExtracting || !hasTauriRuntime()) {
      return;
    }
    setError("");
    setExportError("");
    setExportMessage("");
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Audio", extensions: ["wav", "flac", "mp3", "aif", "aiff", "m4a", "ogg"] }],
    });
    if (typeof selected !== "string") {
      return;
    }
    await analyzePath(selected);
  }

  function resetExtractionState() {
    stopPlayback();
    setReport(null);
    setAnalysis(null);
    setAuditionError("");
    setSoloStem("");
    setMutedStems(new Set());
    setTimelineSelection({ start: 0, end: 0 });
    setPlayhead({ current: 0, total: 0 });
    setProgress({ phase: "idle", progress: 0, detail: "Ready" });
  }

  async function runExtraction() {
    if (!canRun || !hasTauriRuntime()) {
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
          tuning: { aggressiveness, artifactReduction },
          cleanup: { enabled: cleanupEnabled, strength: cleanupStrengthLevel(cleanupStrength) },
        },
      });
      setReport(nextReport);
      setSoloStem("");
      setMutedStems(new Set());
      setPlayhead({ current: 0, total: nextReport.durationSeconds });
      setProgress({ phase: "complete", progress: 1, detail: "Stem files written" });
    } catch (caught) {
      const message = errorMessage(caught);
      if (/cancel/i.test(message)) {
        setProgress({ phase: "idle", progress: 0, detail: "Extraction cancelled" });
      } else {
        setProgress({ phase: "error", progress: 0, detail: "Extraction failed" });
        setError(message);
      }
    } finally {
      setIsExtracting(false);
    }
  }

  async function cancelExtraction() {
    if (!isExtracting || !hasTauriRuntime()) {
      return;
    }
    setProgress({ phase: "cancelling", progress: 0, detail: "Cancelling…" });
    try {
      await invoke("cancel_extraction");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function chooseDefaultExportDir() {
    if (!hasTauriRuntime()) {
      return;
    }
    const picked = await open({ multiple: false, directory: true });
    if (typeof picked === "string") {
      setDefaultExportDir(picked);
    }
  }

  async function openLogs() {
    if (!hasTauriRuntime()) {
      return;
    }
    try {
      const dir = await invoke<string>("log_directory");
      await openPath(dir);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function resetPreferences() {
    clearPersisted();
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }

  async function revealOutput(dir?: string) {
    const target = dir ?? report?.outputDir;
    if (target && hasTauriRuntime()) {
      await openPath(target);
    }
  }

  async function exportAll() {
    if (!report || !hasTauriRuntime() || isExporting) {
      return;
    }
    setError("");
    setExportError("");
    setExportMessage("");
    // Use the configured default folder if set; otherwise prompt each time.
    let selected: string | null = defaultExportDir || null;
    if (!selected) {
      const picked = await open({ multiple: false, directory: true });
      if (typeof picked !== "string") {
        return;
      }
      selected = picked;
    }
    setIsExporting(true);
    try {
      const result = await invoke<ExportStemsResult>("export_stems", {
        request: {
          sourceName: report.sourceName,
          destinationRoot: selected,
          stems: report.stems,
          format: exportFormat,
        },
      });
      setLastExportDir(result.exportDir);
      setExportMessage(`Exported ${result.exportedFiles} files to ${result.exportDir}`);
      await openPath(result.exportDir);
    } catch (caught) {
      setExportError(errorMessage(caught));
    } finally {
      setIsExporting(false);
    }
  }

  function stopPlayback(reset = true) {
    playTokenRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    for (const audio of allAudioRef.current) {
      audio.pause();
    }
    allAudioRef.current = [];
    if (reset) {
      setIsPlaying(false);
      setAuditionPath("");
      setPlayhead((current) => ({ current: 0, total: current.total }));
    }
  }

  function handleModeChange(nextMode: StemMode) {
    if (isExtracting || nextMode === mode) {
      return;
    }
    setMode(nextMode);
    setReport(null);
    stopPlayback();
    setProgress((current) =>
      current.phase === "complete" ? { phase: "ready", progress: 0, detail: "Mode changed" } : current,
    );
  }

  function beginSingleStem(path: string) {
    if (!path || !hasTauriRuntime()) {
      return;
    }
    stopPlayback(false);
    const token = playTokenRef.current;
    setAuditionError("");
    const audio = new Audio(convertFileSrc(path));
    audio.volume = volume;
    audioRef.current = audio;
    setAuditionPath(path);
    setIsPlaying(true);
    // If the user dragged a partial timeline selection, audition just that region.
    const selStart = selectionStart;
    const selEnd = selectionEnd;
    const hasSelection = selEnd - selStart > 0.01 && selEnd - selStart < 0.999;
    if (hasSelection) {
      audio.addEventListener("loadedmetadata", () => {
        if (playTokenRef.current === token && Number.isFinite(audio.duration)) {
          audio.currentTime = selStart * audio.duration;
        }
      });
    }
    audio.addEventListener("timeupdate", () => {
      if (playTokenRef.current !== token) {
        return;
      }
      if (
        hasSelection &&
        Number.isFinite(audio.duration) &&
        audio.currentTime >= selEnd * audio.duration
      ) {
        audio.pause();
        setIsPlaying(false);
        setAuditionPath("");
        return;
      }
      setPlayhead({ current: audio.currentTime, total: audio.duration || playhead.total });
    });
    audio.addEventListener("ended", () => {
      if (playTokenRef.current === token) {
        setIsPlaying(false);
        setAuditionPath("");
      }
    });
    audio.addEventListener("error", () => {
      setAuditionError(`Could not play ${fileNameFromPath(path)}. Open the output folder and try the WAV directly.`);
      stopPlayback();
    });
    void audio.play().catch((caught) => {
      setAuditionError(errorMessage(caught));
      stopPlayback();
    });
  }

  function playSequence(stems: StemFile[], index: number, token: number) {
    if (playTokenRef.current !== token) {
      return;
    }
    if (index >= stems.length) {
      setIsPlaying(false);
      setAuditionPath("");
      audioRef.current = null;
      return;
    }
    const stem = stems[index];
    const audio = new Audio(convertFileSrc(stem.path));
    audio.volume = volume;
    audioRef.current = audio;
    setAuditionPath(stem.path);
    audio.addEventListener("timeupdate", () => {
      if (playTokenRef.current !== token) {
        return;
      }
      setPlayhead({ current: audio.currentTime, total: audio.duration || playhead.total });
    });
    audio.addEventListener("ended", () => {
      playSequence(stems, index + 1, token);
    });
    audio.addEventListener("error", () => {
      setAuditionError(`Could not play ${stem.name}. Open the output folder and try the WAV directly.`);
      stopPlayback();
    });
    void audio.play().catch((caught) => {
      setAuditionError(errorMessage(caught));
      stopPlayback();
    });
  }

  function playConcurrent(stems: StemFile[], token: number) {
    const audios = stems.map((stem) => {
      const audio = new Audio(convertFileSrc(stem.path));
      audio.volume = volume;
      return audio;
    });
    allAudioRef.current = audios;
    setIsPlaying(true);
    const lead = audios[0];
    if (lead) {
      lead.addEventListener("timeupdate", () => {
        if (playTokenRef.current !== token) {
          return;
        }
        setPlayhead({ current: lead.currentTime, total: lead.duration || playhead.total });
      });
      lead.addEventListener("ended", () => {
        if (playTokenRef.current === token) {
          stopPlayback();
        }
      });
    }
    Promise.all(audios.map((audio) => audio.play())).catch((caught) => {
      setAuditionError(errorMessage(caught));
      stopPlayback();
    });
  }

  function togglePlay() {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    if (!report || !hasTauriRuntime()) {
      return;
    }
    stopPlayback(false);
    const token = playTokenRef.current;
    setAuditionError("");
    if (soloStem) {
      const stem = report.stems.find((item) => item.path === soloStem);
      if (stem) {
        beginSingleStem(stem.path);
      }
      return;
    }
    const active = report.stems.filter((stem) => !mutedStems.has(stem.path));
    if (active.length === 0) {
      return;
    }
    if (playMode === "all" && active.length > 1) {
      playConcurrent(active, token);
    } else {
      setIsPlaying(true);
      playSequence(active, 0, token);
    }
  }

  function toggleSolo(path: string) {
    if (soloStem === path) {
      setSoloStem("");
      if (isPlaying) {
        stopPlayback();
      }
      return;
    }
    setSoloStem(path);
    if (hasTauriRuntime()) {
      beginSingleStem(path);
    }
  }

  function toggleMute(path: string) {
    setMutedStems((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
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
    setTimelineSelection({ start: selectionAnchorRef.current, end: timelineRatioFromEvent(event) });
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

  function seekTo(ratio: number) {
    const clamped = Math.max(0, Math.min(1, ratio));
    const active = audioRef.current;
    const concurrent = allAudioRef.current;
    const durationOf = (el: HTMLAudioElement | null) =>
      el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;

    if (active) {
      const total = durationOf(active) || playhead.total || analysis?.durationSeconds || 0;
      if (total > 0) {
        active.currentTime = clamped * total;
        setPlayhead({ current: active.currentTime, total });
      }
      return;
    }
    if (concurrent.length > 0) {
      const total = durationOf(concurrent[0]) || playhead.total || analysis?.durationSeconds || 0;
      if (total > 0) {
        for (const el of concurrent) {
          if (durationOf(el) > 0) {
            el.currentTime = clamped * total;
          }
        }
        setPlayhead({ current: clamped * total, total });
      }
      return;
    }
    // Nothing playing — move the visual playhead so the position is ready for the next play.
    const total = playhead.total || analysis?.durationSeconds || 0;
    if (total > 0) {
      setPlayhead({ current: clamped * total, total });
    }
  }

  function scrubRatioFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) {
      return 0;
    }
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  }

  function handleScrubPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!report) {
      return;
    }
    scrubbingRef.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // pointer not capturable (e.g. synthetic event) — dragging still works via state
    }
    seekTo(scrubRatioFromEvent(event));
  }

  function handleScrubPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbingRef.current) {
      return;
    }
    seekTo(scrubRatioFromEvent(event));
  }

  function handleScrubPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbingRef.current) {
      return;
    }
    scrubbingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // capture was never established — nothing to release
    }
  }

  return (
    <main className="app-shell">
      <header className="app-chrome">
        <div className="chrome-left">
          <span className="brand-mark" aria-hidden="true">
            <AudioWaveform size={20} />
          </span>
          <h1>
            <b>YES</b> Stems
          </h1>
        </div>

        <div className="mode-select">
          <span className="glyph" aria-hidden="true">
            <ModeIcon mode={mode} size={16} />
          </span>
          <span className="label">{selectedMode.label}</span>
          <ChevronDown className="chev" size={15} />
          <select
            aria-label="Extraction mode"
            value={mode}
            disabled={isExtracting}
            onChange={(event) => handleModeChange(event.currentTarget.value as StemMode)}
          >
            {(Object.keys(modeDetails) as StemMode[]).map((key) => (
              <option key={key} value={key}>
                {modeDetails[key].label}
              </option>
            ))}
          </select>
        </div>

        <div className="chrome-right">
          <button
            className={`icon-button ${localRuntimeReady ? "is-on" : ""}`}
            type="button"
            aria-label="Local engine status"
            title={engineStatusText(mode, localMlStatus)}
          >
            <Atom size={16} />
          </button>
          <button
            className={`icon-button ${showSettings ? "is-on" : ""}`}
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setShowSettings((open) => !open)}
          >
            <Settings size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Help"
            title="YES Stems — 100% local, offline stem separation."
          >
            <HelpCircle size={16} />
          </button>
        </div>
      </header>

      <section className="workbench">
        {/* ---------------- Left rack ---------------- */}
        <aside className="rack left-rack" aria-label="Extraction setup">
          <section className="module pad source-module">
            <div className="section-heading">
              <span className="num">1</span>
              <span>Source</span>
              <span className="dot" aria-hidden="true" />
            </div>
            <div className={`source-card ${isDropTarget ? "drop" : ""}`}>
              <span className="art" aria-hidden="true">
                <FileMusic size={20} />
              </span>
              <div>
                <strong>{sourceName}</strong>
                <span>{sourceMeta}</span>
              </div>
            </div>
            <button className="ghost-button" type="button" onClick={chooseInput} disabled={isExtracting}>
              <span>Change File</span>
            </button>
          </section>

          <section className="module pad mode-module">
            <div className="section-heading">
              <span className="num">2</span>
              <span>Mode</span>
            </div>
            <div className="mode-list" role="tablist" aria-label="Stem mode">
              {(Object.keys(modeDetails) as StemMode[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={mode === key}
                  className={`mode-card ${mode === key ? "selected" : ""}`}
                  disabled={isExtracting}
                  onClick={() => handleModeChange(key)}
                >
                  <span className="glyph" aria-hidden="true">
                    <ModeIcon mode={key} size={16} />
                  </span>
                  <span>
                    <strong>{modeDetails[key].label}</strong>
                    {mode === key ? <small>{modeDetails[key].tag}</small> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="module pad options-module">
            <div className="section-heading">
              <span>Options</span>
            </div>

            <label className="option-row">
              <span className="text">
                <strong>Stem Cleanup</strong>
                <small>Reduce bleed, DC offset &amp; noise</small>
              </span>
              <input
                type="checkbox"
                className="toggle"
                checked={cleanupEnabled}
                disabled={isExtracting}
                onChange={(event) => setCleanupEnabled(event.currentTarget.checked)}
              />
            </label>

            <div className="slider-block">
              <div className="head">
                <span>Cleanup Strength</span>
                <b>{cleanupStrength}%</b>
              </div>
              <input
                type="range"
                className="range"
                min={0}
                max={100}
                step={5}
                value={cleanupStrength}
                disabled={!cleanupEnabled || isExtracting}
                aria-label="Cleanup Strength"
                onChange={(event) => setCleanupStrength(Number(event.currentTarget.value))}
                style={{ ["--fill" as string]: `${cleanupStrength}%` }}
              />
            </div>

            {classicMode ? (
              <>
                <div className="slider-block">
                  <div className="head">
                    <span>Aggressiveness</span>
                    <b>{aggressiveness}</b>
                  </div>
                  <input
                    type="range"
                    className="range"
                    min={0}
                    max={10}
                    value={aggressiveness}
                    disabled={isExtracting}
                    aria-label="Aggressiveness"
                    onChange={(event) => setAggressiveness(Number(event.currentTarget.value))}
                    style={{ ["--fill" as string]: `${aggressiveness * 10}%` }}
                  />
                </div>
                <div className="slider-block">
                  <div className="head">
                    <span>Artifact Reduction</span>
                    <b>{artifactReduction}</b>
                  </div>
                  <input
                    type="range"
                    className="range"
                    min={0}
                    max={10}
                    value={artifactReduction}
                    disabled={isExtracting}
                    aria-label="Artifact Reduction"
                    onChange={(event) => setArtifactReduction(Number(event.currentTarget.value))}
                    style={{ ["--fill" as string]: `${artifactReduction * 10}%` }}
                  />
                </div>
              </>
            ) : null}

            <div className="hint-note">
              <Info size={15} />
              <span>{hintText}</span>
            </div>
          </section>

          <div className="run-wrap">
            {isExtracting ? (
              <button
                className="stop-button"
                type="button"
                aria-label="Stop extraction"
                onClick={cancelExtraction}
              >
                <Square size={15} fill="currentColor" />
                <span>Stop</span>
              </button>
            ) : (
              <button className="run-button" type="button" disabled={!canRun} onClick={runExtraction}>
                <Play size={17} fill="currentColor" />
                <span>{runButtonText(isExtracting, localMode, localRuntimeReady)}</span>
              </button>
            )}
            <div className="run-eta">{etaText}</div>
          </div>
        </aside>

        {/* ---------------- Center stage ---------------- */}
        <section className="center-stage" aria-label="Analysis and stems">
          <div className="module stage-tabs">
            {(["overview", "spectrum", "loudness", "metrics"] as StageTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`tab ${activeTab === tab ? "active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.toUpperCase()}
              </button>
            ))}
            <span className="spacer" />
            <span className="range-pill dim">
              <Music2 size={13} />
              Source
              <ChevronDown size={12} />
            </span>
            <span className="range-time">
              {analysis ? `${formatTimecodeMs(0)} — ${durationCode}` : "0:00.000 — --:--.---"}
            </span>
            <button className="icon-button" type="button" aria-label="Fullscreen" title="Fullscreen is not available in this build." disabled>
              <Maximize2 size={15} />
            </button>
          </div>

          <div className="module viz-module">
            <div className="viz-ruler">
              {rulerTicks(analysis).map((tick, index) => (
                <span key={`${tick}-${index}`}>{tick}</span>
              ))}
            </div>
            <div
              className={`viz-frame ${analysis && activeTab === "overview" ? "interactive" : ""}`}
              aria-label="Audio overview selection"
              onPointerDown={activeTab === "overview" ? handleTimelinePointerDown : undefined}
              onPointerMove={activeTab === "overview" ? handleTimelinePointerMove : undefined}
              onPointerUp={activeTab === "overview" ? handleTimelinePointerUp : undefined}
              onPointerCancel={handleTimelinePointerCancel}
              onPointerLeave={handleTimelinePointerCancel}
            >
              {activeTab === "overview" ? (
                <div className="wave-overview">
                  <div className="wave-mid" aria-hidden="true" />
                  <div className="wave-bars" aria-hidden="true">
                    {waveformLevels.map((height, index) => (
                      <span
                        key={index}
                        style={{
                          height: `${Math.max(6, Math.round(height * 100))}%`,
                          opacity: analysis ? 0.74 + height * 0.26 : 0.16,
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
                      >
                        <span className="sel-edge left">
                          <span className="sel-handle tl" />
                          <span className="sel-handle bl" />
                        </span>
                        <span className="sel-edge right">
                          <span className="sel-handle tl" />
                          <span className="sel-handle bl" />
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="overview-empty">Select a track to render an audio-derived overview.</div>
                  )}
                </div>
              ) : null}

              {activeTab === "spectrum" ? (
                analysis?.spectrum?.length ? (
                  <div className="spectrum-bars" aria-hidden="true">
                    {analysis.spectrum.map((height, index) => (
                      <span key={index} style={{ height: `${Math.max(2, Math.round(height * 100))}%` }} />
                    ))}
                  </div>
                ) : (
                  <div className="overview-empty">Select a track to render its spectrum.</div>
                )
              ) : null}

              {activeTab === "loudness" ? (
                (analysis?.loudness?.length ?? 0) > 0 ? (
                  <div className="loudness" aria-hidden="true">
                    {analysis!.loudness!.map((height, index) => (
                      <span key={index} style={{ height: `${Math.max(3, Math.round(height * 100))}%` }} />
                    ))}
                  </div>
                ) : (
                  <div className="overview-empty">Select a track to render its loudness curve.</div>
                )
              ) : null}

              {activeTab === "metrics" ? (
                <div className="metrics-grid">
                  {metricsCells(analysis, report).map((cell) => (
                    <div key={cell.label} className="cell">
                      <span>{cell.label}</span>
                      <b>{cell.value}</b>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="info-strip">
              <div className="item">
                <span className="glyph" aria-hidden="true">
                  <Settings size={13} />
                </span>
                <div>
                  <span>Mode</span>
                  <div className="val">
                    <span className="txt">
                      {selectedMode.label} ({selectedMode.model})
                    </span>
                    {localMode ? <span className="badge">Local</span> : null}
                  </div>
                </div>
              </div>
              <div className="item">
                <span className="glyph" aria-hidden="true">
                  <CheckCircle2 size={13} />
                </span>
                <div>
                  <span>Status</span>
                  <div className={`val ${report || analysis ? "ok" : ""}`}>
                    {analysisStatus}
                    {report || analysis ? <CircleCheck size={13} /> : null}
                  </div>
                </div>
              </div>
              <div className="item">
                <span className="glyph" aria-hidden="true">
                  <Clock size={13} />
                </span>
                <div>
                  <span>Duration</span>
                  <div className="val">{durationCode}</div>
                </div>
              </div>
              <div className="item">
                <span className="glyph" aria-hidden="true">
                  <Waves size={13} />
                </span>
                <div>
                  <span>Sample Rate</span>
                  <div className="val">{sampleRateLabel}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="module stems-module">
            <div className="stems-head">
              <div className="section-heading">
                <span className="num">3</span>
                <span>Stems Preview</span>
              </div>
              <div className="solo-label">Solo</div>
              <div className="level-scale">
                {["-60", "-36", "-24", "-12", "-6", "0"].map((tick) => (
                  <span key={tick}>{tick}</span>
                ))}
              </div>
            </div>

            <div className="stem-list">
              {stemRows.map((stem) => {
                const muted = mutedStems.has(stem.path);
                const soloed = soloStem === stem.path;
                return (
                  <div
                    key={stem.key}
                    className={`stem-row ${activeStem === stem.path && stem.path ? "active" : ""} ${muted ? "muted" : ""}`}
                    style={{ ["--stem" as string]: stem.color }}
                  >
                    <span className="stem-icon" aria-hidden="true">
                      <StemGlyph name={stem.name} />
                    </span>
                    <span className="stem-name">
                      <b>{stem.name}</b>
                    </span>
                    <span className="stem-controls">
                      <button
                        type="button"
                        className={`sbtn ${soloed ? "on" : ""}`}
                        aria-label={`Solo ${stem.name}`}
                        aria-pressed={soloed}
                        disabled={!stem.path}
                        onClick={() => toggleSolo(stem.path)}
                      >
                        S
                      </button>
                      <button
                        type="button"
                        className={`sbtn ${muted ? "mute-on" : ""}`}
                        aria-label={`${muted ? "Unmute" : "Mute"} ${stem.name}`}
                        aria-pressed={muted}
                        disabled={!stem.path}
                        onClick={() => toggleMute(stem.path)}
                      >
                        {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
                      </button>
                    </span>
                    <span className="stem-wave" aria-hidden="true">
                      {stem.wave.map((height, index) => (
                        <span key={index} style={{ height: `${Math.max(5, Math.round(height * 100))}%` }} />
                      ))}
                    </span>
                    <span className="stem-db">{stem.dbLabel}</span>
                    <span className="stem-exp" aria-hidden={!stem.experimental}>
                      {stem.experimental ? <span className="badge exp">EXP</span> : null}
                    </span>
                    <span className="meter" aria-hidden="true">
                      <span className="fill" style={{ width: `${stem.meter}%` }} />
                    </span>
                    <button
                      type="button"
                      className="stem-expand"
                      aria-label={`Preview ${stem.name}`}
                      disabled={!stem.path}
                      onClick={() => toggleSolo(stem.path)}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="module transport">
            <div className="transport-buttons">
              <button
                className="tbtn play"
                type="button"
                aria-label={isPlaying ? "Stop preview" : "Play preview"}
                disabled={!report}
                onClick={togglePlay}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
              </button>
              <button
                className="tbtn stop"
                type="button"
                aria-label="Stop"
                disabled={!report}
                onClick={() => stopPlayback()}
              >
                <Square size={15} fill="currentColor" />
              </button>
            </div>

            <div className="preview-meta">
              <span className="name">Preview: {report ? previewLabel : "—"}</span>
              <span className="time">
                {formatClock(playhead.current)} / {formatClock(playhead.total || analysis?.durationSeconds || 0)}
              </span>
            </div>

            <div
              className={`scrub ${report ? "interactive" : ""}`}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(scrubPercent(playhead))}
              onPointerDown={handleScrubPointerDown}
              onPointerMove={handleScrubPointerMove}
              onPointerUp={handleScrubPointerUp}
              onPointerCancel={handleScrubPointerUp}
            >
              <div className="done" style={{ width: `${scrubPercent(playhead)}%` }} />
              <div className="knob" style={{ left: `${scrubPercent(playhead)}%` }} />
            </div>

            <div className="volume">
              {volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              <input
                type="range"
                className="range"
                min={0}
                max={100}
                value={Math.round(volume * 100)}
                aria-label="Volume"
                onChange={(event) => setVolume(Number(event.currentTarget.value) / 100)}
                style={{ ["--fill" as string]: `${Math.round(volume * 100)}%` }}
              />
            </div>

            <div className="seg" role="group" aria-label="Playback mode">
              <button
                type="button"
                className={playMode === "sequence" ? "on" : ""}
                aria-pressed={playMode === "sequence"}
                onClick={() => setPlayMode("sequence")}
              >
                Sequence
              </button>
              <button
                type="button"
                className={playMode === "all" ? "on" : ""}
                aria-pressed={playMode === "all"}
                onClick={() => setPlayMode("all")}
              >
                All
              </button>
            </div>
          </div>
        </section>

        {/* ---------------- Right rack ---------------- */}
        <aside className="rack right-rack" aria-label="Extraction report">
          <section className="module pad report-module">
            <div className="module-bar">
              <div className="section-heading">
                <span>Extraction Report</span>
              </div>
              <button
                className="link-button"
                type="button"
                disabled={!report}
                onClick={() => revealOutput()}
              >
                View Details
              </button>
            </div>
            <div className="report-list">
              <ReportRow icon={<FileMusic size={14} />} k="Source" v={sourceName} />
              <ReportRow icon={<Atom size={14} />} k="Mode" v={selectedMode.label} />
              <ReportRow icon={<Cpu size={14} />} k="Model" v={`${selectedMode.model}${localMode ? " (Local)" : ""}`} />
              <ReportRow
                icon={<CircleCheck size={14} />}
                k="Status"
                v={statusLabel}
                accent={statusLabel === "Completed"}
              />
              <ReportRow icon={<Clock size={14} />} k="Duration" v={durationCode} />
              <ReportRow icon={<Waves size={14} />} k="Sample Rate" v={sampleRateLabel} />
              <ReportRow icon={<Gauge size={14} />} k="Channels" v={channelsLabel} />
            </div>
          </section>

          <section className="module pad written-module">
            <div className="section-heading">
              <span>What Was Written</span>
            </div>
            <div className="written-list">
              {writtenRows.map((row) => (
                <div key={row.key} className={`written-row ${row.written ? "" : "pending"}`}>
                  <span className="check" aria-hidden="true">
                    {row.written ? <CircleCheck size={15} /> : <Square size={13} />}
                  </span>
                  <span className="file">{row.file}</span>
                  <span className="size">{row.size}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="module pad notes-module">
            <div className="section-heading">
              <span>Notes</span>
            </div>
            <p className="notes-text">{notesText}</p>
            {auditionError ? (
              <Toast kind="err" onClose={() => setAuditionError("")}>{auditionError}</Toast>
            ) : null}
            {error ? <Toast kind="err" onClose={() => setError("")}>{error}</Toast> : null}
            {exportMessage ? (
              <Toast kind="ok" onClose={() => setExportMessage("")}>{exportMessage}</Toast>
            ) : null}
            {exportError ? (
              <Toast kind="err" onClose={() => setExportError("")}>{exportError}</Toast>
            ) : null}
          </section>

          <section className="module pad export-module">
            <button
              className="export-button"
              type="button"
              disabled={!report || isExporting}
              onClick={exportAll}
            >
              <FolderInput size={17} />
              <span>{isExporting ? "Exporting…" : "Export All Stems"}</span>
            </button>
            <label className="export-format">
              <span>Format</span>
              <select
                value={exportFormat}
                disabled={isExporting}
                aria-label="Export format"
                onChange={(event) => setExportFormat(event.currentTarget.value as ExportFormat)}
              >
                <option value="wav24">WAV · 24-bit</option>
                <option value="wav16">WAV · 16-bit</option>
                <option value="wav32f">WAV · 32-bit float</option>
              </select>
            </label>
          </section>
        </aside>
      </section>

      <footer className="status-bar">
        <div className="output-folder">
          <span className="label">Output Folder</span>
          <button
            className="path"
            type="button"
            title={footerPath}
            disabled={!lastExportDir && !report}
            onClick={() => revealOutput(lastExportDir || report?.outputDir)}
          >
            <span>{footerPath}</span>
            <FolderOpen size={14} />
          </button>
        </div>

        <div className="trust">
          <div className="item">
            <span className="glyph" aria-hidden="true">
              <Atom size={16} />
            </span>
            <div>
              <b>100% LOCAL</b>
              <small>Your audio never leaves your machine.</small>
            </div>
          </div>
          <div className="item">
            <span className="glyph" aria-hidden="true">
              <Lock size={16} />
            </span>
            <div>
              <b>PRIVATE</b>
              <small>No uploads. No cloud. Ever.</small>
            </div>
          </div>
          <div className="item">
            <span className="glyph" aria-hidden="true">
              <Sparkles size={16} />
            </span>
            <div>
              <b>HONEST</b>
              <small>We show you what's possible.</small>
            </div>
          </div>
        </div>

        <div className={`ready ${isExtracting ? "busy" : ""}`}>
          <span className="pill">
            {isExtracting ? <BarChart3 size={13} /> : <AudioWaveform size={13} />}
            {isExtracting ? "WORKING" : "READY"}
          </span>
        </div>
      </footer>

      {showSettings ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          onClick={() => setShowSettings(false)}
        >
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>Settings</h2>
              <button
                className="icon-button"
                type="button"
                aria-label="Close settings"
                onClick={() => setShowSettings(false)}
              >
                <X size={16} />
              </button>
            </div>

            <div className="setting-row">
              <div className="setting-text">
                <strong>Default export folder</strong>
                <small>When set, Export skips the folder prompt.</small>
              </div>
              <div className="setting-control">
                <span className="setting-value" title={defaultExportDir || undefined}>
                  {defaultExportDir || "Ask every time"}
                </span>
                <button className="ghost-button" type="button" onClick={chooseDefaultExportDir}>
                  Choose…
                </button>
                {defaultExportDir ? (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setDefaultExportDir("")}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>

            <div className="setting-row">
              <div className="setting-text">
                <strong>Logs</strong>
                <small>Structured logs are written locally for troubleshooting.</small>
              </div>
              <button className="ghost-button" type="button" onClick={openLogs}>
                Open logs folder
              </button>
            </div>

            <div className="setting-row">
              <div className="setting-text">
                <strong>Reset preferences</strong>
                <small>Clear saved mode, cleanup, volume, and folders.</small>
              </div>
              <button className="ghost-button danger" type="button" onClick={resetPreferences}>
                Reset
              </button>
            </div>

            <div className="modal-foot">
              <span>YES Stems · 100% local, offline</span>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function Toast({
  kind,
  onClose,
  children,
}: {
  kind: "ok" | "err";
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`toast ${kind}`} role={kind === "err" ? "alert" : undefined}>
      <span className="toast-msg">{children}</span>
      <button type="button" className="toast-x" aria-label="Dismiss" onClick={onClose}>
        <X size={13} />
      </button>
    </div>
  );
}

function ReportRow({
  icon,
  k,
  v,
  accent,
}: {
  icon: ReactNode;
  k: string;
  v: string;
  accent?: boolean;
}) {
  return (
    <div className="row">
      <span className="glyph" aria-hidden="true">
        {icon}
      </span>
      <span className="k">{k}</span>
      <span className="v" style={accent ? { color: "var(--good)" } : undefined} title={v}>
        {v}
      </span>
    </div>
  );
}

function StemGlyph({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("vocal")) {
    return <Mic2 size={16} />;
  }
  if (lower.includes("drum") || lower.includes("percussion")) {
    return <Drum size={16} />;
  }
  if (lower.includes("bass")) {
    return <Music2 size={16} />;
  }
  if (lower.includes("guitar")) {
    return <Guitar size={16} />;
  }
  if (lower.includes("piano") || lower.includes("harmonic")) {
    return <Piano size={16} />;
  }
  if (lower.includes("instrumental")) {
    return <Layers3 size={16} />;
  }
  return <AudioWaveform size={16} />;
}

function ModeIcon({ mode, size }: { mode: StemMode; size: number }) {
  if (mode === "localMlSix") {
    return <Atom size={size} />;
  }
  if (mode === "localMlFour") {
    return <BrainCircuit size={size} />;
  }
  if (mode === "vocalInstrumental") {
    return <Mic2 size={size} />;
  }
  return <Layers3 size={size} />;
}

type StemRow = {
  key: string;
  name: string;
  path: string;
  color: string;
  experimental: boolean;
  dbLabel: string;
  meter: number;
  wave: number[];
};

function buildStemRows(report: ExtractionReport | null, mode: StemMode): StemRow[] {
  if (report) {
    return report.stems.map((stem) => {
      const db = dbfs(stem.peak);
      return {
        key: stem.path || stem.name,
        name: stem.name,
        path: stem.path,
        color: stemColor(stem.name),
        experimental: isExperimental(stem.name, report.mode),
        dbLabel: `${db} dB`,
        meter: meterPercent(stem.peak),
        wave: stemWave(stem.name),
      };
    });
  }
  return expectedStems[mode].map((file) => {
    const name = stemDisplayName(file);
    return {
      key: file,
      name,
      path: "",
      color: stemColor(name),
      experimental: isExperimental(name, mode),
      dbLabel: "— dB",
      meter: 0,
      wave: stemWave(name),
    };
  });
}

function stemColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("vocal")) return "var(--vocals)";
  if (lower.includes("drum") || lower.includes("percussion")) return "var(--drums)";
  if (lower.includes("bass")) return "var(--bass)";
  if (lower.includes("guitar")) return "var(--guitar)";
  if (lower.includes("piano") || lower.includes("harmonic")) return "var(--piano)";
  return "var(--other)";
}

function isExperimental(name: string, mode: StemMode): boolean {
  if (mode !== "localMlSix") {
    return false;
  }
  const lower = name.toLowerCase();
  return lower.includes("guitar") || lower.includes("piano");
}

function stemWave(seed: string): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  }
  return Array.from({ length: 190 }, (_, i) => {
    const value = Math.abs(Math.sin((i + 1) * (0.3 + (hash % 17) / 40) + hash));
    const env = 0.4 + 0.6 * Math.abs(Math.sin(i * 0.07 + (hash % 7)));
    return Math.min(1, 0.12 + value * env * 0.86);
  });
}

function meterPercent(peak: number): number {
  const db = peak > 0 ? 20 * Math.log10(peak) : -60;
  return Math.max(4, Math.min(100, ((db + 60) / 60) * 100));
}

function scrubPercent(playhead: { current: number; total: number }): number {
  if (!playhead.total) {
    return 0;
  }
  return Math.max(0, Math.min(100, (playhead.current / playhead.total) * 100));
}

function metricsCells(analysis: TrackAnalysis | null, report: ExtractionReport | null) {
  return [
    { label: "Sample Rate", value: analysis ? formatKHz(analysis.sampleRate) : "—" },
    { label: "Channels", value: analysis ? channelName(analysis.channels) : "—" },
    { label: "Duration", value: analysis ? formatTimecodeMs(analysis.durationSeconds) : "—" },
    { label: "Peak", value: analysis ? `${dbfs(analysis.peak)} dBFS` : "—" },
    { label: "Frames", value: analysis ? analysis.frames.toLocaleString() : "—" },
    {
      label: "Residual",
      value:
        report && report.reconstructionError >= 0
          ? `${(report.reconstructionError * 100).toFixed(2)}%`
          : "n/a",
    },
  ];
}

function stemNameFromPath(path: string, rows: StemRow[]): string {
  return rows.find((row) => row.path === path)?.name ?? "Stem";
}

function stemDisplayName(fileName: string) {
  const base = fileName.replace(/\.wav$/i, "").replace(/_/g, " ");
  return base.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isLocalMlMode(mode: StemMode) {
  return mode === "localMlSix" || mode === "localMlFour";
}

function cleanupStrengthLevel(percent: number) {
  return Math.max(0, Math.min(10, Math.round(percent / 10)));
}

function runButtonText(isExtracting: boolean, localMode: boolean, localRuntimeReady: boolean) {
  if (isExtracting) {
    return "Extracting…";
  }
  if (localMode && !localRuntimeReady) {
    return "Install local ML runtime";
  }
  return "Run Extraction";
}

function engineStatusText(mode: StemMode, status: LocalMlStatus | null) {
  if (!isLocalMlMode(mode)) {
    return "Classic DSP mode runs inside the Rust backend.";
  }
  if (!hasTauriRuntime()) {
    return "Web preview; the desktop build checks the local ML runtime.";
  }
  if (!status) {
    return "Checking local Demucs runtime…";
  }
  if (status.available) {
    return `Local ML ready via ${status.runner} on ${status.device}.`;
  }
  return status.detail;
}

function sourceExt(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toUpperCase() : "AUDIO";
}

function channelName(channels: number) {
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  return `${channels} ch`;
}

function formatKHz(sampleRate: number) {
  return `${(sampleRate / 1000).toFixed(1)} kHz`;
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

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatTimecodeMs(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe - minutes * 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  return `${minutes}:${String(remaining).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatBytes(bytes: number) {
  if (!bytes) {
    return "—";
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function waveformLevelsForAnalysis(analysis: TrackAnalysis | null) {
  if (!analysis?.waveformPeaks?.length) {
    return demoWaveform.map(() => 0.12);
  }
  const peak = Math.max(...analysis.waveformPeaks, 0.01);
  return analysis.waveformPeaks.map((value) => 0.08 + (value / peak) * 0.88);
}

function rulerTicks(analysis: TrackAnalysis | null) {
  if (!analysis) {
    return ["0:00", "0:30", "1:00", "1:30", "2:00", "2:30", "3:00"];
  }
  const duration = analysis.durationSeconds;
  const ticks: string[] = [];
  for (let t = 0; t < duration; t += 30) {
    ticks.push(formatDuration(t));
  }
  ticks.push(formatDuration(duration));
  return ticks;
}

function timelineRatioFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
}

function peakFromDb(db: number) {
  return Math.pow(10, db / 20);
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
