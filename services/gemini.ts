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
 * Extract segments array from JSON that could be:
 * - A bare array: [{ start, end, speaker, text }, ...]
 * - A wrapped object: { transcription_segments: [...], ... }
 */
const extractSegments = (data: any): any[] | null => {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const candidates = [
      'transcription_segments', 'segments', 'transcription', 'data', 'results', 'items'
    ];
    for (const key of candidates) {
      if (Array.isArray(data[key])) return data[key];
    }
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key]) && data[key].length > 0 && data[key][0].start !== undefined) {
        return data[key];
      }
    }
  }
  return null;
};

const getSegText = (seg: any): string => seg.text || seg.transcription || '';
const getSegSpeaker = (seg: any): string => seg.speaker || seg.speaker_id || '';

const minifyJsonForAudit = (jsonStr: string): string => {
  try {
    const data = JSON.parse(jsonStr);
    const segments = extractSegments(data);
    if (!segments) return jsonStr;
    return JSON.stringify(segments.map((s: any) => ({
      id: s.id || s.segment_id,
      start: s.start,
      end: s.end,
      speaker: getSegSpeaker(s),
      text: getSegText(s).substring(0, 30)
    })));
  } catch (e) {
    return jsonStr;
  }
};

/**
 * Pre-check: detect timestamp overlaps purely from JSON (no AI needed)
 */
