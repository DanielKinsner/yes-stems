//! Pre-flight OOM guard for stem separation.
//!
//! Separation allocates large intermediate buffers proportional to track length. The in-process
//! STFT path in `separation.rs` alone spikes into the hundreds of MB on a multi-minute stereo
//! track and scales linearly with duration; the local ML path feeds the whole track to Demucs.
//! On an 8 GB machine a very long track can exhaust RAM and hard-crash the app — a shipping
//! blocker. This is the cheap mitigation: a hard duration cap that refuses the job *before* the
//! heavy work, plus a soft warn band above which the job still runs but is flagged as heavy.
//!
//! The full fix (chunked / streaming separation) is deferred to a later version; this keeps a
//! long track from taking the whole app down in the meantime.

/// Hard ceiling. A track longer than this is refused before any large allocation / Demucs launch.
pub const MAX_SEPARATION_SECONDS: f64 = 720.0; // 12 minutes

/// Soft threshold. Tracks between this and the hard cap still run, but are flagged as heavy.
pub const WARN_SEPARATION_SECONDS: f64 = 420.0; // 7 minutes

/// Outcome of the pre-flight duration check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreflightVerdict {
    /// Safe to proceed.
    Ok,
    /// Proceed, but flag it (logged) — heavy on low-RAM machines.
    Warn(String),
    /// Refuse: over the hard cap. Carries a user-facing message.
    Reject(String),
}

/// Render a duration as `"Xm YYs"` (or `"Ys"` under a minute) for human-facing messages.
fn format_minutes(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let minutes = total / 60;
    let secs = total % 60;
    if minutes == 0 {
        format!("{secs}s")
    } else {
        format!("{minutes}m {secs:02}s")
    }
}

/// Judge a track's duration against the separation memory caps.
///
/// Boundaries are strict: a track *exactly* at `MAX_SEPARATION_SECONDS` warns (it is not over the
/// cap), and one *exactly* at `WARN_SEPARATION_SECONDS` is `Ok`. A non-finite or non-positive
/// duration (unknown / empty input) is treated as `Ok`: the guard never false-rejects on missing
/// metadata — the decode path handles empty input on its own.
#[must_use]
pub fn preflight(duration_seconds: f64) -> PreflightVerdict {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return PreflightVerdict::Ok;
    }

    if duration_seconds > MAX_SEPARATION_SECONDS {
        return PreflightVerdict::Reject(format!(
            "This track is {} long, over the {} limit for stem separation. Separating a track \
             this long can exhaust memory and crash the app. Trim it to a shorter section and \
             try again.",
            format_minutes(duration_seconds),
            format_minutes(MAX_SEPARATION_SECONDS),
        ));
    }

    if duration_seconds > WARN_SEPARATION_SECONDS {
        return PreflightVerdict::Warn(format!(
            "Track is {} long — separation may use a lot of memory and run slowly on machines \
             with 8 GB of RAM or less.",
            format_minutes(duration_seconds),
        ));
    }

    PreflightVerdict::Ok
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_track_is_ok() {
        assert_eq!(preflight(180.0), PreflightVerdict::Ok);
        assert_eq!(preflight(1.0), PreflightVerdict::Ok);
    }

    #[test]
    fn warn_boundary_is_strict() {
        // Exactly at the warn threshold is still Ok; just over it warns.
        assert_eq!(preflight(WARN_SEPARATION_SECONDS), PreflightVerdict::Ok);
        assert!(matches!(
            preflight(WARN_SEPARATION_SECONDS + 0.1),
            PreflightVerdict::Warn(_)
        ));
    }

    #[test]
    fn mid_band_warns() {
        assert!(matches!(preflight(600.0), PreflightVerdict::Warn(_)));
    }

    #[test]
    fn max_boundary_is_strict() {
        // Exactly at the hard cap warns (not over); just over it rejects.
        assert!(matches!(
            preflight(MAX_SEPARATION_SECONDS),
            PreflightVerdict::Warn(_)
        ));
        assert!(matches!(
            preflight(MAX_SEPARATION_SECONDS + 0.1),
            PreflightVerdict::Reject(_)
        ));
    }

    #[test]
    fn long_track_is_rejected_with_message() {
        match preflight(900.0) {
            PreflightVerdict::Reject(message) => {
                assert!(message.contains("15m 00s"), "message was: {message}");
                assert!(message.contains("12m 00s"), "message was: {message}");
            }
            other => panic!("expected Reject, got {other:?}"),
        }
    }

    #[test]
    fn unknown_or_empty_duration_never_rejects() {
        assert_eq!(preflight(0.0), PreflightVerdict::Ok);
        assert_eq!(preflight(-5.0), PreflightVerdict::Ok);
        assert_eq!(preflight(f64::NAN), PreflightVerdict::Ok);
        assert_eq!(preflight(f64::INFINITY), PreflightVerdict::Ok);
    }

    #[test]
    fn format_minutes_renders_expected() {
        assert_eq!(format_minutes(0.0), "0s");
        assert_eq!(format_minutes(45.0), "45s");
        assert_eq!(format_minutes(60.0), "1m 00s");
        assert_eq!(format_minutes(725.0), "12m 05s");
    }
}
