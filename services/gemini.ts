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
 * Verifies if acoustic claims are mathematically possible in the JSON structure.
 */
const auditValidationErrors = async (
  jsonSkeleton: string, 
  rawErrors: string[],
  modelId: string
): Promise<{ verifiedErrors: string[], auditorNotes: string[] }> => {
  if (rawErrors.length === 0) return { verifiedErrors: [], auditorNotes: [] };

  const prompt = `
    ROLE: JSON Structure & Timing Auditor.
    TASK: Verify if the following claims are mathematically/logically present in the JSON.
    
    JSON CODE:
    ${jsonSkeleton.slice(0, 8000)}

    CLAIMS TO VERIFY:
    ${rawErrors.join("\n")}

    VALIDATION CATEGORIES (Use these tags only if verified):
    - Timestamp Overlap / وجود أكثر من مقطع يشتركون في نفس النطاق الزمني: Check if end[n] > start[n+1].
    - Unrealistic Duration / المدة الزمنية للمقطع قصيرة جداً: Check if (end - start) < 0.2s for long text.
    - Broken JSON / خطأ في هيكل الكود: Check for syntax errors.

    If a claim like "Missing Segment" is made, and you see a large gap (e.g., > 2s) in the JSON timestamps, VERIFY it. 
    If you find no gap, DISMISS it as a hallucination.

    OUTPUT: JSON { "verifiedErrors": ["Exact Arabic Tag"], "dismissedHallucinations": ["Reason"] }
  `;

  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: prompt,
    config: { responseMimeType: "application/json", temperature: 0.1 }
  });

  try {
    const result = JSON.parse(response.text || "{}");
    return {
      verifiedErrors: result.verifiedErrors || [],
      auditorNotes: (result.dismissedHallucinations || []).map((e: string) => `Filtered Hallucination: ${e}`)
    };
  } catch {
    return { verifiedErrors: rawErrors, auditorNotes: ["Auditor logic failed."] };
  }
};

/**
 * STEP 1: VALIDATION (Dual-Agent)
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
    TASK: QA the JSON against the Audio using these specific Tunisian Arabic Rejection Tags:

    1. Timestamp Misalignment / النص المكتوب لا يتزامن بدقة مع الإطار الزمني للصوت (Starts too early/ends too late).
    2. Unrealistic Duration / المدة الزمنية للمقطع قصيرة جداً (Physically impossible timing for text length).
    3. Missing Segment / يوجد كلام واضح ومسموع في الملف الصوتي تم تجاهله (Speech exists but no JSON segment).
    4. Timestamp Overlap / وجود أكثر من مقطع يشتركون في نفس النطاق الزمني (Conflict between segments).
    5. Phantom Segment / يحتوي ملف JSON على مقطع لفترة لا تحتوي على كلام بشري (Silence/Noise/Music only).
    6. Speaker Misattribution / النص مكتوب بشكل صحيح، ولكن تم نسبه لـ Speaker ID خاطئ.
    7. Speaker Count Mismatch / خطأ في عدد المتحدثين (num_speakers vs actual voices).

    JSON Snippet: ${jsonSkeleton.slice(0, 5000)}
    
    OUTPUT: JSON { "errors": ["Selected Arabic Tag"], "audioSpeakerCount": number }
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
 * STEP 2: GENERATE DRAFT (Verbatim Paragraph)
 */
export const generateDraftTranscription = async (
  base64Audio: string, 
  mimeType: string,
  guidelines: string,
  modelId: string,
  onProgress?: (text: string) => void
): Promise<string> => {
  const ai = getAiClient();
  const prompt = `
    ROLE: Professional Tunisian Arabic Transcriber.
    THE GOLDEN RULE: "Write exactly what you hear, not what you think should be said."
    
    STRICT RULES:
    1. FORMAT: One single paragraph.
    2. NO TIMESTAMPS: Do not include [00:00] or any time codes.
    3. NO ELONGATION: Write "يا ليل" not "يا لييييل".
    4. NO SPACE AFTER 'و': Write "والله" not "و الله".
    5. TAGS: [music], [laughter], [unintelligible], [english], [other_dialect].
    6. VERBATIM: Include repetitions (e.g., "أنا أنا").
    7. DIACRITICS: Only use "تنوين الفتح" (ً) for words like شكرًا. No other vowel marks.

    TRANSCRIPTION GUIDELINES: ${guidelines}
  `;

  const responseStream = await ai.models.generateContentStream({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType: normalizeMimeType(mimeType), data: base64Audio } },
        { text: prompt }
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
  // Safety strip any hallucinated timestamps
  return fullTranscript.replace(/\[\d+:\d+\]/g, '').replace(/\d{2}:\d{2}/g, '').trim();
};

/**
 * STEP 3: ALIGN (Correction -> JSON)
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
    TASK: Map the "Reference Text" into the provided "JSON Skeleton".
    
    REFERENCE TEXT: ${referenceText}
    
    JSON SKELETON:
    ${jsonSkeleton}

    INSTRUCTIONS:
    1. Fill the "transcription" field for each segment.
    2. KEEP ALL OTHER FIELDS (start, end, speaker, duration) EXACTLY AS THEY ARE.
    3. RETURN THE COMPLETE JSON STRUCTURE. DO NOT TRUNCATE.
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

  return response.text || "";
};