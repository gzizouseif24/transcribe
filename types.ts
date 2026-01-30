export enum ProcessingStatus {
  IDLE = 'IDLE',                         
  VALIDATING_JSON = 'VALIDATING_JSON',   
  READY_TO_TRANSCRIBE = 'READY_TO_TRANSCRIBE', 
  TRANSCRIBING = 'TRANSCRIBING',         
  TEXT_READY = 'TEXT_READY',             
  ALIGNING = 'ALIGNING',                 
  COMPLETED = 'COMPLETED',               
  ERROR = 'ERROR',
}

export interface ValidationReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  auditorNotes?: string[]; // Hallucinations caught by the second agent
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
  inputJson: string; 
  validationReport?: ValidationReport;
  finalTranscription?: string; 
  jsonOutput?: string;
  error?: string;
  addedAt: number;
  model: string;
}

export interface ProcessingStats {
  total: number;
  completed: number;
  processing: number;
}