const detectTimestampOverlaps = (jsonStr: string): ValidationError[] => {
  const errors: ValidationError[] = [];
  try {
    const data = JSON.parse(jsonStr);
    const segments = extractSegments(data);
    if (!segments) return errors;

    const parseTime = (t: string | number): number => {
      if (typeof t === 'number') return t;
      const str = String(t);
      if (str.includes(':')) {
        const parts = str.split(':');
        if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
        return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
      }
      return parseFloat(str);
    };

    const formatTime = (seconds: number): string => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    for (let i = 0; i < segments.length - 1; i++) {
      const curr = segments[i];
      const next = segments[i + 1];
      const currEnd = parseTime(curr.end);
      const nextStart = parseTime(next.start);

      if (currEnd > nextStart + 0.05) {
        errors.push({
          tag: 'TIMING',
          time: formatTime(nextStart),
          description: `Time overlap: Segment ${curr.id || i} ends at ${curr.end} but segment ${next.id || i + 1} starts at ${next.start} (${(currEnd - nextStart).toFixed(2)}s overlap)`,
          severity: 'WARNING'
        });
      }
    }
  } catch (e) {}
  return errors;
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
  const minifiedJson = minifyJsonForAudit(jsonSkeleton);
  const timestampOverlaps = detectTimestampOverlaps(jsonSkeleton);

  const auditPrompt = `
ROLE: Precision Audio Structure Auditor for Tunisian Arabic speech.

CRITICAL RULES — READ CAREFULLY:
- You are auditing the STRUCTURE of the JSON against the audio. 
- DO NOT evaluate transcription text quality, spelling, grammar, or word choice.
- DO NOT flag "wrong words" or "missing words" — that is NOT your job.
- Focus ONLY on: WHO is speaking, WHEN they speak, and WHETHER segments map correctly to actual speech.

TASK: Perform these checks IN ORDER:

━━━ PHASE 1: VOICE PROFILING ━━━
Listen to the ENTIRE audio from start to finish. Identify each unique voice:
- Voice A: describe (gender, approximate age, tone, any accent features)
- Voice B: describe
- (etc.)
Count the total number of distinct speakers you hear.

━━━ PHASE 2: SPEAKER LABEL VERIFICATION ━━━
For each segment in the JSON, verify:
1. Does the speaker label consistently map to the same voice throughout?
   - If segment 5 says "speaker_1" but the voice is clearly Voice B (who was "speaker_2" everywhere else) → SPEAKER error
2. Does a single segment contain TWO different voices?
   - This is "INCLUDED_OVERLAP": one segment has speech from two people because the second person started talking before the segment ended, but the JSON didn't split it.
   - Flag as: tag "SPEAKER", severity "CRITICAL", and in description write: "Included overlap — two distinct voices detected in this single segment. The segment is assigned to [speaker_X] but a second voice ([describe]) begins speaking at approximately [MM:SS]."

━━━ PHASE 3: PHANTOM SEGMENT CHECK ━━━
Check if any segment in the JSON corresponds to:
- Pure silence (no speech at all in that time range)
- Only background noise, music, or non-speech sounds
- Only laughter with zero speech content
Flag these as: tag "STRUCTURE", description "Phantom segment — no speech detected in this time range."

━━━ WHAT TO IGNORE ━━━
- Do NOT flag segments where the text seems wrong but the speaker/timing is correct
- Do NOT flag filler words, stuttering, or repetitions
- Do NOT suggest text corrections
- Minor timing imprecisions (< 0.5s) are acceptable and should NOT be flagged

JSON TO AUDIT:
${minifiedJson}

OUTPUT FORMAT (strict JSON, no markdown):
{
  "voiceProfiles": [
    { "label": "Voice A", "description": "Adult male, deep voice", "mappedSpeakerId": "speaker_1" },
    { "label": "Voice B", "description": "Young female, higher pitch", "mappedSpeakerId": "speaker_2" }
  ],
  "detectedSpeakers": <number of distinct voices heard>,
  "requiresManualReview": <true if more than 5 errors or complex multi-speaker overlaps>,
  "errors": [
    {
      "tag": "SPEAKER" | "STRUCTURE",
      "time": "MM:SS",
      "description": "<specific, factual description of what you heard vs what the JSON says>",
      "severity": "CRITICAL" | "WARNING"
    }
  ],
  "confidenceScore": <0-100, your confidence in the audit accuracy>
}

IMPORTANT: Only report errors you are CERTAIN about. If you are unsure, do NOT include it. 
False positives waste human review time. Be conservative.
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
      temperature: 0.1
    }
  });

  const text = response.text || '{"errors":[]}';
  const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const result = JSON.parse(cleanText);

  const allErrors: ValidationError[] = [
    ...timestampOverlaps,
    ...(result.errors || [])
  ];

  let jsonSpeakers = 0;
  try {
    const data = JSON.parse(jsonSkeleton);
    const segments = extractSegments(data);
    jsonSpeakers = segments ? new Set(segments.map((s: any) => getSegSpeaker(s))).size : 0;
  } catch (e) {}

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    requiresManualReview: result.requiresManualReview || allErrors.length > 5,
    stats: {
      detectedSpeakers: result.detectedSpeakers || 0,
      jsonSpeakers: jsonSpeakers,
      confidenceScore: result.confidenceScore || 0
    }
  };
};

/**
 * STEP 2: VERBATIM TRANSCRIBER
 * Plain text output, no labels. Anti-hallucination measures.
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
    STRICT RULES: 
    - Transcribe ONLY what you hear. If unsure about a word, write [unclear] instead of guessing.
    - Use Tunisian Derja: 'فما', 'باش', 'شكون', 'برشا' (not 'برشة').
    - NO PUNCTUATION at all.
    - Start a NEW LINE for every speaker change.
    - French speech → write [french]. English speech → write [english].
    - Numbers must be spelled out in Derja (واحد, زوز, ثلاثة).
    - IGNORE background noise, music, coughing, breathing.
    - Do NOT add words that weren't spoken. Do NOT complete sentences. Do NOT invent content for silent sections.
    - Verbatim only.
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
      temperature: 0.0,
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
  const hasScript = correctedScript && correctedScript.trim().length > 0;

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
    - Maintain the EXACT original JSON structure, indentation, and formatting (pretty print).
    - DO NOT wrap the output in any extra [ ] brackets. If the CURRENT JSON does not start and end with [ ], DO NOT add them.
    - Return ONLY the raw corrected JSON text. DO NOT include markdown formatting like \`\`\`json.
  `;
  
  const parts: any[] = [{ text: prompt }];

  const response = await ai.models.generateContent({
    model: modelId,
    contents: { parts },
    config: { 
      temperature: 0.0,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });
  
  let finalJson = response.text || currentJson;
  finalJson = finalJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return finalJson;
};


/**
 * STEP 4: VALIDATION AGENT
 * Independent check of repaired JSON before acceptance.
 */
export const validateRepairedJson = async (
  base64Audio: string,
  mimeType: string,
  originalJson: string,
  repairedJson: string,
  modelId: string
): Promise<{ 
  isClean: boolean; 
  issues: string[];
}> => {
  const ai = getAiClient();
  const safeMimeType = normalizeMimeType(mimeType);
  const issues: string[] = [];
  
  try {
    const repaired = JSON.parse(repairedJson);
    const segments = extractSegments(repaired);
    
    if (!segments) {
      issues.push("Could not find segments array in JSON");
      return { isClean: false, issues };
    }

    // Check: no empty text fields
    segments.forEach((seg: any, i: number) => {
      const text = getSegText(seg);
      if (!text || text.trim() === '') {
        issues.push(`Segment ${seg.id || i} has empty text`);
      }
    });

    // Check: no punctuation in text
    const punctuationRegex = /[،.؟!?"';:,\.]/;
    segments.forEach((seg: any, i: number) => {
      const text = getSegText(seg);
      if (text && punctuationRegex.test(text)) {
        issues.push(`Segment ${seg.id || i} still contains punctuation`);
      }
    });

    // Check: no digit numbers in text
    segments.forEach((seg: any, i: number) => {
      const text = getSegText(seg);
      if (text && /\d+/.test(text)) {
        issues.push(`Segment ${seg.id || i} contains numeric digits in text — should be spelled out`);
      }
    });

    // Check: timestamps are sequential
    const parseTime = (t: string | number): number => {
      if (typeof t === 'number') return t;
      const str = String(t);
      if (str.includes(':')) {
        const parts = str.split(':');
        if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
        return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
      }
      return parseFloat(str);
    };

    for (let i = 0; i < segments.length - 1; i++) {
      const currEnd = parseTime(segments[i].end);
      const nextStart = parseTime(segments[i + 1].start);
      if (currEnd > nextStart + 0.05) {
        issues.push(`Timing overlap persists: segment ${segments[i].id || i} ends after segment ${segments[i + 1].id || i + 1} starts`);
      }
    }

    // Check: start < end for each segment
    segments.forEach((seg: any, i: number) => {
      if (parseTime(seg.start) >= parseTime(seg.end)) {
        issues.push(`Segment ${seg.id || i} has start >= end (${seg.start} >= ${seg.end})`);
      }
    });

    // Check: "برشة" should be "برشا"
    segments.forEach((seg: any, i: number) => {
      const text = getSegText(seg);
      if (text && text.includes('برشة')) {
        issues.push(`Segment ${seg.id || i} contains "برشة" — should be "برشا"`);
      }
    });

  } catch (e) {
    issues.push(`Repaired JSON is not valid JSON: ${(e as Error).message}`);
    return { isClean: false, issues };
  }

  // AI spot-check only if deterministic checks passed
  if (issues.length === 0) {
    try {
      const spotCheckPrompt = `
ROLE: Quality Control Auditor. You are checking a REPAIRED JSON transcription against audio.

REPAIRED JSON:
${repairedJson}

TASK: Do a QUICK spot-check:
1. Pick 3 random segments spread across the audio. For each, verify the speaker label matches the voice you hear at that timestamp.
2. Check if any segment text contains French words written in Arabic letters (should be [french] tag instead).
3. Check if the segment count seems reasonable for the audio length.

RESPOND IN STRICT JSON:
{
  "spotCheckPassed": true/false,
  "issues": ["issue description"]
}

Be CONSERVATIVE — only flag clear, obvious problems.
      `;

      const response = await ai.models.generateContent({
        model: modelId,
        contents: {
          parts: [
            { inlineData: { mimeType: safeMimeType, data: base64Audio } },
            { text: spotCheckPrompt }
          ]
        },
        config: { 
          responseMimeType: "application/json",
          temperature: 0.05
        }
      });

      const spotResult = JSON.parse(
        (response.text || '{"spotCheckPassed":true,"issues":[]}')
          .replace(/```json/g, '').replace(/```/g, '').trim()
      );

      if (!spotResult.spotCheckPassed && spotResult.issues?.length > 0) {
        issues.push(...spotResult.issues);
      }
    } catch (e) {
      console.warn('Validation spot-check failed:', e);
    }
  }

  return {
    isClean: issues.length === 0,
    issues
  };
};


/**
 * STEP 5: TARGETED REFINEMENT
 * Specifically fixes issues found by the validation agent.
 */
export const refineJson = async (
  currentJson: string,
  issues: string[],
  modelId: string
): Promise<string> => {
  const ai = getAiClient();
  
  const prompt = `
    ROLE: JSON Data Cleaner.
    
    INPUT JSON:
    ${currentJson}
    
    ISSUES TO FIX:
    ${issues.map(iss => `- ${iss}`).join('\n')}
    
    TASK:
    Apply surgical fixes to the JSON to resolve the listed issues.
    - If punctuation is present, remove it.
    - If digits are present in text, spell them out in Tunisian Arabic.
    - If "برشة" is present, change to "برشا".
    - If timing overlaps exist, adjust the start/end times slightly to remove the overlap.
    - Ensure the JSON structure remains identical.
    - Return ONLY the raw corrected JSON.
  `;

  const response = await ai.models.generateContent({
    model: modelId,
    contents: [{ parts: [{ text: prompt }] }],
    config: { 
      temperature: 0.0,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  let finalJson = response.text || currentJson;
  finalJson = finalJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return finalJson;
};
