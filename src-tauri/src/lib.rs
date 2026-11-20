//! JARVIS desktop shell: window lifecycle, Python backend process, system
//! tray and the global show/hide hotkey (Ctrl+Shift+J).
//!
//! Backend lifecycle contract (Phase 1):
//! 1. spawn backend -> 2. poll `/health` -> 3. emit `backend://phase` events
//! (starting | ready | failed) that drive the UI splash/error screen ->
//! 4. kill the backend on exit. On Windows the child also joins a kill-on-close
//! Job Object, so it dies with the app even if the app crashes.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

/// Backend phase reported to the webview to drive splash / error screens.
#[derive(Clone, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
pub enum BackendPhase {
    Starting { message: String },
    Ready,
    Failed { message: String, detail: String },
}

/// Shared backend state: the child process, the reported phase and a
/// generation counter so old polling threads die after a restart.
pub struct BackendState {
    child: Mutex<Option<Child>>,
    phase: Mutex<BackendPhase>,
    generation: AtomicU64,
    /// Windows Job Object handle (as isize; 0 = not created yet).
    #[cfg(windows)]
    job_handle: Mutex<isize>,
}

impl BackendState {
    fn new() -> Self {
        Self {
            child: Mutex::new(None),
            phase: Mutex::new(BackendPhase::Starting {
                message: "Booting the JARVIS core…".into(),
            }),
            generation: AtomicU64::new(0),
            #[cfg(windows)]
            job_handle: Mutex::new(0),
        }
    }

