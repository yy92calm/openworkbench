/** Whisper.cpp transcription bridge.
 *  Spawns the bundled whisper-cli binary with a quantized tiny model
 *  to transcribe a WAV audio file — fully offline. */

import { spawn } from "child_process";
import { join } from "path";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir, platform } from "os";
import { app } from "electron";
import { getLogger } from "./logging";

const BINARY_NAME = platform() === "win32" ? "whisper-cli.exe" : "whisper-cli";

/** Resolve the whisper binary and model paths.
 *  In development: apps/desktop/binaries/whisper/
 *  In packaged app: <resources>/binaries/whisper/ */
function whisperDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "binaries", "whisper");
  }
  // Dev: relative to the main process entry
  return join(__dirname, "..", "..", "binaries", "whisper");
}

export function isWhisperAvailable(): boolean {
  const dir = whisperDir();
  return existsSync(join(dir, BINARY_NAME)) && existsSync(join(dir, "ggml-tiny-q5_1.bin"));
}

/** Transcribe a WAV buffer. Returns the recognized text. */
export function transcribeWav(wavBuffer: Buffer, lang = "zh"): Promise<string> {
  const log = getLogger();
  const dir = whisperDir();
  const binary = join(dir, BINARY_NAME);
  const model = join(dir, "ggml-tiny-q5_1.bin");

  if (!existsSync(binary) || !existsSync(model)) {
    return Promise.reject(new Error("whisper-cli or model not found"));
  }

  // Write WAV to a temp file (whisper-cli reads from file path).
  const tmpFile = join(tmpdir(), `whisper-${Date.now()}.wav`);
  writeFileSync(tmpFile, wavBuffer);

  return new Promise<string>((resolve, reject) => {
    const proc = spawn(binary, [
      "-m", model,
      "-f", tmpFile,
      "-t", "4",          // 4 threads
      "-l", lang,         // language
      "--no-timestamps",  // clean text output
      "-nt",              // no token-level timestamps in output
    ], {
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.on("close", (code: number) => {
      // Clean up temp file
      try { unlinkSync(tmpFile); } catch { /* ignore */ }

      if (code !== 0) {
        log.warn(`[whisper] exited with code ${code}: ${stderr}`);
        reject(new Error(`whisper-cli failed (exit ${code})`));
        return;
      }

      // whisper.cpp prints transcribed text to stdout, possibly with some
      // preamble lines. The actual text is after the last ">> " marker or
      // just the remaining non-empty lines.
      const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
      // Filter out metadata lines that whisper.cpp prints
      const text = lines
        .filter((l) => !l.startsWith("whisper_") && !l.startsWith("[") && !l.startsWith("#") && !l.startsWith("system_info"))
        .join(" ")
        .trim();

      resolve(text || stdout.trim());
    });

    proc.on("error", (err: Error) => {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      reject(err);
    });
  });
}
