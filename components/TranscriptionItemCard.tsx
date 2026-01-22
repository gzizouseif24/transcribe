import React, { useState, useRef, useEffect } from 'react';
import { TranscriptionItem, ProcessingStatus } from '../types';

interface TranscriptionItemCardProps {
  item: TranscriptionItem;
  onRemove: (id: string) => void;
  onUpdate: (id: string, newText: string) => void;
  onStartText: (id: string) => void;
  onStartJson: (id: string, jsonInput: string) => void;
  onRedoJson: (id: string) => void;
}

interface ValidationStats {
  uniqueSpeakers: string[];
  totalSegments: number;
  totalJsonDuration: number;
  audioDuration: number;
  gapsDetected: number;
  headerSpeakerCount?: number;
  headerDuration?: number;
}

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  stats?: ValidationStats;
}

export const TranscriptionItemCard: React.FC<TranscriptionItemCardProps> = ({ item, onRemove, onUpdate, onStartText, onStartJson, onRedoJson }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeTab, setActiveTab] = useState<'text' | 'json'>('text');
  
  // Phase 2 State
  const [jsonInput, setJsonInput] = useState('');
  const [isJsonValidated, setIsJsonValidated] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // Audio State
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Copy Feedback State
  const [isCopied, setIsCopied] = useState(false);
  
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    // If completed, default to JSON view as that's the final output
    if (item.status === ProcessingStatus.COMPLETED) {
      setActiveTab('json');
    }
  }, [item.status]);

  // Restore JSON input from item prop if local state is empty (e.g. on redo or reload)
  useEffect(() => {
    if (item.inputJson && !jsonInput) {
      setJsonInput(item.inputJson);
    }
  }, [item.inputJson]);

  // Reset validation if user edits the JSON
  useEffect(() => {
    if (isJsonValidated) {
      setIsJsonValidated(false);
      setValidationResult(null);
    }
  }, [jsonInput]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const handleCopyJson = () => {
    if (item.jsonOutput) {
        navigator.clipboard.writeText(item.jsonOutput);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleRedoClick = () => {
    // Reset local validation state so user starts fresh
    setIsJsonValidated(false);
    setValidationResult(null);
    onRedoJson(item.id);
  };

  const validateJsonStructure = () => {
    const result: ValidationResult = { isValid: true, errors: [], warnings: [] };
    const speakers = new Set<string>();
    let gapCount = 0;
    
    try {
      // 1. Structural & Technical Errors (Critical)
      let parsed;
      try {
        parsed = JSON.parse(jsonInput);
      } catch (e) {
        throw new Error("Broken JSON: The JSON structure is invalid. Check for missing brackets {}, quotes \"\", or commas.");
      }

      let segments: any[] = [];
      let headerSpeakerCount: number | undefined = undefined;
      let headerDuration: number | undefined = undefined;

      // Handle different JSON structures (Array root vs Object root)
      if (Array.isArray(parsed)) {
        segments = parsed;
      } else {
        // Extract metadata if available at root
        if ('num_speakers' in parsed) headerSpeakerCount = parsed.num_speakers;
        if ('duration' in parsed) headerDuration = parsed.duration;

        if (parsed.transcription_segments && Array.isArray(parsed.transcription_segments)) {
          segments = parsed.transcription_segments;
        } else if (parsed.segments && Array.isArray(parsed.segments)) {
          segments = parsed.segments;
        } else {
          result.isValid = false;
          result.errors.push("Structural Error: Root must be an array or contain 'transcription_segments'.");
        }
      }

      if (result.isValid) {
        if (segments.length === 0) {
          result.isValid = false;
          result.errors.push("Structural Error: JSON array is empty.");
        }

        // Check Individual Segments
        let prevEnd = 0;
        let lastSegmentEnd = 0;
        
        segments.forEach((seg, index) => {
          const idx = index + 1; // 1-based index for readability
          
          // 2. Timing & Segmentation Errors
          
          // Check existence
          if (seg.start === undefined || seg.end === undefined) {
             result.isValid = false;
             result.errors.push(`Segment #${idx}: Missing timestamp fields (start/end).`);
             return; // Skip logic checks for this segment
          }
          
          const start = parseFloat(seg.start);
          const end = parseFloat(seg.end);

          if (isNaN(start) || isNaN(end)) {
            result.isValid = false;
            result.errors.push(`Segment #${idx}: Timestamps must be valid numbers.`);
            return;
          }

          // Chronology (Start < End)
          if (start >= end) {
             result.isValid = false;
             result.errors.push(`Segment #${idx} [Timestamp Misalignment]: Start time (${start}) cannot be greater than or equal to end time (${end}).`);
          }

          // Unrealistic Duration
          const dur = end - start;
          if (dur < 0.2 && dur > 0) {
             result.warnings.push(`Segment #${idx} [Unrealistic Duration]: Segment is very short (${dur.toFixed(3)}s). Verify if this is intentional.`);
          }

          // Overlaps
          if (start < prevEnd) {
             // Allow tiny overlap for floating point drift, but flag real overlaps
             if (prevEnd - start > 0.05) {
                result.isValid = false;
                const overlap = (prevEnd - start).toFixed(2);
                result.errors.push(`Segment #${idx} [Timestamp Misalignment]: Overlaps with Segment #${idx-1} by ${overlap}s. (Start: ${start}, Prev End: ${prevEnd})`);
             }
          }

          // Gap Detection (Missing Segment Check)
          // If there is a silence > 2 seconds between segments, it might be a missing speaker.
          if (start - prevEnd > 2.0) {
             gapCount++;
             result.warnings.push(`Gap Detected: ${(start - prevEnd).toFixed(2)}s silence between Segment #${idx-1} and #${idx}. Possible [Missing Segment]?`);
          }

          prevEnd = end;
          lastSegmentEnd = end;

          // 3. Speaker Labeling Errors
          if (!seg.speaker || typeof seg.speaker !== 'string' || seg.speaker.trim() === '') {
             result.isValid = false;
             result.errors.push(`Segment #${idx} [Speaker Misattribution]: 'speaker' field is missing or empty.`);
          } else {
             speakers.add(seg.speaker.trim());
          }
        });

        // 4. Header vs Content Consistency Check (CRITICAL)
        if (headerSpeakerCount !== undefined && speakers.size !== headerSpeakerCount) {
            result.isValid = false;
            result.errors.push(`Speaker Count Mismatch: Header declares ${headerSpeakerCount} speakers, but found ${speakers.size} unique speakers in segments.`);
        }

        // 5. File Duration Consistency Check
        const durationToCheck = headerDuration || duration; // Prefer JSON header duration if audio not loaded fully
        if (durationToCheck > 0 && lastSegmentEnd < durationToCheck - 5) {
             result.warnings.push(`Missing Segment: JSON ends at ${formatTime(lastSegmentEnd)}, but declared duration is ${formatTime(durationToCheck)}. Missing ${Math.floor(durationToCheck - lastSegmentEnd)}s at the end?`);
        }

        // Stats Population
        result.stats = {
            uniqueSpeakers: Array.from(speakers).sort(),
            totalSegments: segments.length,
            totalJsonDuration: lastSegmentEnd,
            audioDuration: duration,
            gapsDetected: gapCount,
            headerSpeakerCount,
            headerDuration
        };

        // If no errors, but speaker count is suspiciously low (1) for a conversation app (and no header override)
        if (headerSpeakerCount === undefined && speakers.size < 2 && result.isValid) {
            result.warnings.push("Speaker Check: Only 1 unique speaker found. If this is a conversation, verify [Speaker Misattribution].");
        }
      }

    } catch (e: any) {
      result.isValid = false;
      result.errors.push(e.message);
    }

    setValidationResult(result);
    if (result.isValid) {
      setIsJsonValidated(true);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return "00:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const statusColors = {
    [ProcessingStatus.IDLE]: 'bg-slate-100 text-slate-600',
    [ProcessingStatus.QUEUED]: 'bg-amber-100 text-amber-700',
    [ProcessingStatus.TRANSCRIBING_TEXT]: 'bg-blue-100 text-blue-600',
    [ProcessingStatus.TEXT_READY]: 'bg-indigo-100 text-indigo-700',
    [ProcessingStatus.ALIGNING_JSON]: 'bg-purple-100 text-purple-600',
    [ProcessingStatus.COMPLETED]: 'bg-emerald-100 text-emerald-600',
    [ProcessingStatus.ERROR]: 'bg-red-100 text-red-600',
  };

  const statusLabels = {
    [ProcessingStatus.IDLE]: 'Draft Ready',
    [ProcessingStatus.QUEUED]: 'Queued',
    [ProcessingStatus.TRANSCRIBING_TEXT]: 'Generating Text...',
    [ProcessingStatus.TEXT_READY]: 'Review Text',
    [ProcessingStatus.ALIGNING_JSON]: 'Aligning JSON...',
    [ProcessingStatus.COMPLETED]: 'Done',
    [ProcessingStatus.ERROR]: 'Error',
  };

  const isProcessing = item.status === ProcessingStatus.TRANSCRIBING_TEXT || item.status === ProcessingStatus.ALIGNING_JSON;
  const isQueued = item.status === ProcessingStatus.QUEUED;

  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:shadow-md ${isQueued ? 'opacity-80' : ''}`}>
      {/* Header */}
      <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
        <div className="flex items-center space-x-3 overflow-hidden">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
            <i className="fa-solid fa-file-audio"></i>
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-slate-800 truncate" title={item.fileName}>
              {item.fileName}
            </h3>
            <p className="text-xs text-slate-500">
              {new Date(item.addedAt).toLocaleTimeString()}
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
           <span className={`px-2.5 py-1 rounded-full text-xs font-medium border border-transparent ${statusColors[item.status]}`}>
            {isProcessing && <i className="fa-solid fa-circle-notch fa-spin mr-1.5"></i>}
            {isQueued && <i className="fa-solid fa-hourglass-half fa-spin-pulse mr-1.5"></i>}
            {statusLabels[item.status]}
          </span>
          <button 
            onClick={() => onRemove(item.id)}
            className="text-slate-400 hover:text-red-500 transition-colors p-1"
            title="Remove"
          >
            <i className="fa-solid fa-trash-can"></i>
          </button>
        </div>
      </div>

      {/* Audio Element */}
      <audio 
        ref={audioRef} 
        src={item.previewUrl} 
        onEnded={handleAudioEnded}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        className="hidden" 
      />

      <div className="p-4">
        {/* Advanced Audio Controls */}
        <div className="flex items-center space-x-3 mb-6 bg-slate-50 p-3 rounded-xl border border-slate-100">
          <button 
            onClick={togglePlay}
            className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'} text-sm`}></i>
          </button>
          
          <div className="flex-1 flex flex-col justify-center space-y-1.5">
             <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400 font-bold font-mono">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
             </div>
             <input 
               type="range"
               min="0"
               max={duration || 0}
               value={currentTime}
               onChange={handleSeek}
               className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
             />
          </div>

           <button 
            onClick={() => setPlaybackRate(prev => prev === 1 ? 1.5 : prev === 1.5 ? 2 : 0.5)} 
            className="flex-shrink-0 h-8 w-12 flex items-center justify-center rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            title="Toggle Speed"
          >
             {playbackRate === 0.5 ? '.5x' : `${playbackRate}x`}
          </button>
        </div>

        {/* Phase 1: Start Text Generation */}
        {item.status === ProcessingStatus.IDLE && (
           <div className="text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-300">
               <button 
                 onClick={() => onStartText(item.id)}
                 className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium transition-colors shadow-sm"
               >
                 <i className="fa-solid fa-wand-magic-sparkles mr-2"></i>
                 Generate Draft Text
               </button>
               <p className="text-xs text-slate-500 mt-2">Step 1: Get the words right first.</p>
           </div>
        )}

        {item.status === ProcessingStatus.QUEUED && (
            <div className="text-center py-6 bg-amber-50 rounded-lg border border-dashed border-amber-200">
               <p className="text-amber-700 font-medium animate-pulse">Waiting in batch queue...</p>
               <p className="text-xs text-amber-500 mt-1">Processing sequentially to prevent API overload.</p>
            </div>
        )}

        {/* Phase 2: Edit Text & Input JSON */}
        {(item.status === ProcessingStatus.TEXT_READY || item.status === ProcessingStatus.ALIGNING_JSON || item.status === ProcessingStatus.COMPLETED) && (
          <div className="space-y-6">
            
            {/* 1. Text Editor Area */}
            <div>
               <div className="flex items-center justify-between mb-2">
                 <label className="text-sm font-semibold text-slate-700">
                    <span className="bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded text-xs mr-2">Step 1 Complete</span>
                    Review & Edit Text
                 </label>
                 {item.status === ProcessingStatus.TEXT_READY && (
                   <span className="text-xs text-amber-600 animate-pulse">
                     <i className="fa-solid fa-pen mr-1"></i> Make edits before aligning
                   </span>
                 )}
               </div>
               <textarea
                  value={item.finalTranscription || ''}
                  onChange={(e) => onUpdate(item.id, e.target.value)}
                  disabled={item.status !== ProcessingStatus.TEXT_READY && item.status !== ProcessingStatus.COMPLETED}
                  className={`w-full bg-white border rounded-lg p-4 arabic-text text-lg leading-loose shadow-sm outline-none resize-y min-h-[120px] transition-colors
                    ${item.status === ProcessingStatus.TEXT_READY ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500' : 'border-slate-200 text-slate-600 bg-slate-50'}
                  `}
                  placeholder="Transcription..."
                />
            </div>

            {/* 2. JSON Alignment Area */}
            {item.status !== ProcessingStatus.COMPLETED && (
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                 <label className="block text-sm font-semibold text-slate-700 mb-2">
                    <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs mr-2">Step 2</span>
                    Paste JSON & Align
                 </label>
                 {item.status === ProcessingStatus.ALIGNING_JSON ? (
                    <div className="flex items-center justify-center h-24 text-purple-600">
                        <i className="fa-solid fa-circle-notch fa-spin text-2xl mr-3"></i>
                        <span>Aligning text to timestamps...</span>
                    </div>
                 ) : (
                    <div className="space-y-3">
                        <textarea
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            className={`w-full h-24 p-3 text-xs font-mono rounded border focus:ring-2 
                                ${validationResult?.isValid === false 
                                    ? 'border-red-300 focus:ring-red-200 focus:border-red-400 bg-red-50' 
                                    : 'border-slate-300 focus:ring-purple-500 focus:border-purple-500'
                                }
                            `}
                            placeholder='Paste JSON with timestamps: { "transcription_segments": [{"start": 0, "end": 10, "speaker": "S1"}] }'
                        />

                        {/* Validation Feedback */}
                        {validationResult && (
                            <div className={`p-3 rounded-lg text-xs border ${validationResult.isValid ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                                
                                {/* Header */}
                                {validationResult.isValid ? (
                                    <div className="flex items-center text-emerald-700 mb-2">
                                        <i className="fa-solid fa-circle-check mr-2"></i>
                                        <span className="font-bold">Structure Validated</span>
                                    </div>
                                ) : (
                                    <div className="text-red-700 mb-2">
                                        <div className="font-bold"><i className="fa-solid fa-circle-xmark mr-2"></i>Validation Failed:</div>
                                    </div>
                                )}

                                {/* Critical Errors */}
                                {validationResult.errors.length > 0 && (
                                    <ul className="list-disc list-inside space-y-1 ml-1 text-red-700 mb-3">
                                        {validationResult.errors.slice(0, 5).map((err, i) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                        {validationResult.errors.length > 5 && (
                                            <li>...and {validationResult.errors.length - 5} more errors.</li>
                                        )}
                                    </ul>
                                )}

                                {/* Stats & Sanity Check (Always shown if parseable) */}
                                {validationResult.stats && (
                                    <div className="bg-white/50 rounded p-2 mb-2 text-slate-700 space-y-1">
                                        <div className="font-semibold text-slate-800 text-[11px] uppercase tracking-wider mb-1">Sanity Check Report</div>
                                        
                                        <div className="flex justify-between items-center">
                                            <span>Speakers Detected:</span>
                                            <div className="flex items-center space-x-2">
                                                 <span className={`font-mono font-bold ${validationResult.stats.headerSpeakerCount !== undefined && validationResult.stats.headerSpeakerCount !== validationResult.stats.uniqueSpeakers.length ? 'text-red-600' : ''}`}>
                                                    {validationResult.stats.uniqueSpeakers.length}
                                                 </span>
                                                 {validationResult.stats.headerSpeakerCount !== undefined && (
                                                     <span className="text-[10px] text-slate-400">
                                                        (Header claims: {validationResult.stats.headerSpeakerCount})
                                                     </span>
                                                 )}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-1 mt-1 pl-2 border-l-2 border-slate-300 mb-2">
                                            {validationResult.stats.uniqueSpeakers.map(s => (
                                                <span key={s} className="bg-slate-200 text-slate-600 px-1.5 rounded text-[10px]">{s}</span>
                                            ))}
                                        </div>

                                        <div className="flex justify-between">
                                            <span>JSON End Time:</span>
                                            <span className="font-mono">{formatTime(validationResult.stats.totalJsonDuration)}</span>
                                        </div>
                                        {validationResult.stats.headerDuration !== undefined && (
                                            <div className="flex justify-between">
                                                <span>Header Duration:</span>
                                                <span className="font-mono">{formatTime(validationResult.stats.headerDuration)}</span>
                                            </div>
                                        )}
                                        {validationResult.stats.audioDuration > 0 && (
                                            <div className="flex justify-between">
                                                <span>Audio File:</span>
                                                <span className="font-mono">{formatTime(validationResult.stats.audioDuration)}</span>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Warnings */}
                                {validationResult.warnings.length > 0 && (
                                    <div className="mt-2 text-amber-700 border-t border-amber-200 pt-2">
                                        <div className="font-bold flex items-center"><i className="fa-solid fa-triangle-exclamation mr-1.5"></i> Warnings (Check these):</div>
                                        <ul className="list-disc list-inside mt-1">
                                            {validationResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Buttons Logic */}
                        {!isJsonValidated ? (
                             <button
                                onClick={validateJsonStructure}
                                disabled={!jsonInput.trim()}
                                className="w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <i className="fa-solid fa-magnifying-glass-chart mr-2"></i>
                                Validate Structure
                            </button>
                        ) : (
                            <button
                                onClick={() => onStartJson(item.id, jsonInput)}
                                className="w-full py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors animate-fade-in"
                            >
                                Align Text to JSON <i className="fa-solid fa-arrow-right-arrow-left ml-2"></i>
                            </button>
                        )}
                        
                        {isJsonValidated && (
                            <button 
                                onClick={() => {
                                    setIsJsonValidated(false); 
                                    setValidationResult(null);
                                }} 
                                className="w-full text-xs text-slate-400 hover:text-slate-600 underline"
                            >
                                Edit JSON / Re-validate
                            </button>
                        )}
                    </div>
                 )}
              </div>
            )}

            {/* 3. Final JSON Result */}
            {item.status === ProcessingStatus.COMPLETED && (
                <div>
                     <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-semibold text-emerald-700">
                            <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-xs mr-2">Final Output</span>
                            Aligned JSON
                        </label>
                        <div className="flex items-center space-x-3">
                            <button
                                onClick={handleRedoClick}
                                className="text-xs text-slate-400 hover:text-indigo-600 transition-colors flex items-center"
                                title="Edit text or JSON and run alignment again"
                            >
                                <i className="fa-solid fa-rotate-left mr-1.5"></i> Redo
                            </button>
                            <button 
                                onClick={handleCopyJson}
                                className={`text-xs flex items-center transition-all duration-200 ${
                                    isCopied 
                                    ? 'text-emerald-600 font-bold' 
                                    : 'text-slate-500 hover:text-emerald-600'
                                }`}
                            >
                                {isCopied ? (
                                    <>
                                        <i className="fa-solid fa-check mr-1.5"></i> Copied!
                                    </>
                                ) : (
                                    <>
                                        <i className="fa-regular fa-copy mr-1.5"></i> Copy JSON
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                    <div className="w-full bg-slate-800 border border-slate-700 rounded-lg p-4 text-xs font-mono text-slate-300 shadow-inner overflow-auto max-h-[300px]">
                        <pre className="whitespace-pre-wrap">{item.jsonOutput}</pre>
                    </div>
                </div>
            )}

          </div>
        )}

        {/* Error */}
        {item.error && (
            <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
                <i className="fa-solid fa-circle-exclamation mr-2"></i>
                {item.error}
            </div>
        )}
      </div>
    </div>
  );
};