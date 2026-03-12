export enum ProcessingStatus {
  IDLE = 'IDLE',                         
  AUDITING = 'AUDITING',   
  READY_TO_FIX = 'READY_TO_FIX', 
  TRANSCRIBING = 'TRANSCRIBING',         
  TEXT_READY = 'TEXT_READY',             
  ALIGNING = 'ALIGNING',                 
  REPAIRING_JSON = 'REPAIRING_JSON',
  VALIDATING = 'VALIDATING',
  COMPLETED = 'COMPLETED',
  COMPLETED_WITH_WARNINGS = 'COMPLETED_WITH_WARNINGS',
  RECONSTRUCTING_JSON = 'RECONSTRUCTING_JSON',
  ERROR = 'ERROR',
}

export interface ValidationError {
  tag: 'SPEAKER' | 'TIMING' | 'CONTENT' | 'STRUCTURE' | 'PUNCTUATION' | 'CUSTOM';
  time: string;      
  description: string; 
  severity: 'CRITICAL' | 'WARNING';
}

export interface ValidationReport {
  isValid: boolean;
  errors: ValidationError[];
  requiresManualReview?: boolean;
  stats: {
    detectedSpeakers: number;
    jsonSpeakers: number;
    confidenceScore: number;
  }
}

export interface PostRepairValidation {
  isClean: boolean;
  issues: string[];
}

export interface TranscriptionItem {
  id: string;
  file: File | Blob;
  audioBase64?: string;
  fileName: string;
  mimeType: string;
  previewUrl: string;
  status: ProcessingStatus;
  inputJson: string; 
  validationReport?: ValidationReport;
  postRepairValidation?: PostRepairValidation;
  finalTranscription?: string; 
  jsonOutput?: string;
  error?: string;
  addedAt: number;
  model: string;
  rowNumber?: number;
}