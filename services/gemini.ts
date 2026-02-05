
import { GoogleGenAI, Type } from "@google/genai";
import { ValidationReport, ValidationError } from "../types";

const getApiKeys = (): string[] => {
  const envVar = process.env.API_KEY;
  if (!envVar) throw new Error("API Key is missing.");
  return envVar.split(',').map(k => k.trim()).filter(k => k);
};

const getAiClient = () => {
  const keys = getApiKeys();
  return new GoogleGenAI({ apiKey: keys[0] });
};

const normalizeMimeType = (mimeType: string): string => {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('wav')) return 'audio/wav';
  if (lower.includes('mp3')) return 'audio/mp3';
  return mimeType || 'audio/mp3';
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * AGENT 2: Structural Auditor
 */
const auditValidationErrors = async (
  jsonSkeleton: string, 
  rawErrors: ValidationError[],
  modelId: string
): Promise<{ verifiedErrors: ValidationError[] }> => {
  if (rawErrors.length === 0) return { verifiedErrors: [] };

  const prompt = `
    Verify if these "Acoustic Claims" are mathematically and structurally possible in this "JSON Code".
    JSON: ${jsonSkeleton.slice(0, 10000)}
    CLAIMS: ${JSON.stringify(rawErrors)}
    
    RULES: 
    1. Timestamp Overlap: Only verify if (end[n] - start[n+1]) is GREATER than 0.7 seconds. Ignore minor overlaps.
    2. Unrealistic Duration: Verify if (end - start) < 0.2s.
    3. Missing Segment: Verify if there are silence gaps in the JSON > 1.5s where the audio might have speech.
    4. Speaker Misattribution: Confirm if the claim of a wrong speaker ID matches a timestamp that exists in the JSON.
    
    IMPORTANT: All descriptions must be in English.
    
    OUTPUT JSON: { "verifiedErrors": [{ "tag": "English Tag", "time": "Timestamp", "description": "English Reason" }] }
  `;

  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: { responseMimeType: "application/json", temperature: 0.1 }
  });

  try {
    const result = JSON.parse(response.text || "{}");
    return { verifiedErrors: result.verifiedErrors || [] };
  } catch {
    return { verifiedErrors: rawErrors };
  }
};

/**
 * STEP 1: VALIDATION (Dual-Agent with Structured Error Logs)
 */
export const validateJsonWithAudio = async (
  base64Audio: string,
  mimeType: string,
  jsonSkeleton: string,
  modelId: string
): Promise<ValidationReport> => {
  const safeMimeType = normalizeMimeType(mimeType);
  const ai = getAiClient();

  const acousticPrompt = `
    QA this JSON against the Audio. 
    
    CRITICAL INSTRUCTIONS:
    1. IGNORE the "transcription" text field entirely. Do not flag typos, wrong words, or language issues.
    2. IGNORE speaker-to-text mismatches (what they say).
    3. ONLY focus on these structural/acoustic errors:
       - [Speaker Count Mismatch]: Audio has a different total number of unique voices than the JSON speaker IDs.
       - [Speaker Misattribution]: A segment is assigned to Speaker ID X, but the voice heard at that time clearly belongs to Speaker ID Y's profile. (Identify by voice sound only).
       - [Phantom Segment]: A segment exists in JSON where there is no speech in audio.
       - [Missing Segment]: A speaker is talking in audio but no segment exists in JSON for that duration.
       - [Timestamp Overlap]: ONLY flag if segments overlap by MORE THAN 0.7 seconds.
    
    For every error found, return:
    - tag: (Use ONLY: [Speaker Count Mismatch, Speaker Misattribution, Phantom Segment, Missing Segment, Timestamp Overlap, Unrealistic Duration])
    - time: Exact timestamp (e.g. 00:04.2)
    - description: Brief reason in ENGLISH explaining the structural error.

    JSON Snippet: ${jsonSkeleton.slice(0, 5000)}
    OUTPUT JSON: { "errors": [{"tag": string, "time": string, "description": string}], "audioSpeakerCount": number }
  `;

  const acousticResponse = await ai.models.generateContent({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: safeMimeType, data: base64Audio } },
        { text: acousticPrompt }
      ]
    },
    config: { responseMimeType: "application/json", temperature: 0.0 }
  });

  const acousticResult = JSON.parse(acousticResponse.text || '{"errors":[]}');
  const { verifiedErrors } = await auditValidationErrors(jsonSkeleton, acousticResult.errors || [], modelId);

  return {
    isValid: verifiedErrors.length === 0,
    errors: verifiedErrors,
    warnings: [],
    stats: {
      audioSpeakerCount: acousticResult.audioSpeakerCount || 0,
      jsonSpeakerCount: 0,
      segmentCount: 0
    }
  };
};

/**
 * STEP 2: GENERATE DRAFT
 */
export const generateDraftTranscription = async (
  base64Audio: string, 
  mimeType: string,
  guidelines: string,
  modelId: string,
  onProgress?: (text: string) => void
): Promise<string> => {
  const ai = getAiClient();
  const systemPrompt = `
    ROLE: Professional Verbatim Tunisian Arabic Transcriber.
    GOLDEN RULE: "Write exactly what you hear, not what you think should be said."
    FORMAT: One single paragraph only. NO TIMESTAMPS.
    RULES: Verbatim repetition, no elongation, tags for [music], [laughter], etc.
    TRANSCRIPTION GUIDELINES: ${guidelines}
  `;

  const responseStream = await ai.models.generateContentStream({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: normalizeMimeType(mimeType), data: base64Audio } },
        { text: systemPrompt }
      ]
    }
  });

  let fullTranscript = "";
  for await (const chunk of responseStream) {
    const chunkText = chunk.text;
    if (chunkText) {
      fullTranscript += chunkText;
      if (onProgress) onProgress(fullTranscript);
    }
  }
  return fullTranscript.replace(/\[\d+:\d+\]/g, '').replace(/\d{2}:\d{2}/g, '').trim();
};

/**
 * STEP 3: FORCED ALIGNMENT (Correction -> JSON)
 */
export const alignJsonToAudioAndText = async (
  base64Audio: string, 
  mimeType: string, 
  referenceText: string,
  jsonSkeleton: string,
  modelId: string
): Promise<string> => {
  const aiClient = getAiClient();
  const prompt = `
    ROLE: Forced Aligner (High Precision).
    
    SOURCE TEXT (Absolute Truth):
    "${referenceText}"

    JSON SKELETON (Old Structure):
    ${jsonSkeleton}

    TASK:
    1. The SOURCE TEXT contains line breaks (\\n). Treat each line as the intended text for a single segment in the JSON SKELETON. Use these line breaks as primary structural anchors for mapping.
    2. Distribute the SOURCE TEXT into the "transcription" fields of the JSON SKELETON based on these lines.
    3. Use the audio to confirm segment boundaries, but respect the line-to-segment mapping provided by the user via line breaks.
    4. KEEP ALL OLD KEYS (start, end, speaker, id, duration) EXACTLY AS THEY ARE in the Skeleton.
    5. DO NOT ADD OR REMOVE WORDS from the Source Text.
    6. Return the COMPLETE JSON object. DO NOT TRUNCATE.
  `;

  const response = await aiClient.models.generateContent({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: normalizeMimeType(mimeType), data: base64Audio } },
        { text: prompt }
      ]
    },
    config: { responseMimeType: "application/json", temperature: 0.1 }
  });

  return response.text || jsonSkeleton;
};
