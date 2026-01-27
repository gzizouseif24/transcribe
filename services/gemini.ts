import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ValidationReport } from "../types";

// --- API Key Rotation Logic ---
let currentKeyIndex = 0;

const getApiKeys = (): string[] => {
  const envVar = process.env.API_KEY;
  if (!envVar) {
    throw new Error("API Key is missing. Please check your environment configuration.");
  }
  return envVar.split(',').map(k => k.trim()).filter(k => k);
};

const getAiClient = () => {
  const keys = getApiKeys();
  if (keys.length === 0) throw new Error("No valid API Keys found.");
  const safeIndex = Math.min(currentKeyIndex, keys.length - 1);
  return new GoogleGenAI({ apiKey: keys[safeIndex] });
};

const trySwitchToNextKey = (): boolean => {
  const keys = getApiKeys();
  if (currentKeyIndex < keys.length - 1) {
    currentKeyIndex++;
    console.warn(`Quota limit reached on Key #${currentKeyIndex}. Switching to Key #${currentKeyIndex + 1}...`);
    return true;
  }
  return false;
};

const MAX_FILE_SIZE_BYTES = 18 * 1024 * 1024; 

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!blob) {
      reject(new Error("No file provided"));
      return;
    }
    if (blob.size > MAX_FILE_SIZE_BYTES) {
      reject(new Error(`File size (${(blob.size / 1024 / 1024).toFixed(2)}MB) exceeds the 18MB limit for client-side processing.`));
      return;
    }
    const reader = new FileReader();
    
    // Use onload instead of onloadend to ensure success
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        const parts = result.split(',');
        if (parts.length > 1) {
          resolve(parts[1]);
        } else {
          reject(new Error("Failed to encode audio: invalid data URL format"));
        }
      } else {
        reject(new Error("Failed to read file as Data URL"));
      }
    };
    
    reader.onerror = () => {
      reject(reader.error || new Error("Unknown FileReader error"));
    };
    
    reader.readAsDataURL(blob);
  });
};

const normalizeMimeType = (mimeType: string): string => {
  const lower = (mimeType || '').toLowerCase(); // Guard against null/undefined
  if (lower.includes('wav') || lower === 'audio/s16le') return 'audio/wav';
  if (lower === 'audio/mpeg3' || lower === 'audio/x-mpeg-3') return 'audio/mp3';
  if (lower === 'audio/x-m4a' || lower === 'audio/m4a') return 'audio/mp4';
  if (lower === 'audio/x-ogg') return 'audio/ogg';
  return mimeType || 'audio/mp3';
};

async function retryWithBackoff<T>(
  operation: () => Promise<T>, 
  retries = 3, 
  delay = 2000,
  factor = 2
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const status = error?.status || error?.response?.status;
    const message = error?.message || "";
    const isRateLimit = status === 429 || message.includes("resource exhausted") || message.includes("429");
    const isQuotaError = status === 403 || message.includes("quota");
    
    if ((isRateLimit || isQuotaError) && trySwitchToNextKey()) {
       return retryWithBackoff(operation, retries, 0, factor); 
    }

    const isTransientError = isRateLimit || status === 503 || message.includes("Overloaded");
    if (retries > 0 && isTransientError) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(operation, retries - 1, delay * factor, factor);
    }
    throw error;
  }
}

