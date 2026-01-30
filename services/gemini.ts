import { GoogleGenAI, Type } from "@google/genai";
import { ValidationReport } from "../types";

// --- API Key & Client Logic ---
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
 * AGENT 2: Structural Auditor (Text-Only)
 * Cross-checks acoustic claims against the actual JSON code.
 * Extremely token-efficient.
 */
const auditValidationErrors = async (
  jsonSkeleton: string, 
  rawErrors: string[],
  modelId: string
): Promise<{ verifiedErrors: string[], auditorNotes: string[] }> => {
  if (rawErrors.length === 0) return { verifiedErrors: [], auditorNotes: [] };

  const prompt = `
    TASK: Verify if the claimed "Acoustic Errors" are mathematically possible in the "JSON Code".
    JSON CODE: ${jsonSkeleton}
    CLAIMED ERRORS: ${rawErrors.join(", ")}

    RULES:
    1. If an error says "Missing segment at 10s" but the JSON has a segment covering 10s, it is a HALLUCINATION. Dismiss it.
    2. If an error says "Overlap at 05:00" but the timestamps are sequential, it is a HALLUCINATION. Dismiss it.
    3. Return only errors that are mathematically confirmed by the JSON data.

    OUTPUT FORMAT: JSON { "verifiedErrors": [], "dismissedErrors": [] }
  `;

  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: { responseMimeType: "application/json", temperature: 0.1 }
  });

  try {
    const result = JSON.parse(response.text || "{}");
    return {
      verifiedErrors: result.verifiedErrors || [],
      auditorNotes: (result.dismissedErrors || []).map((e: string) => `Dismissed AI Hallucination: ${e}`)
    };
  } catch {
    return { verifiedErrors: rawErrors, auditorNotes: ["Auditor agent failed to parse."] };
  }
};

/**
 * STEP 1: DUAL-AGENT VALIDATION
 */
export const validateJsonWithAudio = async (
  base64Audio: string,
  mimeType: string,
  jsonSkeleton: string,
  modelId: string
): Promise<ValidationReport> => {
  const safeMimeType = normalizeMimeType(mimeType);
  const ai = getAiClient();

  // PASS 1: Acoustic Check (Multimodal)
  const acousticPrompt = `
    Check if this Tunisian Arabic audio matches the provided JSON segments.
    Return JSON: { "errors": ["Short description of misalignment or missing speech"], "audioSpeakerCount": number }
  `;

  const acousticResponse = await ai.models.generateContent({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: safeMimeType, data: base64Audio } },
        { text: `JSON Snippet: ${jsonSkeleton.slice(0, 5000)}\n\n${acousticPrompt}` }
      ]
    },
    config: { responseMimeType: "application/json", temperature: 0.0 }
  });

  const acousticResult = JSON.parse(acousticResponse.text || '{"errors":[]}');
  
  // PASS 2: Structural Audit (Text-Only - Logic check)
  const { verifiedErrors, auditorNotes } = await auditValidationErrors(jsonSkeleton, acousticResult.errors || [], modelId);

  return {
    isValid: verifiedErrors.length === 0,
    errors: verifiedErrors,
    warnings: auditorNotes,
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
  const responseStream = await ai.models.generateContentStream({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: normalizeMimeType(mimeType), data: base64Audio } },
        { text: `Transcribe this verbatim in Tunisian Arabic paragraph. Rules: ${guidelines}` }
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
  return fullTranscript;
};

/**
 * STEP 3: ALIGN
 */
export const alignJsonToAudioAndText = async (
  base64Audio: string, 
  mimeType: string, 
  referenceText: string,
  jsonSkeleton: string,
  modelId: string
): Promise<string> => {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: normalizeMimeType(mimeType), data: base64Audio } },
        { text: `Align this text to these segments. Return the full updated JSON.\nTEXT: ${referenceText}\nJSON: ${jsonSkeleton}` }
      ]
    },
    config: { responseMimeType: "application/json" }
  });
  return response.text || jsonSkeleton;
};