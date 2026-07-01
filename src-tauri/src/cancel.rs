use std::{
    io,
    process::{Child, ExitStatus},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

/// A cooperative cancellation token shared between the Tauri command layer and the
/// extraction engines. The classic DSP path polls [`CancelToken::is_cancelled`] at phase
/// boundaries; the Demucs path registers its child process so [`CancelToken::cancel`] can
/// terminate it immediately instead of waiting for a multi-minute run to finish.
#[derive(Clone, Default)]
pub struct CancelToken {
    cancelled: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
}

impl CancelToken {
    /// Clear cancellation state at the start of a run (drops any stale child handle).
    pub fn reset(&self) {
        self.cancelled.store(false, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock() {
            *guard = None;
        }
    }

    /// Request cancellation and kill any registered child process.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.child.lock()
            && let Some(child) = guard.as_mut()
        {
            let _ = child.kill();
        }
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// Register a spawned child so a concurrent [`CancelToken::cancel`] can terminate it.
    pub fn register_child(&self, child: Child) {
        let mut guard = self.child.lock().unwrap_or_else(|error| error.into_inner());
        *guard = Some(child);
    }

    /// Poll the registered child: returns its exit status once it has exited (and drops the
    /// handle), or `None` while it is still running or no child is registered.
    pub fn poll_child(&self) -> io::Result<Option<ExitStatus>> {
        let mut guard = self.child.lock().unwrap_or_else(|error| error.into_inner());
        let Some(child) = guard.as_mut() else {
            return Ok(None);
        };
        match child.try_wait()? {
            Some(status) => {
                *guard = None;
                Ok(Some(status))
            }
            None => Ok(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn sleep_command(seconds: u32) -> Command {
        if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/C", &format!("ping -n {} 127.0.0.1 >NUL", seconds + 1)]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", &format!("sleep {seconds}")]);
            command
        }
    }

    #[test]
    fn tracks_and_resets_cancellation() {
        let token = CancelToken::default();
        assert!(!token.is_cancelled());
        token.cancel();
        assert!(token.is_cancelled());
        token.reset();
        assert!(!token.is_cancelled());
    }

    #[test]
    fn cancel_kills_a_registered_child() {
        let token = CancelToken::default();
        let child = sleep_command(30).spawn().expect("spawn sleeper");
        token.register_child(child);

        // Still running before cancellation.
        assert!(token.poll_child().expect("poll").is_none());

        token.cancel();

        // The child is terminated promptly; poll should report an exit status.
        let mut status = None;
        for _ in 0..50 {
            if let Some(exited) = token.poll_child().expect("poll") {
                status = Some(exited);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(status.is_some(), "cancelled child should exit");
        assert!(
            !status.unwrap().success(),
            "a killed child is not a success"
        );
    }
}
