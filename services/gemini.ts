
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";
import { ValidationReport, ValidationError } from "../types";

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
 * STEP 1: COMPREHENSIVE ACOUSTIC AUDIT
 */
export const runAcousticAudit = async (
  base64Audio: string,
  mimeType: string,
  jsonSkeleton: string,
  modelId: string
): Promise<ValidationReport> => {
  const safeMimeType = normalizeMimeType(mimeType);
  const ai = getAiClient();

  const auditPrompt = `
    ROLE: High-Precision Audio Auditor (Tunisian Arabic Context).
    TASK: Audit the provided JSON against the Audio. IGNORE all transcription content, spelling, and punctuation. Focus STRICTLY on structural and acoustic errors.
    CHECKLIST: 
    1. SPEAKER: Pay extremely close attention to speaker misattributions. Track voice characteristics and turn-taking carefully. Flag any segment where the speaker ID does not match the voice. Flag speaker count mismatches (e.g. audio has 3 people, JSON has 2).
    2. TIMING: Check for overlaps or speech starting/ending outside segment bounds.
    3. STRUCTURE: Flag phantom segments (segments that contain ONLY silence, background noise, or music with no human speech).
    
    JSON TO AUDIT: ${jsonSkeleton.slice(0, 8000)}
    
    OUTPUT JSON FORMAT:
    {
      "detectedSpeakers": number,
      "requiresManualReview": boolean,
      "errors": [
        {
          "tag": "SPEAKER" | "TIMING" | "STRUCTURE",
          "time": "MM:SS",
          "description": "Short explanation in English",
          "severity": "CRITICAL" | "WARNING"
        }
      ],
      "confidenceScore": number
    }
  `;

  const response = await ai.models.generateContent({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: safeMimeType, data: base64Audio } },
        { text: auditPrompt }
      ]
    },
    config: { 
      responseMimeType: "application/json", 
      temperature: 0.1,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  const text = response.text || '{"errors":[]}';
  const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const result = JSON.parse(cleanText);
  let jsonSpeakers = 0;
  try {
    const data = JSON.parse(jsonSkeleton);
    jsonSpeakers = Array.isArray(data) ? new Set(data.map((s: any) => s.speaker || s.speaker_id)).size : 0;
  } catch (e) {}

  return {
    isValid: (result.errors || []).length === 0,
    errors: result.errors || [],
    requiresManualReview: result.requiresManualReview || false,
    stats: {
      detectedSpeakers: result.detectedSpeakers || 0,
      jsonSpeakers: jsonSpeakers,
      confidenceScore: result.confidenceScore || 0
    }
  };
};

/**
 * STEP 2: VERBATIM TRANSCRIBER
 */
export const generateVerbatimScript = async (
  base64Audio: string, 
  mimeType: string,
  modelId: string,
  onProgress?: (text: string) => void
): Promise<string> => {
  const ai = getAiClient();
  const systemPrompt = `
    ROLE: Expert Tunisian Derja Transcriber. 
    STRICT RULES: Use 'فما', 'باش', 'شكون'. NO PUNCTUATION. 
    Start a NEW LINE for every speaker change. Verbatim only.
  `;

  const responseStream = await ai.models.generateContentStream({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: normalizeMimeType(mimeType), data: base64Audio } },
        { text: systemPrompt }
      ]
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  let fullTranscript = "";
  for await (const chunk of responseStream) {
    if (chunk.text) {
      const clean = chunk.text.replace(/[،.؟!"';:]/g, '');
      fullTranscript += clean;
      if (onProgress) onProgress(fullTranscript);
    }
  }
  return fullTranscript.trim();
};

/**
 * STEP 3: UNIFIED FIXER
 * Applies fixes only to specific errors provided, using audio and corrected script.
 */
export const applyUnifiedFixes = async (
  base64Audio: string, 
  mimeType: string, 
  currentJson: string, 
  errorsToFix: ValidationError[], 
  correctedScript: string | undefined,
  modelId: string
) => {
  const ai = getAiClient();
  const hasStructuralErrors = errorsToFix.length > 0;

  const prompt = `
    ROLE: Tunisian JSON Refinement Specialist.
    
    CONTEXT:
    1. CURRENT JSON: ${currentJson}
    ${hasStructuralErrors ? `2. ERRORS TO TARGET: ${JSON.stringify(errorsToFix)}` : ''}
    3. MASTER SCRIPT (Use this for content corrections): "${correctedScript || 'N/A'}"
    
    TASK:
    1. TEXT REPLACEMENT: You MUST update the transcription text in the CURRENT JSON to perfectly match the wording in the MASTER SCRIPT. Align the sentences from the MASTER SCRIPT to the correct segments based on the sequence of speakers and the original text.
    ${hasStructuralErrors ? `2. STRUCTURAL FIXES: Resolve the specific issues listed in "ERRORS TO TARGET" (e.g., fix timings, correct speaker IDs, delete phantom segments).
    - If an error is 'SPEAKER' or 'TIMING', re-align based on logical deduction from the text and existing timestamps.
    - Delete phantom segments or segments that contain ONLY laughter or noise.` : ''}
    - If there is French speech, replace it entirely with the tag "[french]". NEVER transcribe French words using Latin or Arabic letters.
    - NEVER transcribe numbers as digits (e.g., 1, 2, 3). Always spell them out in Tunisian Arabic (Darija) (e.g., واحد, ثنين, تلاثة).
    - Enforce specific Tunisian Darija spellings: ALWAYS replace "برشة" with "برشا".
    - STRICT RULE: The final transcription text in the JSON MUST be COMPLETELY free of punctuation (no periods, commas, question marks, etc.).
    - Maintain the original JSON structure.
    - Return ONLY the valid corrected JSON.
  `;
  
  const parts: any[] = [{ text: prompt }];

  const response = await ai.models.generateContent({
    model: modelId,
    contents: { parts },
    config: { 
      responseMimeType: "application/json", 
      temperature: 0.0,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });
  
  return response.text || currentJson;
};
