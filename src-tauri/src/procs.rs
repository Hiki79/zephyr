//! Process lifetime helpers for the mihomo core.
//!
//! Two failure modes left orphaned cores behind: the app dying without running
//! its exit hook (crash, or the installer force-killing `zephyr.exe`), and a
//! restart racing another restart so one spawned child was never tracked.
//! Every orphan kept holding its ports, so the next start probed past them and
//! the port drifted upward one step per restart.
//!
//! The fix is a Windows Job Object with `KILL_ON_JOB_CLOSE`: every core we spawn
//! is assigned to it, so the kernel terminates them the moment the last handle
//! closes, which happens whenever this process ends, however it ends. A sweep at
//! startup then removes cores a *previous* instance may have left behind.

#[cfg(windows)]
mod imp {
    use std::path::Path;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE, MAX_PATH};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// A kill-on-close job. Dropping it (or this process ending) terminates
    /// every process that was ever assigned and is still alive.
    pub struct Job(HANDLE);

    // A HANDLE is an opaque kernel token; moving it between threads is fine.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn new() -> Option<Self> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Job(handle))
            }
        }

        /// Put a process under this job. Fails (harmlessly) if it already exited.
        pub fn assign(&self, pid: u32) -> bool {
            unsafe {
                let process = OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid);
                if process.is_null() {
                    return false;
                }
                let ok = AssignProcessToJobObject(self.0, process) != 0;
                CloseHandle(process);
                ok
            }
        }

        /// Kill every live process in the job. The job stays usable afterwards.
        pub fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    /// Terminate every running process whose executable is exactly `path`.
    /// Matching on the full path, not just the file name, means another
    /// client's own mihomo binary is never touched. Returns how many died.
    pub fn kill_processes_at(path: &Path) -> usize {
        let Some(wanted_name) = path.file_name().and_then(|n| n.to_str()) else {
            return 0;
        };
        let wanted_name = wanted_name.to_ascii_lowercase();
        let wanted_path = normalize(path);
        let mut killed = 0;

        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return 0;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut more = Process32FirstW(snapshot, &mut entry) != 0;
            while more {
                if utf16_until_nul(&entry.szExeFile).to_ascii_lowercase() == wanted_name {
                    let process = OpenProcess(
                        PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE,
                        0,
                        entry.th32ProcessID,
                    );
                    if !process.is_null() {
                        let mut buf = [0u16; (MAX_PATH as usize) * 2];
                        let mut len = buf.len() as u32;
                        let got = QueryFullProcessImageNameW(
                            process,
                            PROCESS_NAME_WIN32,
                            buf.as_mut_ptr(),
                            &mut len,
                        ) != 0;
                        if got {
                            let full = String::from_utf16_lossy(&buf[..len as usize]);
                            if normalize(Path::new(&full)) == wanted_path
                                && TerminateProcess(process, 1) != 0
                            {
                                killed += 1;
                            }
                        }
                        CloseHandle(process);
                    }
                }
                more = Process32NextW(snapshot, &mut entry) != 0;
            }
            CloseHandle(snapshot);
        }
        killed
    }

    /// Case-insensitive, `\\?\`-free, backslash-only form for path equality.
    fn normalize(path: &Path) -> String {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        canonical
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .to_ascii_lowercase()
    }

    fn utf16_until_nul(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::process::{Command, Stdio};
        use std::time::{Duration, Instant};

        fn wait_exit(child: &mut std::process::Child, max: Duration) -> bool {
            let start = Instant::now();
            while start.elapsed() < max {
                if let Ok(Some(_)) = child.try_wait() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            false
        }

        /// A long-lived throwaway process: our own copy of cmd.exe, so the
        /// by-path kill can never reach a real cmd.exe on the machine.
        fn spawn_sleeper(exe: &Path) -> std::process::Child {
            Command::new(exe)
                .args(["/c", "ping -n 60 127.0.0.1 >nul"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn sleeper")
        }

        fn private_cmd_copy(tag: &str) -> std::path::PathBuf {
            let dir = std::env::temp_dir().join(format!("zephyr-procs-test-{tag}"));
            std::fs::create_dir_all(&dir).unwrap();
            let target = dir.join("mihomo.exe");
            std::fs::copy(r"C:\Windows\System32\cmd.exe", &target).unwrap();
            target
        }

        #[test]
        fn terminate_kills_assigned_process() {
            let exe = private_cmd_copy("job");
            let job = Job::new().expect("job object");
            let mut child = spawn_sleeper(&exe);
            assert!(job.assign(child.id()), "assign to job");
            job.terminate();
            assert!(wait_exit(&mut child, Duration::from_secs(5)), "child died with the job");
        }

        #[test]
        fn dropping_job_kills_process() {
            let exe = private_cmd_copy("drop");
            let mut child = spawn_sleeper(&exe);
            {
                let job = Job::new().expect("job object");
                assert!(job.assign(child.id()));
            } // drop closes the last handle -> KILL_ON_JOB_CLOSE
            assert!(wait_exit(&mut child, Duration::from_secs(5)), "child died when job closed");
        }

        #[test]
        fn kill_by_path_only_hits_that_binary() {
            let exe = private_cmd_copy("path");
            let mut a = spawn_sleeper(&exe);
            let mut b = spawn_sleeper(&exe);
            // A real cmd.exe (different path, same file name) must survive.
            let mut bystander = Command::new(r"C:\Windows\System32\cmd.exe")
                .args(["/c", "ping -n 60 127.0.0.1 >nul"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            std::thread::sleep(Duration::from_millis(300));

            let killed = kill_processes_at(&exe);
            assert!(killed >= 2, "expected both copies killed, got {killed}");
            assert!(wait_exit(&mut a, Duration::from_secs(5)));
            assert!(wait_exit(&mut b, Duration::from_secs(5)));
            assert!(bystander.try_wait().unwrap().is_none(), "real cmd.exe must not be touched");
            let _ = bystander.kill();
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use std::path::Path;
    pub struct Job;
    impl Job {
        pub fn new() -> Option<Self> {
            None
        }
        pub fn assign(&self, _pid: u32) -> bool {
            false
        }
        pub fn terminate(&self) {}
    }
    pub fn kill_processes_at(_path: &Path) -> usize {
        0
    }
}

pub use imp::*;