// --- HELPER: Deterministic Math Checks ---
const runDeterministicChecks = (segments: any[]): string[] => {
  const errors: string[] = [];
  if (!segments || segments.length < 1) return ["JSON is empty or has no segments."];

  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];
    const next = segments[i + 1];

    // 1. Basic Structure
    if (typeof current.end !== 'number' || typeof current.start !== 'number') {
        errors.push(`Segment #${i}: Missing start or end timestamp.`);
        continue;
    }

    // 2. Negative/Zero Duration
    const duration = current.end - current.start;
    if (duration <= 0) {
        errors.push(`Segment #${i}: Invalid duration (${duration.toFixed(3)}s). End time must be greater than Start time.`);
    }

    // 3. Unrealistic Duration (Physical impossibility)
    // Rule: "Long sentence in 0.2 seconds"
    // Heuristic: If text is provided, check chars per second. Limit: ~25 chars/sec is extremely fast speech.
    const text = current.transcription || current.text || "";
    if (text.length > 0 && duration > 0) {
        const charsPerSec = text.length / duration;
        if (charsPerSec > 35) { // Very loose threshold to avoid false positives on short words
            errors.push(`Unrealistic Duration (Segment #${i}): Text is too long (${text.length} chars) for duration (${duration.toFixed(2)}s).`);
        }
    } else if (duration < 0.1) {
        // Even without text, < 0.1s is suspicious for speech
        errors.push(`Unrealistic Duration (Segment #${i}): Segment is too short (${duration.toFixed(3)}s) to contain meaningful speech.`);
    }

    // 4. Timestamp Overlap
    // Rule: "Multiple segments share the same time range"
    if (next && typeof next.start === 'number') {
        if (current.end > next.start) {
             const overlap = current.end - next.start;
             // 20ms tolerance for minor floating point issues
             if (overlap > 0.02) {
                 errors.push(`Timestamp Overlap: Segment #${i} ends at ${current.end.toFixed(2)}s, but Segment #${i+1} starts at ${next.start.toFixed(2)}s.`);
             }
        }
    }
  }
  return errors;
};

/**
 * STEP 1: VALIDATION
 */
export const validateJsonWithAudio = async (
  base64Audio: string,
  mimeType: string,
  jsonSkeleton: string
): Promise<ValidationReport> => {
  const modelId = "gemini-3-flash-preview";
  const safeMimeType = normalizeMimeType(mimeType);

  let parsedSkeleton: any;
  try {
     parsedSkeleton = JSON.parse(jsonSkeleton);
  } catch (e) {
     return { isValid: false, errors: ["Invalid JSON Syntax"], warnings: [], stats: { audioSpeakerCount: 0, jsonSpeakerCount: 0, segmentCount: 0 }};
  }
  
  let segments: any[] = [];
  if (Array.isArray(parsedSkeleton)) segments = parsedSkeleton;
  else if (parsedSkeleton.segments) segments = parsedSkeleton.segments;
  else if (parsedSkeleton.transcription_segments) segments = parsedSkeleton.transcription_segments;
  
  // 1. Run Deterministic Math Checks (Overlaps, Speed, Duration)
  const mathErrors = runDeterministicChecks(segments);

  const distinctJsonSpeakers = new Set(segments.map((s: any) => s.speaker)).size;

  const prompt = `
  ROLE: Expert Audio Alignment QA (Derja).
  TASK: Validate the structural integrity of the JSON timestamps against the Audio.
  
  CRITICAL INSTRUCTION: 
  DO NOT VALIDATE TRANSCRIPTION ACCURACY. Ignore typos, spelling errors, or wrong words.
  ONLY Fail validation for the following structural/temporal errors:

  1. **Timestamp Misalignment**: 
     - Does the segment start too early or end too late compared to the audio wave?
     - Are the boundaries loose?
     
  2. **Missing Segment**: 
     - Is there clear human speech in the audio that has NO corresponding JSON segment?
     
  3. **Phantom Segment**: 
     - Does a segment exist in the JSON where the audio is just silence, noise, or music? (No speech).

  4. **Speaker Misattribution**: 
     - Is the Speaker ID (e.g., SPEAKER_01) consistent? Does the voice change without the ID changing?
     
  5. **Speaker Count Mismatch**: 
     - The JSON implies ${distinctJsonSpeakers} speakers. Does the audio actually contain ${distinctJsonSpeakers} distinct voices?

  INPUT JSON (First 100 segments):
  ${JSON.stringify(segments.slice(0, 100))}

  OUTPUT SCHEMA (JSON):
  {
    "isValid": boolean, 
    "errors": [
      "Missing Segment at 00:45",
      "Phantom Segment at #5 (Silence)", 
      "Speaker Mismatch at #12 (Voice changed)",
      "Misalignment at #3 (Starts too early)"
    ], 
    "warnings": string[], 
    "audioSpeakerCount": number
  }
  `;

  const operation = async () => {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          { inlineData: { mimeType: safeMimeType, data: base64Audio } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        temperature: 0.0, // Strict determinism
      }
    });

    const text = response.text;
    if (!text) throw new Error("No validation report generated.");
    
    try {
        const result = JSON.parse(text);
        
        // Merge AI errors with Math errors
        const combinedErrors = [...mathErrors, ...(result.errors || [])];
        // Only valid if both checks pass
        const isValid = combinedErrors.length === 0;

        return {
            isValid: isValid,
            errors: combinedErrors,
            warnings: result.warnings || [],
            stats: {
                audioSpeakerCount: result.audioSpeakerCount || 0,
                jsonSpeakerCount: distinctJsonSpeakers,
                segmentCount: segments.length
            }
        };
    } catch (e) {
        throw new Error("Failed to parse validation report.");
    }
  };

  return await retryWithBackoff(operation);
};

