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

export interface ValidationError {
  tag: string;       // English Tag Name
  time: string;      // Timestamp or Segment ID
  description: string; // Brief reason in Arabic/English
}

export interface ValidationReport {
  isValid: boolean;
  errors: ValidationError[]; // Now structured objects
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