use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::ipc::{Request, Response};
use tauri::State;

/// Bu oturumda yedeği alınmış dosyalar. Yedek, oturumdaki ilk kayıttan önce
/// bir kez alınır; böylece `.bak` her zaman uygulamayı açmadan önceki hâli tutar.
#[derive(Default)]
struct BackedUp(Mutex<HashSet<PathBuf>>);

#[tauri::command]
fn read_pdf(path: String) -> Result<Response, String> {
    fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path} okunamadı: {e}"))
}

/// Gövde ham PDF baytlarıdır; hedef yol `x-path` başlığında URI-encoded gelir.
#[tauri::command]
fn save_pdf(request: Request<'_>, backed_up: State<'_, BackedUp>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("PDF verisi ham bayt olarak gönderilmeli".into());
    };
    let path = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("x-path başlığı eksik")?;
    let path = PathBuf::from(
        percent_decode(path).ok_or("x-path başlığı çözülemedi")?,
    );

    {
        let mut set = backed_up.0.lock().unwrap();
        if !set.contains(&path) && path.exists() {
            let bak = sibling(&path, ".bak");
            fs::copy(&path, &bak).map_err(|e| format!("yedek alınamadı: {e}"))?;
            set.insert(path.clone());
        }
    }

    atomic_write(&path, bytes).map_err(|e| format!("{} yazılamadı: {e}", path.display()))
}

/// Uygulama komut satırından PDF yolu ile açıldıysa bu yolları döndürür.
#[tauri::command]
fn initial_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".pdf") && Path::new(a).is_file())
        .collect()
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    path.with_file_name(name)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = sibling(path, ".pdfviewer-tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if let Ok(meta) = fs::metadata(path) {
        let _ = fs::set_permissions(&tmp, meta.permissions());
    }
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(BackedUp::default())
        .invoke_handler(tauri::generate_handler![read_pdf, save_pdf, initial_files])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