/**
 * STEP 2: GENERATE DRAFT (Streaming)
 */
export const generateDraftTranscription = async (
  base64Audio: string, 
  mimeType: string,
  guidelines: string,
  onProgress?: (text: string) => void
): Promise<string> => {
  const modelId = "gemini-3-flash-preview";
  const safeMimeType = normalizeMimeType(mimeType);

  const prompt = `
    SYSTEM ROLE: Transcriber for Tunisian Arabic (Derja).
    TASK: Transcribe the audio verbatim. 
    FORMAT: Single paragraph.
    GUIDELINES: ${guidelines}
  `;

  try {
      const ai = getAiClient();
      const responseStream = await ai.models.generateContentStream({
        model: modelId,
        contents: {
          parts: [
            { inlineData: { mimeType: safeMimeType, data: base64Audio } },
            { text: prompt }
          ]
        },
        config: { temperature: 0.2 }
      });

      let fullTranscript = "";
      for await (const chunk of responseStream) {
          const chunkText = chunk.text;
          if (chunkText) {
              fullTranscript += chunkText;
              if (onProgress) onProgress(fullTranscript);
          }
      }
      return fullTranscript;
  } catch (error: any) {
      if (error.toString().includes("xhr error") || error.toString().includes("Rpc failed")) {
        throw new Error("Network error during transcription.");
      }
      throw error;
  }
};

/**
 * STEP 3: ALIGN (Text -> JSON)
 */
export const alignJsonToAudioAndText = async (
    base64Audio: string, 
    mimeType: string, 
    referenceText: string,
    jsonSkeleton: string
  ): Promise<string> => {
    const modelId = "gemini-3-flash-preview";
    let originalJsonObj = JSON.parse(jsonSkeleton);
    let segmentsToAlign: any[] = [];
    
    if (Array.isArray(originalJsonObj)) segmentsToAlign = originalJsonObj;
    else if (originalJsonObj.transcription_segments) segmentsToAlign = originalJsonObj.transcription_segments;
    else if (originalJsonObj.segments) segmentsToAlign = originalJsonObj.segments;
    else throw new Error("Invalid JSON structure");
  
    const indexedSegments = segmentsToAlign.map((seg, idx) => ({ _index: idx, start: seg.start, end: seg.end, speaker: seg.speaker }));
    const contextJson = JSON.stringify(indexedSegments);
  
    const prompt = `
      ROLE: Alignment Engine.
      TASK: Distribute the "Reference Text" into the "Segments List".
      OUTPUT: JSON Array of objects [{ "_index": 0, "transcription": "..." }].
      
      Reference Text:
      ${referenceText}
  
      Segments List:
      ${contextJson}
    `;
    
    const operation = async () => {
        const ai = getAiClient();
        const response = await ai.models.generateContent({
            model: modelId,
            contents: { parts: [{ inlineData: { mimeType: normalizeMimeType(mimeType), data: base64Audio } }, { text: prompt }] },
            config: { responseMimeType: "application/json", temperature: 0.1 }
        });
        
        const minimalOutput = JSON.parse(response.text || "[]");
        if (!Array.isArray(minimalOutput)) throw new Error("AI returned invalid alignment format.");

        for (let i = 0; i < segmentsToAlign.length; i++) {
            const match = minimalOutput.find((item: any) => item._index === i);
            segmentsToAlign[i].transcription = match ? match.transcription : "";
        }
        return JSON.stringify(originalJsonObj, null, 2);
    };

    return await retryWithBackoff(operation);
};