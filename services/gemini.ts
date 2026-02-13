
import { GoogleGenAI, Type } from "@google/genai";
import { ValidationReport, ValidationError } from "../types";

// Always initialize GoogleGenAI with a named parameter using process.env.API_KEY.
// Create a new instance right before making an API call to ensure the latest key is used.
const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");
  return new GoogleGenAI({ apiKey });
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
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * AGENT 2: Structural Auditor (Audit validation claims against JSON math)
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
    
    VERIFICATION LOGIC: 
    1. Timestamp Overlap: Flag as error ONLY if (start_time of segment N) is EARLIER than (end_time of segment N-1) by more than 0.7 seconds (interference).
    2. Speaker Misattribution: Confirm if the claim identifies a specific segment ID and if that segment exists.
    3. Missing Segment: Cross-reference the claim's time range with the JSON's timeline.
    
    IMPORTANT: All descriptions must be in English.
    
    OUTPUT JSON: { "verifiedErrors": [{ "tag": string, "time": string, "description": string }] }
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
 * STEP 1: VALIDATION (Dual-Agent Triangulation)
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
    QA this JSON against the Audio using the following strict Acoustic Definitions:
    
    DEFINITIONS FOR ERRORS:
    1. [Missing Segment]: Flag ONLY if you hear human speech in a gap where NO segment exists in the JSON. If there is silence in a gap, it is NOT an error.
    2. [Phantom Segment]: Flag ONLY if a segment exists in the JSON, but there is NO human speech (only silence, noise, or music) during that duration.
    3. [Speaker Misattribution]: Identify the number of distinct voices. Flag if a segment's Speaker ID does not match the established vocal identity (gender, tone, cadence) for that ID.
    4. [Timestamp Overlap]: Flag if two segments overlap/interfere by more than 0.7 seconds.
    5. [Timestamp Misalignment]: Flag if a segment starts "Too Early" (i.e., the timestamp begins significantly before the speaker actually starts talking).
    
    JSON Snippet: ${jsonSkeleton.slice(0, 5000)}
    OUTPUT JSON: { "errors": [{"tag": string, "time": string, "description": string}], "audioSpeakerCount": number, "segmentCount": number }
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

  let jsonSpeakerCount = 0;
  try {
    const data = JSON.parse(jsonSkeleton);
    const speakers = new Set(data.map((s: any) => s.speaker || s.speaker_id));
    jsonSpeakerCount = speakers.size;
  } catch (e) {}

  return {
    isValid: verifiedErrors.length === 0,
    errors: verifiedErrors,
    warnings: [],
    stats: {
      audioSpeakerCount: acousticResult.audioSpeakerCount || 0,
      jsonSpeakerCount: jsonSpeakerCount,
      segmentCount: acousticResult.segmentCount || 0
    }
  };
};

/**
 * STEP 2: GENERATE DRAFT (Phonetic Acoustic Mirror)
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
    ROLE: Acoustic Mirror (Tunisian Derja). 
    TASK: Transcribe exactly what you hear. Do not correct grammar. Do not enforce Modern Standard Arabic rules.
    
    STRICT RULES:
    1. NO PUNCTUATION: Do not use periods, commas, question marks, or exclamation points.
    2. SPEAKER TURNS: Whenever the speaker changes or there is a significant pause/turn, start a NEW LINE.
    3. SPELLING NORMALIZATION:
       - Always use 'فما', NEVER use 'فمة'.
       - Always use 'باش', NEVER use 'سوف'.
       - Always use 'شكون', NEVER use 'من هو'.
    4. NO HALLUCINATION: If you hear French or English words, write them verbatim.
    5. VERBATIM: If the speaker stutters or uses "incorrect" dialect forms, keep them exactly as they are.
    
    FORMAT: Plain text with line breaks for speaker changes.
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
      const cleanChunk = chunkText.replace(/[،.؟!"';:]/g, '');
      fullTranscript += cleanChunk;
      if (onProgress) onProgress(fullTranscript);
    }
  }
  
  return fullTranscript.replace(/\[\d+:\d+\]/g, '').replace(/\d{2}:\d{2}/g, '').trim();
};

/**
 * STEP 3: FORCED LINEAR ALIGNMENT (Structural Integrity + Line-Break Anchoring)
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
    ROLE: Linear Forced Aligner (Structural Integrity Specialist).
    
    REFERENCE TEXT:
    "${referenceText}"

    JSON CONTAINER (MUST PRESERVE EXACT STRUCTURE):
    ${jsonSkeleton}

    TASK:
    1. Map the REFERENCE TEXT into the "transcription" fields of the JSON CONTAINER.
    2. **STRUCTURAL LOCKDOWN**: DO NOT modify the JSON structure. Do not add brackets, do not remove keys, do not change order. Return ONLY the valid JSON object.
    3. **LINE-BREAK ANCHORING**: Treat every NEW LINE in the Reference Text as a hard signal for a new speaker segment. Use this to prevent words from one speaker "bleeding" into the segment of the next speaker.
    4. **LINEAR CONSUMPTION**: Treat words as a one-way queue. Once a word is assigned, it is consumed and cannot be repeated in the next segment.
    5. **NO PUNCTUATION**: Ensure all transcription fields in the JSON remain raw and without punctuation.
    6. **VERBATIM TUNISIAN**: Keep all Tunisian dialect words (e.g. فما) exactly as provided in the Reference Text.

    OUTPUT: Return ONLY the valid JSON.
  `;

  const response = await aiClient.models.generateContent({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: normalizeMimeType(mimeType), data: base64Audio } },
        { text: prompt }
      ]
    },
    config: { responseMimeType: "application/json", temperature: 0.0 }
  });

  return response.text || jsonSkeleton;
};
