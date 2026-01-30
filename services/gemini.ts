import { GoogleGenAI, Type } from "@google/genai";
import { ValidationReport } from "../types";

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
 * Verifies if claims from Agent 1 are mathematically possible in the JSON.
 * Highly optimized for token efficiency.
 */
const auditValidationErrors = async (
  jsonSkeleton: string, 
  rawErrors: string[],
  modelId: string
): Promise<{ verifiedErrors: string[] }> => {
  if (rawErrors.length === 0) return { verifiedErrors: [] };

  const prompt = `
    Verify if these "Acoustic Claims" are mathematically possible in this "JSON Code".
    JSON: ${jsonSkeleton.slice(0, 10000)}
    CLAIMS: ${rawErrors.join(", ")}
    RULES: 
    - If overlap is claimed, check end[n] > start[n+1].
    - If duration is unrealistic (<0.2s), verify start/end delta.
    - If missing segment is claimed, look for timestamp gaps > 1.5s.
    OUTPUT JSON: { "verifiedErrors": ["Original Tag"] } (ONLY confirmed ones).
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
 * STEP 1: VALIDATION (Dual-Agent with Standard Rejection Tags)
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
    QA this JSON against the Audio. Use ONLY these exact Arabic tags for errors:
    - Broken JSON / خطأ في هيكل الكود
    - Timestamp Misalignment / النص المكتوب لا يتزامن بدقة مع الإطار الزمني للصوت
    - Unrealistic Duration / المدة الزمنية للمقطع قصيرة جداً
    - Missing Segment / يوجد كلام واضح ومسموع في الملف الصوتي تم تجاهله
    - Timestamp Overlap / وجود أكثر من مقطع يشتركون في نفس النطاق الزمني
    - Phantom Segment / يحتوي ملف JSON على مقطع لفترة لا تحتوي على كلام بشري
    - Speaker Misattribution / النص مكتوب بشكل صحيح، ولكن تم نسبه لـ Speaker ID خاطئ
    - Speaker Count Mismatch / خطأ في عدد المتحدثين
    
    JSON Snippet: ${jsonSkeleton.slice(0, 5000)}
    OUTPUT JSON: { "errors": ["Arabic Tag"], "audioSpeakerCount": number }
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
    warnings: [], // Removed auditor notes to save tokens
    stats: {
      audioSpeakerCount: acousticResult.audioSpeakerCount || 0,
      jsonSpeakerCount: 0,
      segmentCount: 0
    }
  };
};

/**
 * STEP 2: GENERATE DRAFT (Paragraph Verbatim)
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
    FORMAT: One single paragraph only. 
    STRICT: NO TIMESTAMPS [00:00]. NO TIME CODES. 
    RULES:
    - Verbatim repetition (e.g., "أنا أنا").
    - No elongation (Write "حبيبي" not "حبيبييي").
    - No space after 'و' (Write "والله" not "و الله").
    - Use tags: [music], [laughter], [unintelligible], [english], [other_dialect].
    - Dialects: If not Tunisian, use [other_dialect].
    - MSA (Fusha): Write as is with correct spelling (Hamzas, Taa Marbouta).
    - Diacritics: Only Tanween (ً) is allowed (e.g. طبعاً). No other vowel marks.
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
  // Post-process to ensure no timestamps hallucinated
  return fullTranscript.replace(/\[\d+:\d+\]/g, '').replace(/\d{2}:\d{2}/g, '').trim();
};

/**
 * STEP 3: ALIGN CORRECTED TEXT -> JSON
 */
export const alignJsonToAudioAndText = async (
  base64Audio: string, 
  mimeType: string, 
  referenceText: string,
  jsonSkeleton: string,
  modelId: string
): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    ROLE: Forced Aligner.
    TASK: Distribute the "Reference Text" into the provided "JSON Skeleton".
    
    REFERENCE TEXT (Correct Source):
    ${referenceText}

    JSON SKELETON:
    ${jsonSkeleton}

    INSTRUCTIONS:
    1. Distribute the text into the "transcription" fields based on the audio timing.
    2. KEEP ALL OTHER KEYS (start, end, speaker, duration, num_speakers) EXACTLY AS THEY ARE.
    3. IMPORTANT: DO NOT TRUNCATE. RETURN THE FULL JSON OBJECT.
  `;

  const response = await ai.models.generateContent({
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