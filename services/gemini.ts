
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
 * AGENT 2: Structural Auditor (Triangulation Auditor)
 */
const auditValidationErrors = async (
  jsonSkeleton: string, 
  rawErrors: ValidationError[],
  modelId: string
): Promise<{ verifiedErrors: ValidationError[] }> => {
  if (rawErrors.length === 0) return { verifiedErrors: [] };

  const prompt = `
    Verify if these "Acoustic Claims" are mathematically and structurally possible in this "JSON Code".
    
    CONTEXT:
    The user is performing a "Triangulation" check. The transcribed text in the JSON is a DRAFT and might be faulty.
    
    JSON: ${jsonSkeleton.slice(0, 10000)}
    CLAIMS: ${JSON.stringify(rawErrors)}
    
    VERIFICATION LOGIC: 
    1. Timestamp Overlap: Only verify if (end[n] - start[n+1]) is GREATER than 0.7 seconds.
    2. Speaker Misattribution: Confirm if the claim identifies a specific segment ID and if that segment exists.
    3. Missing Segment: Cross-reference the claim's time range with the JSON's timeline to see if it truly falls in a "gap" (>1.5s).
    
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
    QA this JSON against the Audio using TRIANGULATION.
    
    EVIDENCE SOURCES:
    1. AUDIO: Use the sound of the voice to create "speaker fingerprints."
    2. JSON MAP: Use the start/end/speaker_id metadata.
    3. INTENT (Text): The text is a FAULTY DRAFT. Some words may be placed in the wrong segment (boundary bleed).
    
    INSTRUCTIONS:
    - [Speaker Misattribution]: Compare the voice sound in a segment to the profile of its assigned Speaker ID. If Speaker 01 is established as a Male voice elsewhere, but a segment assigned to Speaker 01 has a Female voice, flag it. Do NOT guess based on the draft text; use the text only to understand who the transcriber INTENDED to map.
    - [Boundary Bleed]: DO NOT flag text that seems to overflow into the next segment. This is expected.
    - [Gaps]: Flag if there is clear speech in a gap between segments > 1.5s.
    
    STRUCTURAL ERROR TAGS:
    - [Speaker Count Mismatch]
    - [Speaker Misattribution]
    - [Phantom Segment]
    - [Missing Segment]
    - [Timestamp Overlap]
    
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
 * STRICTLY PRESERVES THE ORIGINAL JSON SCHEMA
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
    1. Distribute the SOURCE TEXT into the "transcription" fields of the JSON SKELETON.
    2. ABSOLUTE CONSTRAINT: The resulting JSON structure MUST be identical to the JSON SKELETON. Do NOT add, remove, or rename any keys (id, start, end, speaker, duration, etc).
    3. ONLY modify the content of the "transcription" property.
    4. Return the COMPLETE, valid JSON object.
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
