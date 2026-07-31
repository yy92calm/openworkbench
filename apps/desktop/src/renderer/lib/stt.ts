/** Offline Speech-to-Text via Whisper.cpp.
 *
 * Records audio as 16kHz mono PCM using AudioContext + ScriptProcessor,
 * encodes it as a WAV file, then sends the buffer to the main process
 * where the bundled whisper-cli binary transcribes it — fully offline. */

export type SttResultCallback = (text: string) => void;
export type SttErrorCallback = (error: string) => void;

/** Check whether whisper transcription is available. */
export async function isSttSupported(): Promise<boolean> {
  try {
    return (await window.electronAPI?.whisperAvailable?.()) ?? false;
  } catch {
    return false;
  }
}

// --- WAV encoding ---

/** Encode raw Float32 PCM samples into a 16-bit WAV ArrayBuffer. */
function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");

  // fmt chunk
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);    // chunk size
  view.setUint16(20, 1, true);     // audio format = PCM
  view.setUint16(22, 1, true);    // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);     // block align
  view.setUint16(34, 16, true);    // bits per sample

  // data chunk
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  // Write 16-bit PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

// --- Recorder ---

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let processor: ScriptProcessorNode | null = null;
let chunks: Float32Array[] = [];
let recording = false;

/** Start recording audio at 16kHz mono. */
async function startRecording(): Promise<void> {
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);
  // ScriptProcessor is deprecated but widely supported and the simplest way
  // to capture raw PCM in a single process call. AudioWorklet would require a
  // separate worklet file bundled as a resource — overkill for this use case.
  processor = audioContext.createScriptProcessor(4096, 1, 1);
  chunks = [];

  processor.onaudioprocess = (e: AudioProcessingEvent) => {
    const data = e.inputBuffer.getChannelData(0);
    // Copy — the underlying buffer is reused by the browser.
    chunks.push(new Float32Array(data));
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  recording = true;
}

/** Stop recording, return the WAV-encoded audio buffer. */
function stopRecording(): ArrayBuffer {
  if (!processor || !audioContext || !mediaStream) {
    throw new Error("not recording");
  }
  recording = false;
  processor.disconnect();
  audioContext.close();
  mediaStream.getTracks().forEach((t) => t.stop());
  processor = null;
  audioContext = null;
  mediaStream = null;

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const pcm = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.length;
  }
  chunks = [];

  return encodeWav(pcm, 16000);
}

function isRecording(): boolean {
  return recording;
}

// --- Public API: record → transcribe ---

/** Start recording. Call stopAndTranscribe to get the text. */
export async function startListening(): Promise<void> {
  await startRecording();
}

/** Stop recording and transcribe the audio via whisper.cpp. Returns the text. */
export async function stopAndTranscribe(
  onResult: SttResultCallback,
  onError: SttErrorCallback,
  lang = "zh",
): Promise<void> {
  try {
    const wavBuffer = stopRecording();
    const text = await window.electronAPI?.whisperTranscribe?.(wavBuffer, lang);
    if (text) onResult(text.trim());
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

/** Cancel recording without transcribing. */
export function cancelListening(): void {
  if (!recording) return;
  recording = false;
  if (processor) processor.disconnect();
  if (audioContext) audioContext.close();
  if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
  processor = null;
  audioContext = null;
  mediaStream = null;
  chunks = [];
}

export { isRecording };