    fn kill_child(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Backend port mirrors `backend/config.py` (JARVIS_PORT, default 8420).
fn backend_port() -> u16 {
    std::env::var("JARVIS_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8420)
}

/// Minimal HTTP readiness probe over raw TCP (no extra dependency).
fn backend_healthy(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let mut stream = match std::net::TcpStream::connect(&addr) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    let req = format!("GET /health HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = String::new();
    match stream.read_to_string(&mut buf) {
        Ok(_) => buf.starts_with("HTTP/1.1 200"),
        Err(_) => false,
    }
}

#[cfg(windows)]
fn assign_to_job(state: &BackendState, child: &Child) {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    let mut slot = state.job_handle.lock().unwrap();
    let job = if *slot == 0 {
        let handle = match unsafe { CreateJobObjectW(None, None) } {
            Ok(h) => h,
            Err(_) => return, // best-effort: without the job we still kill on exit
        };
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        unsafe {
            let _ = SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const core::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
        }
        *slot = handle.0 as isize;
        handle
    } else {
        HANDLE(*slot as *mut core::ffi::c_void)
    };

    unsafe {
        let _ = AssignProcessToJobObject(job, HANDLE(child.as_raw_handle()));
    }
}

/// Spawn the backend, put it in the kill-on-close job object, publish the
/// starting phase and launch the readiness polling thread.
fn start_backend(state: &Arc<BackendState>, app: &tauri::AppHandle) {
    let spawn_result = spawn_backend(app);

    let child = match spawn_result {
        Ok(child) => child,
        Err(err) => {
            let failed = BackendPhase::Failed {
                message: "JARVIS could not start its local core".into(),
                detail: err,
            };
            *state.phase.lock().unwrap() = failed.clone();
            let _ = app.emit("backend://phase", &failed);
            return;
        }
    };

    #[cfg(windows)]
    assign_to_job(state, &child);

    *state.child.lock().unwrap() = Some(child);
    println!("[jarvis] backend process started");

    let gen = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let starting = BackendPhase::Starting {
        message: "Booting the JARVIS core…".into(),
    };
    *state.phase.lock().unwrap() = starting.clone();
    let _ = app.emit("backend://phase", &starting);

    let poll_state = state.clone();
    let poll_app = app.clone();
    std::thread::spawn(move || poll_backend_health(poll_state, poll_app, gen));
}

/// Poll `/health` until the backend answers, the deadline passes, or a newer
/// generation supersedes this thread. Emits ready/failed phase events.
fn poll_backend_health(state: Arc<BackendState>, app: tauri::AppHandle, gen: u64) {
    let port = backend_port();
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut last_progress = Instant::now();
    let started = Instant::now();

    loop {
        if state.generation.load(Ordering::SeqCst) != gen {
            return; // restart_backend superseded this poller
        }

        if backend_healthy(port) {
            *state.phase.lock().unwrap() = BackendPhase::Ready;
            let _ = app.emit("backend://phase", BackendPhase::Ready);
            println!("[jarvis] backend ready on 127.0.0.1:{port}");
            return;
        }

        if Instant::now() >= deadline {
            let failed = BackendPhase::Failed {
                message: "The JARVIS core did not come up in time".into(),
                detail: format!(
                    "Backend did not answer /health on 127.0.0.1:{port} within 90 seconds. \
                     Check the backend logs; the Python venv may be missing or broken."
                ),
            };
            *state.phase.lock().unwrap() = failed.clone();
            let _ = app.emit("backend://phase", &failed);
            return;
        }

        // Periodic progress text for the splash screen.
        if last_progress.elapsed() >= Duration::from_secs(8) {
            last_progress = Instant::now();
            let secs = started.elapsed().as_secs();
            let starting = BackendPhase::Starting {
                message: format!("Still loading the JARVIS core… ({secs}s)"),
            };
            *state.phase.lock().unwrap() = starting.clone();
            let _ = app.emit("backend://phase", &starting);
        }

        std::thread::sleep(Duration::from_millis(500));
    }
}

#[tauri::command]
fn backend_phase(state: tauri::State<'_, Arc<BackendState>>) -> BackendPhase {
    state.phase.lock().unwrap().clone()
}

/// Kill the current backend and start a fresh one (used by the error screen).
#[tauri::command]
fn restart_backend(state: tauri::State<'_, Arc<BackendState>>, app: tauri::AppHandle) {
    state.kill_child();
    start_backend(&state, &app);
}

/// Locate the backend directory in dev and in packaged builds.
fn backend_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    // Dev: src-tauri sits next to the project root.
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend");
        if dev.join("main.py").exists() {
            return Some(dev.canonicalize().ok()?);
        }
    }
    // Packaged: backend shipped next to the executable.
    if let Some(exe_dir) = app
        .path()
        .executable_dir()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
    {
        let candidate = exe_dir.join("backend");
        if candidate.join("main.py").exists() {
            return Some(candidate);
        }
    }
    // Fallback: resource dir.
    if let Ok(resource) = app.path().resolve("backend", tauri::path::BaseDirectory::Resource) {
        if resource.join("main.py").exists() {
            return Some(resource);
        }
    }
    None
}

fn spawn_backend(app: &tauri::AppHandle) -> Result<Child, String> {
    let dir = backend_dir(app).ok_or("backend directory not found (main.py missing)")?;

    // Prefer the project venv, then any system python.
    let venv_python = dir.join(".venv").join("Scripts").join("python.exe");
    let python = if venv_python.exists() {
        venv_python
    } else {
        PathBuf::from("python")
    };

    #[cfg(windows)]
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new(&python);
        c.arg("main.py")
            .current_dir(&dir)
            .creation_flags(CREATE_NO_WINDOW);
        c
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut c = Command::new(&python);
        c.arg("main.py").current_dir(&dir);
        c
    };

    command.env("PYTHONUNBUFFERED", "1");
    command
        .spawn()
        .map_err(|e| format!("failed to spawn backend ({}): {}", python.display(), e))
}

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend = Arc::new(BackendState::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second launch: focus the existing window instead.
            toggle_main_window(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(backend.clone())
        .invoke_handler(tauri::generate_handler![backend_phase, restart_backend])
        .setup(move |app| {
            // ---- backend process + readiness gate ----
            start_backend(&backend, app.handle());

            // ---- mini player window (hidden; toggled from tray) ----
            let _mini = tauri::WebviewWindowBuilder::new(
                app,
                "mini",
                tauri::WebviewUrl::App("index.html#mini".into()),
            )
            .title("JARVIS Mini")
            .inner_size(300.0, 380.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .visible(false)
            .build()?;

            // ---- system tray ----
            let show = MenuItem::with_id(app, "show", "Show JARVIS", true, None::<&str>)?;
            let mini_item = MenuItem::with_id(app, "mini", "Toggle mini player", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &mini_item, &hide, &quit])?;

            TrayIconBuilder::with_id("jarvis-tray")
                .icon(app.default_window_icon().expect("app icon").clone())
                .tooltip("JARVIS")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "mini" => {
                        if let Some(mini) = app.get_webview_window("mini") {
                            let visible = mini.is_visible().unwrap_or(false);
                            let _ = if visible { mini.hide() } else { mini.show() };
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left click on the tray icon toggles the window too.
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, button_state: tauri::tray::MouseButtonState::Up, .. } = event {
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // ---- global hotkey: Ctrl+Shift+J ----
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyJ);
            app.global_shortcut().on_shortcut(shortcut, |app, _sc, _event| {
                if _event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    toggle_main_window(app);
                }
            })?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Windows / Desktop minimize-to-tray + floating blob:
            // Clicking ✕ on the main window hides it cleanly to the system tray and reveals
            // the floating mini blob window; choosing "Quit" from the tray exits completely.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(mini) = window.app_handle().get_webview_window("mini") {
                        let _ = mini.show();
                    }
                }
            }
            if let WindowEvent::Destroyed { .. } = event {
                if window.label() == "main" {
                    window.app_handle().exit(0);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building JARVIS")
        .run(|app, event| {
            // Explicit backend shutdown on every exit path; the kill-on-close
            // Job Object covers crash/panic paths as well.
            if matches!(
                event,
                RunEvent::ExitRequested { .. } | RunEvent::Exit
            ) {
                app.state::<Arc<BackendState>>().kill_child();
            }
        });
}
