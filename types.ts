export enum ProcessingStatus {
  IDLE = 'IDLE',                         // File selected, waiting for JSON input
  VALIDATING_JSON = 'VALIDATING_JSON',   // Step 1: AI Checking JSON vs Audio
  READY_TO_TRANSCRIBE = 'READY_TO_TRANSCRIBE', // Validation passed, ready to generate draft
  TRANSCRIBING = 'TRANSCRIBING',         // Step 2: Generating text
  TEXT_READY = 'TEXT_READY',             // Step 3: Text generated, User Editing
  ALIGNING = 'ALIGNING',                 // Step 4: Merging Edited Text into JSON
  COMPLETED = 'COMPLETED',               // All done
  ERROR = 'ERROR',
}

export interface ValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    audioSpeakerCount: number;
    jsonSpeakerCount: number;
    segmentCount: number;
  }
}

export interface TranscriptionItem {
  id: string;
  file: File | Blob;
  fileName: string;
  mimeType: string;
  previewUrl: string;
  status: ProcessingStatus;
  inputJson: string; // Mandatory for validation
  validationReport?: ValidationReport;
  finalTranscription?: string; // The text content (editable)
  jsonOutput?: string;
  error?: string;
  addedAt: number;
}

export interface ProcessingStats {
  total: number;
  completed: number;
  processing: number;
}