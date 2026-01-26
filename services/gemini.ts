import { GoogleGenAI, Type, Schema } from "@google/genai";

// --- API Key Rotation Logic ---
let currentKeyIndex = 0;

const getApiKeys = (): string[] => {
  const envVar = process.env.API_KEY;
  if (!envVar) {
    throw new Error("API Key is missing. Please check your environment configuration.");
  }
  // Support multiple keys separated by comma for fallback/rotation strategies
  return envVar.split(',').map(k => k.trim()).filter(k => k);
};

const getAiClient = () => {
  const keys = getApiKeys();
  if (keys.length === 0) throw new Error("No valid API Keys found.");
  
  // Ensure index is within bounds
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

// 18MB limit to leave room for base64 overhead within standard request limits (20MB)
const MAX_FILE_SIZE_BYTES = 18 * 1024 * 1024; 

// Helper to convert Blob/File to Base64
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (blob.size > MAX_FILE_SIZE_BYTES) {
      reject(new Error(`File size (${(blob.size / 1024 / 1024).toFixed(2)}MB) exceeds the 18MB limit for client-side processing. Please compress the audio or split it.`));
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Remove data url prefix (e.g. "data:audio/mp3;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Ensures the MIME type is one of the standard types supported by Gemini.
 * Maps common browser variations or raw types to standard containers.
 */
const normalizeMimeType = (mimeType: string): string => {
  const lower = mimeType.toLowerCase();
  
  // WAV variations
  if (lower.includes('wav') || lower === 'audio/s16le') return 'audio/wav';
  
  // MP3 variations
  if (lower === 'audio/mpeg3' || lower === 'audio/x-mpeg-3') return 'audio/mp3';
  
  // M4A/AAC variations (Gemini handles audio/mp4 or audio/aac)
  if (lower === 'audio/x-m4a' || lower === 'audio/m4a') return 'audio/mp4';
  
  // OGG
  if (lower === 'audio/x-ogg') return 'audio/ogg';

  return mimeType;
};

/**
 * Generic Retry Utility for API calls with Key Rotation Support.
 * Retries on 429 (Too Many Requests) and 503 (Service Unavailable).
 * Switches API Key on 429/403 if alternatives are available.
 */
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
    
    // Detect Quota/Rate Limit Errors
    const isRateLimit = status === 429 || message.includes("resource exhausted") || message.includes("429");
    const isQuotaError = status === 403 || message.includes("quota"); // Sometimes quota errors come as 403
    
    // Strategy 1: Switch Key if possible (Immediate Retry)
    if ((isRateLimit || isQuotaError) && trySwitchToNextKey()) {
       // Reset retries for the new key, or keep diminishing? 
       // We keep diminishing to avoid infinite loops, but do it immediately (no delay).
       return retryWithBackoff(operation, retries, 0, factor); 
    }

    // Strategy 2: Standard Backoff
    const isTransientError = isRateLimit || status === 503 || message.includes("Overloaded");

    if (retries > 0 && isTransientError) {
      console.warn(`API Overloaded/Limited. Retrying in ${delay}ms... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryWithBackoff(operation, retries - 1, delay * factor, factor);
    }
    
    throw error;
  }
}

/**
 * Step 1: Transcribe using Gemini 3 Flash (Combined Transcription + Formatting)
 * optimization: Reduces token usage by doing 1 pass instead of 2.
 */
export const generateDraftTranscription = async (
  base64Audio: string, 
  mimeType: string,
  guidelines: string
): Promise<string> => {
  const modelId = "gemini-3-flash-preview";
  const safeMimeType = normalizeMimeType(mimeType);

  const prompt = `
    SYSTEM ROLE: You are a strict, verbatim transcriber for Tunisian Arabic (Derja).

    RULES:
    1. WRITE EXACTLY WHAT YOU HEAR. Do not hallucinate. Do not "fix" grammar.
    2. NUMBERS: ALWAYS use digits (e.g., "5", "1990"). NEVER write numbers as words.
    3. Output as a single, unformatted paragraph.

    USER GUIDELINES (APPLY THESE):
    ${guidelines}

    Output only the transcription text.
  `;

  const operation = async () => {
    // IMPORTANT: Get client inside operation to pick up the correct rotated key
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: modelId,
      contents: {
        parts: [
          { inlineData: { mimeType: safeMimeType, data: base64Audio } },
          { text: prompt }
        ]
      },
      // Lower temperature to reduce hallucinations/creativity
      config: {
        temperature: 0.2, 
        topP: 0.95,
      }
    });
    const text = response.text;
    if (!text) throw new Error("No transcription generated.");
    return text.trim();
  };

  try {
    return await retryWithBackoff(operation);
  } catch (error: any) {
    console.error("Transcription error:", error);
    if (error.toString().includes("xhr error") || error.toString().includes("Rpc failed")) {
        throw new Error("Network error: The audio file might be too large for Gemini 3 Flash. Try a shorter clip or use a compressed format.");
    }
    throw error;
  }
};

/**
 * Step 2: Align Edited Text to JSON Skeleton
 * Uses Audio + Edited Text + JSON Skeleton -> Final JSON
 */
export const alignJsonToAudioAndText = async (
  base64Audio: string, 
  mimeType: string, 
  editedText: string,
  jsonSkeleton: string,
  guidelines: string
): Promise<string> => {
  const modelId = "gemini-3-flash-preview";
  const safeMimeType = normalizeMimeType(mimeType);

  // Simplified prompt to reduce input tokens and processing time
  const prompt = `
    ROLE: You are an audio-to-text aligner.
    TASK: Fill the "transcription" fields in the provided JSON Skeleton using the Reference Text.

    STRICT RULES:
    1. VERBATIM: Copy words from the "Reference Text" EXACTLY. Do not add or change words/numbers.
    2. STRUCTURE: Return the JSON Skeleton exactly as is, but with "transcription" filled.
    3. TIMESTAMPS: Do NOT change start/end times or speaker labels.

    Reference Text (Correct Source):
    ${editedText}

    JSON Skeleton (To Fill):
    ${jsonSkeleton}
  `;
  
  // Removed strict Schema object to improve inference speed significantly.
  // Gemini 3 Flash is capable of generating valid JSON without forced schema validation.

  const operation = async () => {
    // IMPORTANT: Get client inside operation to pick up the correct rotated key
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
        // Increased temperature slightly to prevent model from getting stuck on strict schema constraints
        temperature: 0.3, 
      }
    });

    const text = response.text;
    if (!text) throw new Error("No aligned JSON generated.");
    
    try {
        const parsed = JSON.parse(text);
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        return text;
    }
  };

  try {
    return await retryWithBackoff(operation);
  } catch (error) {
    console.error("Alignment error:", error);
    return JSON.stringify({ error: "Failed to align JSON", details: String(error) }, null, 2);
  }
};