export enum ProcessingStatus {
  IDLE = 'IDLE',
  QUEUED = 'QUEUED',                     // Waiting in line for processing
  TRANSCRIBING_TEXT = 'TRANSCRIBING_TEXT', // Step 1: Generating paragraph
  TEXT_READY = 'TEXT_READY',             // Step 2: User edits text here
  ALIGNING_JSON = 'ALIGNING_JSON',       // Step 3: Generating JSON using edited text
  COMPLETED = 'COMPLETED',               // Step 4: All done
  ERROR = 'ERROR',
}

export interface TranscriptionItem {
  id: string;
  file: File | Blob;
  fileName: string;
  mimeType: string;
  previewUrl: string;
  status: ProcessingStatus;
  inputJson?: string;
  finalTranscription?: string;
  jsonOutput?: string;
  error?: string;
  addedAt: number;
}

export interface ProcessingStats {
  total: number;
  completed: number;
  processing: number;
}